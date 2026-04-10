import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import {
  collectionGeminiResponseSchema,
  type CollectionGeminiApiResponse,
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

  const userPreamble = [
    `Quién escribe (sesión): ${preferredName}.`,
    body.orderNumber
      ? `Número de orden de recolección (contexto): ${body.orderNumber}.`
      : "",
    body.contextHint ? `Contexto adicional:\n${body.contextHint}` : "",
    message || "(Sin texto: solo analiza el archivo adjunto.)",
  ]
    .filter(Boolean)
    .join("\n\n");

  type ContentPart = { text?: string; inlineData?: { mimeType: string; data: string } };
  type GenContent = { role: string; parts: ContentPart[] };

  const contents: GenContent[] = [];
  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
  for (const h of history) {
    const role = h.role === "model" ? "model" : "user";
    const text = String(h.text ?? "").slice(0, 12_000);
    if (text) {
      contents.push({ role, parts: [{ text }] });
    }
  }

  const parts: ContentPart[] = [{ text: userPreamble }];
  if (body.file?.base64 && body.file.mimeType) {
    parts.push({
      inlineData: {
        mimeType: body.file.mimeType,
        data: body.file.base64,
      },
    });
  }
  contents.push({ role: "user", parts });

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: collectionGeminiResponseSchema,
        temperature: 0.2,
      },
    });

    const raw = response.text;
    if (!raw) {
      return NextResponse.json(
        {
          error: `${AI_ASSISTANT_DISPLAY_NAME} no devolvió texto. Reintenta o reduce el archivo.`,
        },
        { status: 502 },
      );
    }

    let parsed: CollectionGeminiApiResponse;
    try {
      parsed = JSON.parse(raw) as CollectionGeminiApiResponse;
    } catch {
      return NextResponse.json(
        {
          error: "Respuesta del modelo no es JSON válido.",
          raw: raw.slice(0, 500),
        },
        { status: 502 },
      );
    }

    const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
    const reply = typeof parsed.reply === "string" ? parsed.reply : "";
    const usage = usageFromGenAiResponse(response);

    return NextResponse.json({
      reply,
      usage,
      lines: lines.map((row) => ({
        referencia: String(row.referencia ?? "").trim(),
        descripcion: String(row.descripcion ?? "").trim(),
        bultos: String(row.bultos ?? "").trim(),
        unidadesPorBulto: String(row.unidadesPorBulto ?? "").trim(),
        unidadesTotales: String(row.unidadesTotales ?? "").trim(),
        pesoPorBulto: String(row.pesoPorBulto ?? "").trim(),
        pesoTotalKg: String(row.pesoTotalKg ?? "").trim(),
        l: String(row.l ?? "").trim(),
        w: String(row.w ?? "").trim(),
        h: String(row.h ?? "").trim(),
        volumenM3: String(row.volumenM3 ?? "").trim(),
        unidad: String(row.unidad ?? "").trim(),
      })),
    });
  } catch (e) {
    logGeminiServerError("collection-order/gemini", e, { model });
    const { httpStatus, error } = mapGeminiErrorToClientResponse(e);
    return NextResponse.json({ error }, { status: httpStatus });
  }
}
