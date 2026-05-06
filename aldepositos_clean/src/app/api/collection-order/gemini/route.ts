import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI, MediaResolution } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import {
  collectionGeminiResponseSchema,
  type CollectionGeminiApiResponse,
  type CollectionGeminiLine,
} from "@/lib/collectionOrderGeminiSchema";
import { AI_ASSISTANT_DISPLAY_NAME } from "@/lib/aiAssistantBrand";
import {
  DEFAULT_GEMINI_MODEL,
  logGeminiServerError,
  mapGeminiErrorToClientResponse,
} from "@/lib/geminiConfig";
import {
  buildCollectionOrderSystemInstruction,
  displayNameFromSessionUser,
  sanitizeViewerDisplayNameHint,
} from "@/lib/geminiCollectionOrderContext";
import type { GeminiTokenUsage } from "@/lib/geminiClientUsage";
import { postProcessGeminiExtractedLines } from "@/lib/collectionOrderGeminiPostProcess";
import { extractPdfTextForGeminiFastPath } from "@/lib/geminiPdfTextForModel";
import { parseCollectionGeminiModelText } from "@/lib/geminiCollectionOrderResponseParse";

function usageFromGenAiResponse(response: unknown): GeminiTokenUsage | null {
  if (!response || typeof response !== "object") return null;
  const u = (response as { usageMetadata?: GeminiTokenUsage }).usageMetadata;
  if (!u) return null;
  const out: GeminiTokenUsage = {};
  if (typeof u.promptTokenCount === "number" && Number.isFinite(u.promptTokenCount)) {
    out.promptTokenCount = u.promptTokenCount;
  }
  if (typeof u.candidatesTokenCount === "number" && Number.isFinite(u.candidatesTokenCount)) {
    out.candidatesTokenCount = u.candidatesTokenCount;
  }
  if (typeof u.totalTokenCount === "number" && Number.isFinite(u.totalTokenCount)) {
    out.totalTokenCount = u.totalTokenCount;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILE_BYTES = 6 * 1024 * 1024;
/** Menos tokens en prompt = menor latencia (suficiente para citas rápidas). */
const HISTORY_TURNS = 4;
const HISTORY_TURN_MAX_CHARS = 5_000;
/** Proformas largas: 4096 truncaba JSON inválido; 8192 evita cortes típicos. */
const REPLY_MAX_OUTPUT_TOKENS = 8192;
const JSON_RETRY_PROMPT =
  "Corrige formato: tu salida debe ser únicamente un objeto JSON válido con propiedades \"reply\" (string) y \"lines\" (array de filas), sin texto ni ``` markdown antes/después ni comentarios. Si antes quedaste sin espacio, acorta \"reply\" a 2–3 frases y completa todas las filas detectables del documento en \"lines\".";
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

function verifyUser(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return { error: NextResponse.json({ error: "Falta configuración de Supabase." }, { status: 500 }) };
  }
  const authHeader = request.headers.get("authorization");
  const token =
    authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return { error: NextResponse.json({ error: "Sin sesión." }, { status: 401 }) };
  }
  return { url, anonKey, token };
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error: `Falta GEMINI_API_KEY en el servidor (.env.local), necesaria para ${AI_ASSISTANT_DISPLAY_NAME}. Obtén una clave en Google AI Studio.`,
      },
      { status: 503 },
    );
  }

  const auth = verifyUser(request);
  if ("error" in auth) return auth.error;

  const verify = createClient(auth.url, auth.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const {
    data: { user },
    error: authErr,
  } = await verify.auth.getUser(auth.token);
  if (authErr || !user) {
    return NextResponse.json({ error: "Sesión inválida." }, { status: 401 });
  }

  let body: {
    message?: string;
    history?: { role: "user" | "model"; text: string }[];
    file?: { base64: string; mimeType: string };
    orderNumber?: string;
    contextHint?: string;
    /** Nombre que ve el usuario en el panel (perfil); refuerza el reconocimiento junto al JWT. */
    viewerDisplayName?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const message = String(body.message ?? "").trim();
  if (!message && !body.file) {
    return NextResponse.json(
      { error: "Envía un mensaje o un archivo." },
      { status: 400 },
    );
  }

  if (body.file) {
    const mime = String(body.file.mimeType ?? "").toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      return NextResponse.json(
        {
          error:
            "Tipo de archivo no permitido. Usa PDF, PNG, JPEG o WebP (máx. ~6 MB).",
        },
        { status: 400 },
      );
    }
    let size: number;
    try {
      size = Buffer.from(body.file.base64, "base64").length;
    } catch {
      return NextResponse.json({ error: "Base64 inválido." }, { status: 400 });
    }
    if (size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: "El archivo supera el tamaño máximo (6 MB)." },
        { status: 400 },
      );
    }
  }

  const model =
    process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

  const preferredName =
    sanitizeViewerDisplayNameHint(body.viewerDisplayName) ??
    displayNameFromSessionUser(user);

  const systemInstruction = buildCollectionOrderSystemInstruction({
    assistantDisplayName: AI_ASSISTANT_DISPLAY_NAME,
    preferredName,
    email: user.email ?? undefined,
  });

  let preambleLines = [
    `Quién escribe (sesión): ${preferredName}.`,
    body.orderNumber
      ? `Número de orden de recolección (contexto): ${body.orderNumber}.`
      : "",
    body.contextHint ? `Contexto adicional:\n${body.contextHint}` : "",
    message || "(Sin texto: solo analiza el archivo adjunto.)",
  ];

  type ContentPart = { text?: string; inlineData?: { mimeType: string; data: string } };
  type GenContent = { role: string; parts: ContentPart[] };

  const contents: GenContent[] = [];
  const history = Array.isArray(body.history) ? body.history.slice(-HISTORY_TURNS) : [];
  for (const h of history) {
    const role = h.role === "model" ? "model" : "user";
    const text = String(h.text ?? "").slice(0, HISTORY_TURN_MAX_CHARS);
    if (text) {
      contents.push({ role, parts: [{ text }] });
    }
  }

  let pdfVisionSkippedForSpeed = false;
  const mime = body.file ? String(body.file.mimeType ?? "").toLowerCase() : "";
  if (
    body.file?.base64 &&
    mime === "application/pdf" &&
    process.env.GEMINI_FORCE_PDF_VISION?.trim() !== "1"
  ) {
    const extracted = await extractPdfTextForGeminiFastPath(body.file.base64);
    if (extracted) {
      pdfVisionSkippedForSpeed = true;
      preambleLines = [
        ...preambleLines,
        "Este PDF se procesó como texto seleccionable (respuesta más rápida). Extrae líneas como siempre; si ves tablas algo rotas en el texto, infiere orden de columnas desde continuidad y encabezados.",
        "--- Contenido del PDF ---",
        extracted,
      ];
    }
  }

  const userPreamble = preambleLines.filter(Boolean).join("\n\n");

  const parts: ContentPart[] = [{ text: userPreamble }];
  if (
    body.file?.base64 &&
    body.file.mimeType &&
    !pdfVisionSkippedForSpeed
  ) {
    parts.push({
      inlineData: {
        mimeType: body.file.mimeType,
        data: body.file.base64,
      },
    });
  }

  contents.push({ role: "user", parts });

  const ai = new GoogleGenAI({ apiKey });
  const hasBinaryMedia =
    pdfVisionSkippedForSpeed === false &&
    Boolean(body.file?.base64 && body.file.mimeType);

  const mrRaw = process.env.GEMINI_MEDIA_RESOLUTION?.trim().toLowerCase();
  let mediaResolution: MediaResolution = MediaResolution.MEDIA_RESOLUTION_LOW;
  if (mrRaw === "high") mediaResolution = MediaResolution.MEDIA_RESOLUTION_HIGH;
  else if (mrRaw === "medium") {
    mediaResolution = MediaResolution.MEDIA_RESOLUTION_MEDIUM;
  }

  try {
    const genConfig = {
      systemInstruction,
      responseMimeType: "application/json" as const,
      responseSchema: collectionGeminiResponseSchema,
      temperature: 0.1,
      topP: 0.85,
      maxOutputTokens: REPLY_MAX_OUTPUT_TOKENS,
      ...(hasBinaryMedia ? { mediaResolution } : {}),
    };

    let response = await ai.models.generateContent({
      model,
      contents,
      config: genConfig,
    });

    let raw = response.text;
    if (!raw) {
      return NextResponse.json(
        {
          error: `${AI_ASSISTANT_DISPLAY_NAME} no devolvió texto. Reintenta o reduce el archivo.`,
        },
        { status: 502 },
      );
    }

    let decoded = parseCollectionGeminiModelText(raw);
    if (!decoded && process.env.GEMINI_SKIP_JSON_RETRY?.trim() !== "1") {
      const retryContents = [
        ...contents,
        { role: "user", parts: [{ text: JSON_RETRY_PROMPT }] },
      ];
      response = await ai.models.generateContent({
        model,
        contents: retryContents,
        config: genConfig,
      });
      raw = response.text;
      decoded = raw ? parseCollectionGeminiModelText(raw) : null;
    }

    if (!decoded) {
      logGeminiServerError("collection-order/gemini", new Error("json_parse_failed"), {
        model,
        rawSnippet: typeof raw === "string" ? raw.slice(0, 400) : null,
      });
      return NextResponse.json(
        {
          error:
            "La respuesta no llegó como JSON válido (a veces documentos muy largos o formato inesperado). Prueba «Nuevo chat», trocea el archivo o fuerza GEMINI_FORCE_PDF_VISION=1 si sospechas PDF solo imagen.",
          raw: typeof raw === "string" ? raw.slice(0, 800) : "",
        },
        { status: 502 },
      );
    }

    const parsed = decoded.parsed;

    const rawLines = Array.isArray(parsed.lines) ? parsed.lines : [];
    const trimmed = rawLines
      .filter(
        (row): row is CollectionGeminiLine =>
          row !== null && typeof row === "object",
      )
      .map((row: CollectionGeminiLine) => ({
        referencia: String(row.referencia ?? "").trim(),
        descripcion: String(row.descripcion ?? "").trim(),
        bultos: String(row.bultos ?? "").trim(),
        unidadesPorBulto: String(row.unidadesPorBulto ?? "").trim(),
        unidadesTotales: String(row.unidadesTotales ?? "").trim(),
        pesoUnaPiezaKg: String(row.pesoUnaPiezaKg ?? "").trim(),
        pesoPorBulto: String(row.pesoPorBulto ?? "").trim(),
        pesoTotalKg: String(row.pesoTotalKg ?? "").trim(),
        l: String(row.l ?? "").trim(),
        w: String(row.w ?? "").trim(),
        h: String(row.h ?? "").trim(),
        volumenM3: String(row.volumenM3 ?? "").trim(),
        unidad: String(row.unidad ?? "").trim(),
        modelo: String(row.modelo ?? "").trim(),
        paisOrigen: String(row.paisOrigen ?? "").trim(),
        tejido: String(row.tejido ?? "").trim(),
        talla: String(row.talla ?? "").trim(),
        forro: String(row.forro ?? "").trim(),
        genero: String(row.genero ?? "").trim(),
        composicion: String(row.composicion ?? "").trim(),
      }));
    const lines = postProcessGeminiExtractedLines(trimmed);
    const reply = typeof parsed.reply === "string" ? parsed.reply : "";
    const usage = usageFromGenAiResponse(response);

    return NextResponse.json({
      reply,
      usage,
      lines,
    });
  } catch (e) {
    logGeminiServerError("collection-order/gemini", e, { model });
    const { httpStatus, error } = mapGeminiErrorToClientResponse(e);
    return NextResponse.json({ error }, { status: httpStatus });
  }
}
