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
  mergeGeminiLinesInOrder,
  splitTextIntoDocumentChunks,
  sumGeminiUsage,
  trimGeminiLine,
} from "@/lib/geminiCollectionOrderChunkedExtract";
import {
  estimateProductCodesInChunk,
  isChunkLikelyIncomplete,
} from "@/lib/geminiChunkCoverage";
import {
  finalizeDocumentGeminiLines,
  PDF_DOCUMENT_CHUNK_INTRO,
  shouldUseChunkedPdfExtraction,
} from "@/lib/geminiDocumentExtract";
import type { PdfExtractionValidation } from "@/lib/geminiChunkCoverage";
import { mergePdfTextsForExtraction } from "@/lib/geminiPdfTextMerge";
import type { PdfTextPickSource } from "@/lib/geminiPdfTextMerge";
import {
  CHUNK_FIELD_INCOMPLETE_RETRY_PROMPT,
  CHUNK_INCOMPLETE_RETRY_PROMPT,
  FACTURA_TABULAR_CHUNK_HINT,
} from "@/lib/geminiFacturaHints";
import { countPdfPagesInText } from "@/lib/geminiPdfPageText";
import { postProcessGeminiExtractedLines } from "@/lib/collectionOrderGeminiPostProcess";
import {
  mapInBatches,
  DEFAULT_MAX_CHUNKS,
  MAX_BINARY_UPLOAD_BYTES,
  readGeminiChunkBaseConfig,
  resolveChunkConfigForDocument,
  shouldChunkDocumentText,
  type DocumentProcessingMeta,
} from "@/lib/geminiDocumentLimits";
import { extractPdfTextForGeminiFastPath } from "@/lib/geminiPdfTextForModel";
import { fetchLearningBlockForGeminiPrompt } from "@/lib/geminiLearningNotes";
import { parseCollectionGeminiModelText } from "@/lib/geminiCollectionOrderResponseParse";
import {
  MARKDOWN_TABLE_EXTRACTION_PROMPT,
  tryParseMarkdownTableToLines,
} from "@/lib/geminiMarkdownTableExtract";
import {
  isRefsBultosExtractMode,
  REFS_BULTOS_CHUNK_HINT,
} from "@/lib/geminiRefsBultosMode";

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
/** Debe coincidir con SERVER_MAX_DURATION_S en geminiDocumentLimits.ts (literal requerido por Next.js). */
export const maxDuration = 300;

const MAX_FILE_BYTES = MAX_BINARY_UPLOAD_BYTES;
const HISTORY_TURNS = 4;
const HISTORY_TURN_MAX_CHARS = 5_000;
const HISTORY_TURNS_CHUNK_MODE = 2;
const HISTORY_TURN_MAX_CHARS_CHUNK = 2_800;

/** Proformas largas: salida JSON amplia por fragmento. */
const REPLY_MAX_OUTPUT_TOKENS = 8192;
/** Por página/fragmento: priorizar todas las filas de la tabla. */
const CHUNK_MAX_OUTPUT_TOKENS = 16_384;
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
  extractMode?: "full" | "refsBultosOnly";
};

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

function mergeChunkedLines(
  lines: CollectionGeminiLine[],
  splitByPages: boolean,
): CollectionGeminiLine[] {
  return splitByPages ? mergeGeminiLinesInOrder(lines) : mergeDedupedGeminiLines(lines);
}

