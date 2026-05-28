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
import {
  mergeDedupedGeminiLines,
  splitTextIntoChunks,
  sumGeminiUsage,
  trimGeminiLine,
} from "@/lib/geminiCollectionOrderChunkedExtract";
import { postProcessGeminiExtractedLines } from "@/lib/collectionOrderGeminiPostProcess";
import { extractPdfTextForGeminiFastPath } from "@/lib/geminiPdfTextForModel";
import { parseCollectionGeminiModelText } from "@/lib/geminiCollectionOrderResponseParse";
import { fetchLearningBlockForGeminiPrompt } from "@/lib/geminiLearningNotes";
import {
  MARKDOWN_TABLE_EXTRACTION_PROMPT,
  tryParseMarkdownTableToLines,
} from "@/lib/geminiMarkdownTableExtract";

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
// PDFs largos + reintentos del modelo pueden exceder el default del hosting.
export const maxDuration = 300;

const MAX_FILE_BYTES = 6 * 1024 * 1024;
const HISTORY_TURNS = 4;
const HISTORY_TURN_MAX_CHARS = 5_000;
const HISTORY_TURNS_CHUNK_MODE = 2;
const HISTORY_TURN_MAX_CHARS_CHUNK = 2_800;

/** Proformas largas: salida JSON amplia por fragmento. */
const REPLY_MAX_OUTPUT_TOKENS = 8192;
/** Tabla markdown (modo Gemini web): más filas sin trozar JSON. */
const MARKDOWN_MAX_OUTPUT_TOKENS = 16_384;
const JSON_RETRY_PROMPT =
  "Corrige formato: tu salida debe ser únicamente un objeto JSON válido con propiedades \"reply\" (string) y \"lines\" (array de filas), sin texto ni ``` markdown antes/después ni comentarios. Si antes quedaste sin espacio, acorta \"reply\" a 2–3 frases y completa todas las filas detectables del documento en \"lines\".";

const LOOSE_JSON_FALLBACK_PROMPT = `Tu salida anterior no era JSON válido o estaba truncada. Generá de nuevo UN SOLO objeto JSON (sin markdown, sin texto antes ni después).

Raíz obligatoria:
- "reply": string en español, máximo 5 frases (resumen operativo).
- "lines": array de objetos, uno por fila de producto del documento.

Cada objeto en "lines" usa SOLO strings ("" si no aplica): referencia, descripcion, bultos, unidadesPorBulto, unidadesTotales, pesoUnaPiezaKg, pesoPorBulto, pesoTotalKg, l, w, h, volumenM3, unidad, modelo, paisOrigen, tejido, talla, forro, genero, composicion.

Reglas JSON: escapá comillas dobles dentro de valores con \\". No uses comillas simples para delimitar claves. No dejes comas colgantes. Si una descripción es larga, acortala antes de romper el JSON.`;

const TEXT_JSON_FALLBACK_PROMPT = `Último intento: devolvé ÚNICAMENTE un objeto JSON válido (texto plano). Sin bloques de código markdown, sin explicación antes ni después.

Mismas claves: "reply" (string breve) y "lines" (array de filas con strings). Si no podés incluir todas las filas sin romper el JSON, incluí las más importantes y en "reply" indicá que pueden faltar filas por límite.`;

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

type GeminiRouteBody = {
  message?: string;
  history?: { role: "user" | "model"; text: string }[];
  file?: { base64: string; mimeType: string };
  /** Texto del PDF extraído en el navegador (evita subir base64 en JSON). */
  pdfText?: string;
  orderNumber?: string;
  contextHint?: string;
  viewerDisplayName?: string;
};

const PDF_TEXT_MAX_CHARS = 650_000;

async function parseGeminiRequestBody(
  request: NextRequest,
): Promise<
  { ok: true; body: GeminiRouteBody } | { ok: false; response: NextResponse }
> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return {
        ok: false,
        response: NextResponse.json({ error: "Formulario inválido." }, { status: 400 }),
      };
    }
    const payloadRaw = form.get("payload");
    if (typeof payloadRaw !== "string" || !payloadRaw.trim()) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Falta payload en la subida del archivo." },
          { status: 400 },
        ),
      };
    }
    let body: GeminiRouteBody;
    try {
      body = JSON.parse(payloadRaw) as GeminiRouteBody;
    } catch {
      return {
        ok: false,
        response: NextResponse.json({ error: "JSON inválido en payload." }, { status: 400 }),
      };
    }
    const upload = form.get("file");
    if (upload instanceof Blob && upload.size > 0) {
      const buf = Buffer.from(await upload.arrayBuffer());
      const mimeType =
        upload instanceof File && upload.type
          ? upload.type
          : "application/octet-stream";
      body.file = { base64: buf.toString("base64"), mimeType };
    }
    return { ok: true, body };
  }

  try {
    const body = (await request.json()) as GeminiRouteBody;
    return { ok: true, body };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "JSON inválido." }, { status: 400 }),
    };
  }
}

function readChunkConfig() {
  const chunkSize = Math.max(
    8_000,
    Number(process.env.GEMINI_PDF_TEXT_CHUNK_CHARS?.trim()) || 38_000,
  );
  const overlap = Math.max(
    200,
    Math.min(
      Math.floor(chunkSize / 3),
      Number(process.env.GEMINI_PDF_TEXT_CHUNK_OVERLAP?.trim()) || 2_400,
    ),
  );
  const minToSplit = Math.max(
    4_000,
    Number(process.env.GEMINI_PDF_TEXT_CHUNK_MIN?.trim()) || 14_000,
  );
  const maxChunks = Math.max(
    1,
    Math.min(40, Number(process.env.GEMINI_PDF_MAX_CHUNKS?.trim()) || 14),
  );
  return { chunkSize, overlap, minToSplit, maxChunks };
}

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

type ContentPart = { text?: string; inlineData?: { mimeType: string; data: string } };
type GenContent = { role: string; parts: ContentPart[] };

function historyToContents(
  history: { role: "user" | "model"; text: string }[] | undefined,
  turns: number,
  maxChars: number,
): GenContent[] {
  const contents: GenContent[] = [];
  const h = Array.isArray(history) ? history.slice(-turns) : [];
  for (const t of h) {
    const role = t.role === "model" ? "model" : "user";
    const text = String(t.text ?? "").slice(0, maxChars);
    if (text) contents.push({ role, parts: [{ text }] });
  }
  return contents;
}