function attachPdfValidationToMeta(
  meta: DocumentProcessingMeta | null,
  validation: PdfExtractionValidation | null,
  pdfTextSource: PdfTextPickSource,
): DocumentProcessingMeta | null {
  if (!meta && !validation && pdfTextSource === "none") return meta;
  const base: DocumentProcessingMeta = meta ?? {
    tier: "normal",
    maxChunks: DEFAULT_MAX_CHUNKS,
    estimatedRows: 0,
    adaptive: true,
  };
  return {
    ...base,
    pdfTextSource,
    ...(validation
      ? {
          pdfCodesFound: validation.pdfCodesFound,
          cartonesFooter: validation.cartonesFooter,
          bultosSum: validation.bultosSum,
          linesWithMissingFields: validation.linesWithMissingFields,
          extractionIncomplete: validation.extractionIncomplete,
          extractionIncompleteReason: validation.incompleteReason,
        }
      : {}),
  };
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
  const refsBultosOnly = isRefsBultosExtractMode(body.extractMode);
  const tabularChunkHint = refsBultosOnly
    ? REFS_BULTOS_CHUNK_HINT
    : FACTURA_TABULAR_CHUNK_HINT;

  const message = String(body.message ?? "").trim();
  const pdfTextFromClient = String(body.pdfText ?? "").trim();
  let fileSizeBytes: number | undefined;
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
            "Tipo de archivo no permitido. Usa PDF, PNG, JPEG o WebP (máx. ~15 MB).",
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
        { error: `El archivo supera el tamaño máximo (${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB).` },
        { status: 400 },
      );
    }
    fileSizeBytes = size;
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

  const chunkBase = readGeminiChunkBaseConfig();
  let chunkSize = chunkBase.chunkSize;
  let overlap = chunkBase.overlap;
  let minToSplit = chunkBase.minToSplit;
  let maxChunks = chunkBase.envMaxChunks ?? DEFAULT_MAX_CHUNKS;
  let processingMeta: DocumentProcessingMeta | null = null;

  const applyDocumentChunkConfig = (text: string) => {
    const resolved = resolveChunkConfigForDocument({ text, fileSizeBytes });
    chunkSize = resolved.config.chunkSize;
    overlap = resolved.config.overlap;
    minToSplit = resolved.config.minToSplit;
    maxChunks = resolved.config.maxChunks;
    processingMeta = resolved.meta;
  };

  const preambleBase = [
    `Quién escribe (sesión): ${preferredName}.`,
    body.orderNumber
      ? `Número de orden de recolección (contexto): ${body.orderNumber}.`
      : "",
    mergedContextHint ? `Contexto adicional:\n${mergedContextHint}` : "",
    refsBultosOnly
      ? "Modo «Leer documento»: en cada fila de lines solo referencia y bultos; demás campos vacíos."
      : "",
    message || "(Sin texto: solo analiza el archivo adjunto.)",
  ];

  let pdfVisionSkippedForSpeed = false;
  let extractedPdfText: string | null = null;
  let pdfTextSource: PdfTextPickSource = "none";
  const mime = body.file ? String(body.file.mimeType ?? "").toLowerCase() : "";

  let serverPdfText: string | null = null;
  if (body.file?.base64 && mime === "application/pdf") {
    serverPdfText = await extractPdfTextForGeminiFastPath(body.file.base64);
  }

  const pickedPdfText = mergePdfTextsForExtraction(pdfTextFromClient, serverPdfText);
  extractedPdfText = pickedPdfText.text;
  pdfTextSource = pickedPdfText.source;

  if (
    extractedPdfText &&
    process.env.GEMINI_FORCE_PDF_VISION?.trim() !== "1"
  ) {
    pdfVisionSkippedForSpeed = true;
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
    opts: { chunkMode?: boolean } = {},
  ): Promise<{
    parsed: CollectionGeminiApiResponse;
    response: unknown;
    raw: string;
  }> => {
    const chunkMode = opts.chunkMode === true;
    const skipLoose =
      process.env.GEMINI_SKIP_LOOSE_JSON_FALLBACK?.trim() === "1";
    const maxOutputTokens = chunkMode ? CHUNK_MAX_OUTPUT_TOKENS : REPLY_MAX_OUTPUT_TOKENS;

    const structuredBase = {
      systemInstruction,
      responseMimeType: "application/json" as const,
      responseSchema: collectionGeminiResponseSchema,
      temperature: 0.1,
      topP: 0.85,
      maxOutputTokens,
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
        maxOutputTokens,
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

    if (!decoded && !skipLoose && !chunkMode) {
      const textContents = [
        ...contents,
        { role: "user", parts: [{ text: TEXT_JSON_FALLBACK_PROMPT }] },
      ];
      const textConfig = {
        systemInstruction,
        temperature: 0.05,
        topP: 0.95,
        maxOutputTokens,
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

    if (decoded && decoded.parsed.lines.length > 0) {
      return { parsed: decoded.parsed, response, raw };
    }
    if (decoded && !chunkMode) {
      return { parsed: decoded.parsed, response, raw };
    }

    const skipMarkdown =
      process.env.GEMINI_SKIP_MARKDOWN_TABLE_FALLBACK?.trim() === "1" || chunkMode;

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

    if (decoded) {
      return { parsed: decoded.parsed, response, raw };
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

    const CHUNK_CONCURRENCY = 3;

    const runChunkedExtraction = async (args: {
      sourceLabel: string;
      text: string;
      introLines: string[];
      historyContents: GenContent[];
    }) => {
      const docSplit = splitTextIntoDocumentChunks(args.text, chunkSize, overlap);
      let chunks = docSplit.chunks;
      const splitByPages = docSplit.splitByPages;
      const totalPages = countPdfPagesInText(args.text);
      const totalPlanned = chunks.length;
      const truncated = chunks.length > maxChunks;
      if (truncated) chunks = chunks.slice(0, maxChunks);

      const intro = args.introLines.filter(Boolean).join("\n\n");
      const failedChunks: number[] = [];
      const incompleteChunks: number[] = [];

      type ChunkExtractResult = {
        index: number;
        lines: CollectionGeminiLine[];
        reply: string;
        usage: GeminiTokenUsage | null;
      };

      const extractOneChunk = async (
        contents: GenContent[],
      ): Promise<Omit<ChunkExtractResult, "index"> | null> => {
        try {
          const { parsed, response } = await generateJsonResponse(contents, false, {
            chunkMode: true,
          });
          const rawLines = Array.isArray(parsed.lines) ? parsed.lines : [];
          const trimmed = mapRawLines(rawLines as unknown[]);
          const processed = postProcessGeminiExtractedLines(trimmed);
          return {
            lines: processed,
            reply: typeof parsed.reply === "string" ? parsed.reply.trim() : "",
            usage: usageFromGenAiResponse(response),
          };
        } catch {
          return null;
        }
      };

      const chunkResults = await mapInBatches(
        chunks,
        CHUNK_CONCURRENCY,
        async (chunk, i): Promise<ChunkExtractResult | null> => {
          const pageMatch = /^---\s*PÁGINA\s+(\d+)\s*---/im.exec(chunk);
          const pageNum = pageMatch ? Number(pageMatch[1]) : i + 1;
          const fragmentTitle = pageMatch
            ? `PÁGINA ${pageMatch[1]} (fragmento ${i + 1}/${chunks.length})`
            : `Fragmento ${i + 1}/${chunks.length}`;

          const pageScopeLine =
            totalPages > 1 && pageMatch
              ? `Este fragmento es la página ${pageNum} de ${totalPages}. Extrae TODAS las filas Codigo/referencia de ESTA página, incluidas las últimas antes del pie de página, SUBTOTAL o TOTAL.`
              : "";

          const chunkBody = [
            `--- ${fragmentTitle} del ${args.sourceLabel} ---`,
            pageScopeLine,
            "Extrae las filas en el mismo orden en que aparecen en este fragmento (de arriba hacia abajo).",
            refsBultosOnly
              ? "Solo referencia y bultos por fila."
              : "Completá TODAS las columnas visibles por fila: referencia, descripcion, bultos, unidadesTotales o unidadesPorBulto, pesoPorBulto, genero/modelo si aplica.",
            "Si una fila queda cortada al inicio o al final del fragmento, solo complétala si el dato está explícito en este mismo fragmento.",
            "No omitas los últimos Codigo de la tabla de este fragmento.",
            chunk,
          ]
            .filter(Boolean)
            .join("\n\n");

          const userText = [intro, chunkBody].join("\n\n");
          const contents: GenContent[] = [
            ...args.historyContents,
            { role: "user", parts: [{ text: userText }] },
          ];

          let result = await extractOneChunk(contents);
          if (!result) {
            const retryContents: GenContent[] = [
              ...contents,
              { role: "user", parts: [{ text: CHUNK_INCOMPLETE_RETRY_PROMPT }] },
            ];
            result = await extractOneChunk(retryContents);
          }
          if (!result) {
            failedChunks.push(i + 1);
            logGeminiServerError("collection-order/gemini/chunk", new Error("chunk_extract_failed"), {
              model,
              chunk: i + 1,
              total: chunks.length,
            });
            return null;
          }

          if (isChunkLikelyIncomplete(chunk, result.lines)) {
            const estimate = estimateProductCodesInChunk(chunk);
            const refsMissing = estimate > result.lines.filter((l) => l.referencia).length;
            const retryHint = refsMissing
              ? estimate > 0
                ? `${CHUNK_INCOMPLETE_RETRY_PROMPT}\n\nEn este fragmento hay aproximadamente ${estimate} código(s) de producto visibles; devolvé una fila JSON por cada uno.`
                : CHUNK_INCOMPLETE_RETRY_PROMPT
              : CHUNK_FIELD_INCOMPLETE_RETRY_PROMPT;
            const retryContents: GenContent[] = [
              ...contents,
              { role: "user", parts: [{ text: retryHint }] },
            ];
            const retryResult = await extractOneChunk(retryContents);
            if (retryResult) {
              const retryBetter =
                retryResult.lines.length > result.lines.length ||
                (!refsMissing &&
                  retryResult.lines.length >= result.lines.length);
              if (retryBetter) {
                result = retryResult;
              } else {
                incompleteChunks.push(i + 1);
              }
            } else {
              incompleteChunks.push(i + 1);
            }
          }

          return { ...result, index: i };
        },
      );

      const sortedChunkResults = chunkResults
        .filter((r): r is ChunkExtractResult => r != null)
        .sort((a, b) => a.index - b.index);

      for (const result of sortedChunkResults) {
        allUsages.push(result.usage);
        mergedLines.push(...result.lines);
        if (result.reply) replyParts.push(result.reply);
      }

      if (incompleteChunks.length > 0) {
        replyParts.push(
          `[Advertencia: el fragmento ${incompleteChunks.join(", ")} puede tener referencias faltantes al final de la tabla. Revisá o reenviá solo esa página.]`,
        );
      }

      return { totalPlanned, truncated, failedChunks, splitByPages };
    };

    const buildChunkedReply = (args: {
      truncated: boolean;
      totalPlanned: number;
      failedChunks: number[];
      truncatedNote: string;
    }) => {
      let reply = replyParts.join("\n\n");
      if (args.truncated) {
        reply += `\n\n[Nota: ${args.truncatedNote} (${maxChunks}/${args.totalPlanned} fragmentos). ` +
          "Si faltan líneas al final, volvé a enviar solo las últimas páginas o dividí el documento.]";
      }
      if (args.failedChunks.length > 0) {
        reply +=
          `\n\n[Advertencia: no se pudieron interpretar ${args.failedChunks.length} fragmento(s): ${args.failedChunks.join(", ")}. ` +
          "Revisá si faltan referencias de esas secciones.]";
      }
      return reply;
    };

    // ——— PDF con texto: varias pasadas (Alde.IA general y «Leer documento») ———
    if (extractedPdfText && shouldUseChunkedPdfExtraction(extractedPdfText, minToSplit)) {
      applyDocumentChunkConfig(extractedPdfText);

      const historyContents = historyToContents(
        body.history,
        HISTORY_TURNS_CHUNK_MODE,
        HISTORY_TURN_MAX_CHARS_CHUNK,
      );

      const chunkMeta = await runChunkedExtraction({
        sourceLabel: "PDF (texto)",
        text: extractedPdfText,
        introLines: [
          ...preambleBase,
          tabularChunkHint,
          ...PDF_DOCUMENT_CHUNK_INTRO,
        ],
        historyContents,
      });

      const finalized = finalizeDocumentGeminiLines(
        mergeChunkedLines(mergedLines, chunkMeta.splitByPages),
        {
          extractMode: body.extractMode,
          pdfText: extractedPdfText,
        },
      );
      mergedLines = finalized.lines;
      processingMeta = attachPdfValidationToMeta(
        processingMeta,
        finalized.validation,
        pdfTextSource,
      );
      const usage = sumGeminiUsage(allUsages);
      const reply = buildChunkedReply({
        ...chunkMeta,
        truncatedNote: "el PDF superó el máximo de fragmentos en una solicitud",
      });

      if (mergedLines.length === 0 && chunkMeta.failedChunks.length > 0) {
        return NextResponse.json(
          {
            error:
              "No se pudieron extraer líneas del documento. Reintenta con «Nuevo chat» o dividí el PDF en partes más pequeñas.",
          },
          { status: 502 },
        );
      }

      return NextResponse.json({
        reply,
        usage,
        lines: mergedLines,
        processing: processingMeta,
      });
    }

    // ——— Texto largo sin archivo (pega Excel grande) ———
    if (!body.file && shouldChunkDocumentText(message, minToSplit)) {
      applyDocumentChunkConfig(message);

      const historyContents = historyToContents(
        body.history,
        HISTORY_TURNS_CHUNK_MODE,
        HISTORY_TURN_MAX_CHARS_CHUNK,
      );

      const chunkMeta = await runChunkedExtraction({
        sourceLabel: "mensaje",
        text: message,
        introLines: [
          `Quién escribe (sesión): ${preferredName}.`,
          body.orderNumber
            ? `Número de orden de recolección (contexto): ${body.orderNumber}.`
            : "",
          mergedContextHint ? `Contexto adicional:\n${mergedContextHint}` : "",
          "El mensaje se envía en fragmentos por tamaño. En cada fragmento extrae SOLO las filas visibles ahí.",
          'En "reply" máximo 2 frases por fragmento.',
        ],
        historyContents,
      });

      const finalizedMsg = finalizeDocumentGeminiLines(
        mergeChunkedLines(mergedLines, chunkMeta.splitByPages),
        {
          extractMode: body.extractMode,
          pdfText: message,
        },
      );
      mergedLines = finalizedMsg.lines;
      processingMeta = attachPdfValidationToMeta(
        processingMeta,
        finalizedMsg.validation,
        pdfTextSource,
      );
      const usage = sumGeminiUsage(allUsages);
      const reply = buildChunkedReply({
        ...chunkMeta,
        truncatedNote: "el texto superó el máximo de fragmentos",
      });

      if (mergedLines.length === 0 && chunkMeta.failedChunks.length > 0) {
        return NextResponse.json(
          {
            error:
              "No se pudieron extraer líneas del texto pegado. Enviá el contenido en partes más pequeñas.",
          },
          { status: 502 },
        );
      }

      return NextResponse.json({
        reply,
        usage,
        lines: mergedLines,
        processing: processingMeta,
      });
    }

    // ——— Una sola pasada (PDF corto, imagen, PDF binario, mensaje corto) ———
    const analysisText = extractedPdfText ?? message;
    if (analysisText.trim()) {
      applyDocumentChunkConfig(analysisText);
    } else if (fileSizeBytes) {
      applyDocumentChunkConfig(" ");
    }

    let preambleLines = [...preambleBase];
    if (pdfVisionSkippedForSpeed && extractedPdfText) {
      preambleLines = [
        ...preambleLines,
        "Este PDF se procesó como texto seleccionable (respuesta más rápida). Extrae líneas como siempre; si ves tablas algo rotas en el texto, infiere orden de columnas desde continuidad y encabezados.",
        "Si el PDF tiene varias páginas (marcadores --- PÁGINA N ---), procesa TODAS en orden numérico (1, 2, 3…); no omitas la última página ni alteres el orden entre páginas.",
        "--- Contenido del PDF ---",
        extractedPdfText,
      ];
    } else if (body.file?.base64 && mime === "application/pdf") {
      preambleLines = [
        ...preambleLines,
        "PDF adjunto como archivo: si tiene varias páginas, extrae líneas de TODAS las páginas en orden (página 1, luego 2, luego 3…), no solo la primera.",
        tabularChunkHint,
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
    const finalizedSingle = finalizeDocumentGeminiLines(trimmed, {
      extractMode: body.extractMode,
      pdfText: extractedPdfText,
    });
    const lines = finalizedSingle.lines;
    processingMeta = attachPdfValidationToMeta(
      processingMeta,
      finalizedSingle.validation,
      pdfTextSource,
    );
    const reply = typeof parsed.reply === "string" ? parsed.reply : "";
    const usage = usageFromGenAiResponse(response);

    return NextResponse.json({
      reply,
      usage,
      lines,
      processing: processingMeta,
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