function mapRawLines(rawLines: unknown[]): CollectionGeminiLine[] {
  return rawLines
    .filter((row): row is CollectionGeminiLine => row !== null && typeof row === "object")
    .map((row: CollectionGeminiLine) => trimGeminiLine(row));
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

  const parsed = await parseGeminiRequestBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  const message = String(body.message ?? "").trim();
  const pdfTextFromClient = String(body.pdfText ?? "").trim();
  if (!message && !body.file && !pdfTextFromClient) {
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

  const learningBlock = await fetchLearningBlockForGeminiPrompt(
    auth.url,
    auth.anonKey,
    auth.token,
  );
  const mergedContextHint =
    [body.contextHint?.trim(), learningBlock].filter(Boolean).join("\n\n") || undefined;

  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

  const preferredName =
    sanitizeViewerDisplayNameHint(body.viewerDisplayName) ??
    displayNameFromSessionUser(user);

  const systemInstruction = buildCollectionOrderSystemInstruction({
    assistantDisplayName: AI_ASSISTANT_DISPLAY_NAME,
    preferredName,
    email: user.email ?? undefined,
  });

  const { chunkSize, overlap, minToSplit, maxChunks } = readChunkConfig();

  const preambleBase = [
    `Quién escribe (sesión): ${preferredName}.`,
    body.orderNumber
      ? `Número de orden de recolección (contexto): ${body.orderNumber}.`
      : "",
    mergedContextHint ? `Contexto adicional:\n${mergedContextHint}` : "",
    message || "(Sin texto: solo analiza el archivo adjunto.)",
  ];

  let pdfVisionSkippedForSpeed = false;
  let extractedPdfText: string | null = null;
  const mime = body.file ? String(body.file.mimeType ?? "").toLowerCase() : "";

  if (pdfTextFromClient && process.env.GEMINI_FORCE_PDF_VISION?.trim() !== "1") {
    extractedPdfText =
      pdfTextFromClient.length > PDF_TEXT_MAX_CHARS
        ? pdfTextFromClient.slice(0, PDF_TEXT_MAX_CHARS) +
          "\n\n[…contenido truncado — prioriza líneas ya visibles arriba…]"
        : pdfTextFromClient;
    pdfVisionSkippedForSpeed = true;
  } else if (
    body.file?.base64 &&
    mime === "application/pdf" &&
    process.env.GEMINI_FORCE_PDF_VISION?.trim() !== "1"
  ) {
    extractedPdfText = await extractPdfTextForGeminiFastPath(body.file.base64);
    if (extractedPdfText) {
      pdfVisionSkippedForSpeed = true;
    }
  }

  const ai = new GoogleGenAI({ apiKey });

  const mrRaw = process.env.GEMINI_MEDIA_RESOLUTION?.trim().toLowerCase();
  let mediaResolution: MediaResolution = MediaResolution.MEDIA_RESOLUTION_LOW;
  if (mrRaw === "high") mediaResolution = MediaResolution.MEDIA_RESOLUTION_HIGH;
  else if (mrRaw === "medium") {
    mediaResolution = MediaResolution.MEDIA_RESOLUTION_MEDIUM;
  }

  const generateJsonResponse = async (
    contents: GenContent[],
    hasBinaryMedia: boolean,
  ): Promise<{
    parsed: CollectionGeminiApiResponse;
    response: unknown;
    raw: string;
  }> => {
    const skipLoose =
      process.env.GEMINI_SKIP_LOOSE_JSON_FALLBACK?.trim() === "1";

    const structuredBase = {
      systemInstruction,
      responseMimeType: "application/json" as const,
      responseSchema: collectionGeminiResponseSchema,
      temperature: 0.1,
      topP: 0.85,
      maxOutputTokens: REPLY_MAX_OUTPUT_TOKENS,
      ...(hasBinaryMedia ? { mediaResolution } : {}),
    };

    const tryParse = (text: string | undefined) => {
      if (!text) return null;
      return parseCollectionGeminiModelText(text);
    };

    let response = await ai.models.generateContent({
      model,
      contents,
      config: structuredBase as never,
    });
    let raw = response.text;
    if (!raw) throw new Error("empty_model_text");

    let decoded = tryParse(raw);
    if (!decoded && process.env.GEMINI_SKIP_JSON_RETRY?.trim() !== "1") {
      const retryContents = [
        ...contents,
        { role: "user", parts: [{ text: JSON_RETRY_PROMPT }] },
      ];
      response = await ai.models.generateContent({
        model,
        contents: retryContents,
        config: structuredBase as never,
      });
      const rawRetry = response.text;
      if (rawRetry) {
        raw = rawRetry;
        decoded = tryParse(rawRetry);
      }
    }

    if (!decoded && !skipLoose) {
      const looseContents = [
        ...contents,
        { role: "user", parts: [{ text: LOOSE_JSON_FALLBACK_PROMPT }] },
      ];
      const looseConfig = {
        systemInstruction,
        responseMimeType: "application/json" as const,
        temperature: 0.08,
        topP: 0.9,
        maxOutputTokens: REPLY_MAX_OUTPUT_TOKENS,
        ...(hasBinaryMedia ? { mediaResolution } : {}),
      };
      response = await ai.models.generateContent({
        model,
        contents: looseContents,
        config: looseConfig as never,
      });
      const rawLoose = response.text;
      if (rawLoose) {
        raw = rawLoose;
        decoded = tryParse(rawLoose);
      }
    }

    if (!decoded && !skipLoose) {
      const textContents = [
        ...contents,
        { role: "user", parts: [{ text: TEXT_JSON_FALLBACK_PROMPT }] },
      ];
      const textConfig = {
        systemInstruction,
        temperature: 0.05,
        topP: 0.95,
        maxOutputTokens: REPLY_MAX_OUTPUT_TOKENS,
        ...(hasBinaryMedia ? { mediaResolution } : {}),
      };
      response = await ai.models.generateContent({
        model,
        contents: textContents,
        config: textConfig as never,
      });
      const rawText = response.text;
      if (rawText) {
        raw = rawText;
        decoded = tryParse(rawText);
      }
    }

    if (decoded) {
      return { parsed: decoded.parsed, response, raw };
    }

    const skipMarkdown =
      process.env.GEMINI_SKIP_MARKDOWN_TABLE_FALLBACK?.trim() === "1";

    let linesFromMd = tryParseMarkdownTableToLines(raw);
    if (linesFromMd.length === 0 && !skipMarkdown) {
      const mdSystem =
        "Eres un extractor de datos para ALDEPOSITOS (logística, Panamá). " +
        "Tu salida es SOLO una tabla markdown: una fila de encabezados y luego una fila por producto. " +
        "Sin párrafos antes ni después de la tabla. Español.";
      const mdContents = [
        ...contents,
        { role: "user", parts: [{ text: MARKDOWN_TABLE_EXTRACTION_PROMPT }] },
      ];
      const mdConfig = {
        systemInstruction: mdSystem,
        temperature: 0.1,
        topP: 0.9,
        maxOutputTokens: MARKDOWN_MAX_OUTPUT_TOKENS,
        ...(hasBinaryMedia ? { mediaResolution } : {}),
      };
      const mdResp = await ai.models.generateContent({
        model,
        contents: mdContents,
        config: mdConfig as never,
      });
      response = mdResp;
      const mdRaw = mdResp.text ?? "";
      raw = mdRaw;
      linesFromMd = tryParseMarkdownTableToLines(mdRaw);
    }

    if (linesFromMd.length > 0) {
      return {
        parsed: {
          reply: `Se extrajo ${linesFromMd.length} fila(s) en modo tabla (similar a Gemini web). Revisá cantidades y medidas en la grilla.`,
          lines: linesFromMd,
        },
        response,
        raw,
      };
    }

    logGeminiServerError("collection-order/gemini", new Error("json_parse_failed"), {
      model,
      rawSnippet: typeof raw === "string" ? raw.slice(0, 400) : null,
    });
    throw new Error("json_parse_failed");
  };

  try {
    const allUsages: (GeminiTokenUsage | null)[] = [];
    const replyParts: string[] = [];
    let mergedLines: CollectionGeminiLine[] = [];

    const pushChunkResult = (parsed: CollectionGeminiApiResponse, response: unknown) => {
      allUsages.push(usageFromGenAiResponse(response));
      const rawLines = Array.isArray(parsed.lines) ? parsed.lines : [];
      const trimmed = mapRawLines(rawLines as unknown[]);
      const processed = postProcessGeminiExtractedLines(trimmed);
      mergedLines.push(...processed);
      const r = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
      if (r) replyParts.push(r);
    };

    // ——— PDF texto largo: varias pasadas ———
    if (pdfVisionSkippedForSpeed && extractedPdfText && extractedPdfText.length >= minToSplit) {
      let chunks = splitTextIntoChunks(extractedPdfText, chunkSize, overlap);
      const totalPlanned = chunks.length;
      const truncated = chunks.length > maxChunks;
      if (truncated) chunks = chunks.slice(0, maxChunks);

      const intro = [
        ...preambleBase,
        "Este PDF tiene texto seleccionable. Se procesa en fragmentos consecutivos para extraer todas las líneas sin truncar el documento.",
        "En cada fragmento: extrae SOLO las filas de producto/referencia visibles en ese texto; no inventes filas de otras partes del PDF.",
        'En "reply" máximo 2 frases por fragmento (español, operativo).',
      ]
        .filter(Boolean)
        .join("\n\n");

      const historyContents = historyToContents(
        body.history,
        HISTORY_TURNS_CHUNK_MODE,
        HISTORY_TURN_MAX_CHARS_CHUNK,
      );

      for (let i = 0; i < chunks.length; i++) {
        const chunkBody = [
          `--- Fragmento ${i + 1}/${chunks.length} del PDF (texto) ---`,
          "Si una fila queda cortada al inicio o al final del fragmento, solo complétala si el dato está explícito en este mismo fragmento.",
          chunks[i],
        ].join("\n\n");

        const userText = [intro, chunkBody].join("\n\n");
        const contents: GenContent[] = [
          ...historyContents,
          { role: "user", parts: [{ text: userText }] },
        ];

        const { parsed, response } = await generateJsonResponse(contents, false);
        pushChunkResult(parsed, response);
      }

      mergedLines = mergeDedupedGeminiLines(mergedLines);
      const usage = sumGeminiUsage(allUsages);
      let reply = replyParts.join("\n\n");
      if (truncated) {
        reply +=
          `\n\n[Nota: el PDF superó el máximo de fragmentos en una solicitud (${maxChunks}/${totalPlanned} fragmentos). ` +
          `Si faltan líneas al final, volvé a enviar solo las últimas páginas o dividí el PDF en dos archivos.]`;
      }

      return NextResponse.json({
        reply,
        usage,
        lines: mergedLines,
      });
    }

    // ——— Texto largo sin archivo (pega Excel grande) ———
    if (!body.file && message.length >= minToSplit) {
      let chunks = splitTextIntoChunks(message, chunkSize, overlap);
      const totalPlanned = chunks.length;
      const truncated = chunks.length > maxChunks;
      if (truncated) chunks = chunks.slice(0, maxChunks);

      const intro = [
        `Quién escribe (sesión): ${preferredName}.`,
        body.orderNumber
          ? `Número de orden de recolección (contexto): ${body.orderNumber}.`
          : "",
        mergedContextHint ? `Contexto adicional:\n${mergedContextHint}` : "",
        "El mensaje se envía en fragmentos por tamaño. En cada fragmento extrae SOLO las filas visibles ahí.",
        'En "reply" máximo 2 frases por fragmento.',
      ]
        .filter(Boolean)
        .join("\n\n");

      const historyContents = historyToContents(
        body.history,
        HISTORY_TURNS_CHUNK_MODE,
        HISTORY_TURN_MAX_CHARS_CHUNK,
      );

      for (let i = 0; i < chunks.length; i++) {
        const chunkBody = [
          `--- Fragmento ${i + 1}/${chunks.length} del mensaje ---`,
          chunks[i],
        ].join("\n\n");
        const userText = [intro, chunkBody].join("\n\n");
        const contents: GenContent[] = [
          ...historyContents,
          { role: "user", parts: [{ text: userText }] },
        ];
        const { parsed, response } = await generateJsonResponse(contents, false);
        pushChunkResult(parsed, response);
      }

      mergedLines = mergeDedupedGeminiLines(mergedLines);
      const usage = sumGeminiUsage(allUsages);
      let reply = replyParts.join("\n\n");
      if (truncated) {
        reply +=
          `\n\n[Nota: el texto superó el máximo de fragmentos (${maxChunks}/${totalPlanned}). ` +
          `Enviá el resto en un segundo mensaje o dividí la tabla.]`;
      }
      return NextResponse.json({ reply, usage, lines: mergedLines });
    }

    // ——— Una sola pasada (PDF corto, imagen, PDF binario, mensaje corto) ———
    let preambleLines = [...preambleBase];
    if (pdfVisionSkippedForSpeed && extractedPdfText) {
      preambleLines = [
        ...preambleLines,
        "Este PDF se procesó como texto seleccionable (respuesta más rápida). Extrae líneas como siempre; si ves tablas algo rotas en el texto, infiere orden de columnas desde continuidad y encabezados.",
        "--- Contenido del PDF ---",
        extractedPdfText,
      ];
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

    const contents: GenContent[] = [
      ...historyToContents(body.history, HISTORY_TURNS, HISTORY_TURN_MAX_CHARS),
      { role: "user", parts },
    ];

    const hasBinaryMedia =
      pdfVisionSkippedForSpeed === false &&
      Boolean(body.file?.base64 && body.file.mimeType);

    const { parsed, response } = await generateJsonResponse(contents, hasBinaryMedia);
    const rawLines = Array.isArray(parsed.lines) ? parsed.lines : [];
    const trimmed = mapRawLines(rawLines as unknown[]);
    const lines = postProcessGeminiExtractedLines(trimmed);
    const reply = typeof parsed.reply === "string" ? parsed.reply : "";
    const usage = usageFromGenAiResponse(response);

    return NextResponse.json({
      reply,
      usage,
      lines,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "empty_model_text") {
      return NextResponse.json(
        {
          error: `${AI_ASSISTANT_DISPLAY_NAME} no devolvió texto. Reintenta o reduce el archivo.`,
        },
        { status: 502 },
      );
    }
    if (msg === "json_parse_failed") {
      return NextResponse.json(
        {
          error:
            "No se pudo interpretar la respuesta del modelo tras varios reintentos automáticos. Probá «Nuevo chat», un archivo más liviano, o pegá la tabla. PDF escaneado: GEMINI_FORCE_PDF_VISION=1. Para omitir los reintentos JSON extra (solo modo esquema estricto): GEMINI_SKIP_LOOSE_JSON_FALLBACK=1.",
          raw: "",
        },
        { status: 502 },
      );
    }
    logGeminiServerError("collection-order/gemini", e, { model });
    const { httpStatus, error } = mapGeminiErrorToClientResponse(e);
    return NextResponse.json({ error }, { status: httpStatus });
  }
}
