import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { ALDEGPT_TERRA_DISPLAY_NAME } from "@/lib/aldeGptTerraBrand";
import {
  ALDEGPT_TERRA_DOCUMENT_INSTRUCTIONS,
  ALDEGPT_TERRA_REFS_BULTOS_INSTRUCTIONS,
  parseAldeGptTerraModelPayload,
  toRefsBultosOnlyTerraLines,
} from "@/lib/aldeGptTerraDocumentExtract";

export const runtime = "nodejs";
export const maxDuration = 120;

const CHAT_MODEL = "gpt-5.6-terra";
const MAX_HISTORY_TURNS = 24;
const MAX_MESSAGE_CHARS = 8_000;
/** Por archivo (OpenAI admite hasta 50 MB; dejamos margen). */
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_FILES = 8;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

const GENERAL_INSTRUCTIONS =
  "Eres un asistente de chat general, útil y claro. Responde en el mismo idioma en que te escriban (por defecto español). Sé conciso cuando baste y más detallado si te lo piden. No inventes hechos que no conozcas; si no estás seguro, dilo. " +
  'Tu salida debe ser un único objeto JSON válido con la forma {"reply":"<tu respuesta en texto para el usuario>","lines":[]}. Sin documento adjunto, lines debe ser [].';

/**
 * Configuración fija de AldeGpt Terra:
 * gpt-5.6-terra · JSON object · reasoning estándar/medio · verbosity media · summary auto · store on
 */
const ALDEGPT_TERRA_RESPONSE_OPTIONS = {
  model: CHAT_MODEL,
  store: true,
  // Packing lists grandes (50–100+ filas) necesitan salida larga; sin esto el modelo corta ~línea 48.
  max_output_tokens: 32_768,
  reasoning: {
    mode: "standard",
    effort: "medium",
    summary: "auto",
  },
  text: {
    format: { type: "json_object" as const },
    verbosity: "high" as const,
  },
};

type ChatMessage = { role: "user" | "assistant"; content: string };

type ContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_file"; file_id: string }
  | { type: "input_image"; file_id: string; detail: "auto" };

type ResponseInputItem =
  | { role: "user" | "assistant"; content: string }
  | { role: "user"; content: ContentPart[] };

function verifyUser(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return {
      error: NextResponse.json(
        { error: "Falta configuración de Supabase." },
        { status: 500 },
      ),
    };
  }
  const authHeader = request.headers.get("authorization");
  const token =
    authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return {
      error: NextResponse.json({ error: "Sin sesión." }, { status: 401 }),
    };
  }
  return { url, anonKey, token };
}

function normalizeHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw.slice(-MAX_HISTORY_TURNS)) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = String((item as { content?: unknown }).content ?? "").trim();
    if (!content) continue;
    if (role === "user" || role === "assistant") {
      out.push({
        role,
        content: content.slice(0, MAX_MESSAGE_CHARS),
      });
    }
  }
  return out;
}

function isImageMime(mime: string, filename: string): boolean {
  if (mime.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(filename);
}

/** OpenAI valida la extensión en minúsculas (rechaza `.PDF`). */
function normalizeOpenAiUploadFilename(name: string): string {
  const base = (name || "documento").slice(0, 180);
  const lastDot = base.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === base.length - 1) return base;
  return `${base.slice(0, lastDot)}${base.slice(lastDot).toLowerCase()}`;
}

/** Extrae el texto visible desde output JSON {"reply":...} o texto plano. */
function extractReplyText(raw: string): string {
  const { reply } = parseAldeGptTerraModelPayload(raw);
  return reply || String(raw ?? "").trim();
}

function parseExtractMode(raw: unknown): "full" | "refsBultosOnly" {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "refsbultosonly" || v === "refs_bultos_only" || v === "refs-bultos") {
    return "refsBultosOnly";
  }
  return "full";
}

async function parseRequest(request: NextRequest): Promise<{
  message: string;
  history: ChatMessage[];
  files: File[];
  extractMode: "full" | "refsBultosOnly";
}> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const message = String(form.get("message") ?? "").trim();
    const extractMode = parseExtractMode(form.get("extractMode"));
    let history: ChatMessage[] = [];
    const historyRaw = form.get("history");
    if (typeof historyRaw === "string" && historyRaw.trim()) {
      try {
        history = normalizeHistory(JSON.parse(historyRaw) as unknown);
      } catch {
        history = [];
      }
    }
    const files: File[] = [];
    for (const [key, value] of form.entries()) {
      if (key !== "file" && key !== "files" && !key.startsWith("file")) continue;
      if (value instanceof File && value.size > 0) files.push(value);
    }
    return { message, history, files, extractMode };
  }

  const body = (await request.json()) as {
    message?: string;
    history?: ChatMessage[];
    extractMode?: string;
  };
  return {
    message: String(body.message ?? "").trim(),
    history: normalizeHistory(body.history),
    files: [],
    extractMode: parseExtractMode(body.extractMode),
  };
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Falta OPENAI_API_KEY en el servidor (.env.local). Añade la clave de OpenAI solo en el servidor; nunca en el navegador.",
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

  let message: string;
  let history: ChatMessage[];
  let files: File[];
  let extractMode: "full" | "refsBultosOnly";
  try {
    ({ message, history, files, extractMode } = await parseRequest(request));
  } catch {
    return NextResponse.json(
      { error: "No se pudo leer la solicitud." },
      { status: 400 },
    );
  }

  message = message.slice(0, MAX_MESSAGE_CHARS);
  if (!message && files.length === 0) {
    return NextResponse.json(
      { error: "Escribe un mensaje o adjunta un documento." },
      { status: 400 },
    );
  }

  if (files.length > MAX_FILES) {
    return NextResponse.json(
      { error: `Máximo ${MAX_FILES} archivos por mensaje.` },
      { status: 400 },
    );
  }

  let totalBytes = 0;
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          error: `"${f.name || "archivo"}" supera el límite de ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB.`,
        },
        { status: 400 },
      );
    }
    totalBytes += f.size;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      {
        error: `El total de adjuntos supera ${Math.floor(MAX_TOTAL_BYTES / (1024 * 1024))} MB.`,
      },
      { status: 400 },
    );
  }

  const client = new OpenAI({ apiKey });
  const uploadedIds: string[] = [];

  try {
    const userContent: ContentPart[] = [];

    for (const file of files) {
      const filename = normalizeOpenAiUploadFilename(file.name || "documento");
      const mime = (file.type || "application/octet-stream").toLowerCase();
      const uploaded = await client.files.create({
        file: await toFile(file, filename, { type: mime }),
        purpose: "user_data",
      });
      uploadedIds.push(uploaded.id);

      if (isImageMime(mime, filename)) {
        userContent.push({
          type: "input_image",
          file_id: uploaded.id,
          detail: "auto",
        });
      } else {
        userContent.push({ type: "input_file", file_id: uploaded.id });
      }
    }

    const promptRaw =
      message ||
      (files.length === 1
        ? `Extrae las líneas del documento adjunto (${files[0]!.name || "archivo"}) según las reglas de recolección.`
        : `Extrae las líneas de los ${files.length} documentos adjuntos según las reglas de recolección.`);
    // OpenAI exige la palabra "json" en input messages cuando text.format = json_object.
    const prompt = /\bjson\b/i.test(promptRaw)
      ? promptRaw
      : `${promptRaw}\n\nResponde en JSON con las claves reply y lines.`;

    const instructions =
      files.length === 0
        ? GENERAL_INSTRUCTIONS
        : extractMode === "refsBultosOnly"
          ? ALDEGPT_TERRA_REFS_BULTOS_INSTRUCTIONS
          : ALDEGPT_TERRA_DOCUMENT_INSTRUCTIONS;

    const input: ResponseInputItem[] =
      files.length === 0
        ? [
            ...history.map((m) => ({ role: m.role, content: m.content })),
            { role: "user", content: prompt },
          ]
        : [
            ...history.map((m) => ({ role: m.role, content: m.content })),
            {
              role: "user",
              content: [...userContent, { type: "input_text", text: prompt }],
            },
          ];

    const response = await client.responses.create({
      ...ALDEGPT_TERRA_RESPONSE_OPTIONS,
      instructions,
      input,
    // Cast: `reasoning.mode` (standard) está en GPT-5.6; el tipado del SDK aún no lo incluye.
    } as OpenAI.Responses.ResponseCreateParamsNonStreaming);

    const rawOut = String(response.output_text ?? "");
    const parsed = parseAldeGptTerraModelPayload(rawOut);
    const lines =
      extractMode === "refsBultosOnly"
        ? toRefsBultosOnlyTerraLines(parsed.lines)
        : parsed.lines;
    const reply = parsed.reply;
    const finalReply =
      reply ||
      (lines.length > 0
        ? extractMode === "refsBultosOnly"
          ? `Se extrajeron ${lines.length} referencia(s) (solo código, bultos y reempaque).`
          : `Se extrajeron ${lines.length} fila(s) del documento.`
        : extractReplyText(rawOut));

    if (!finalReply && lines.length === 0) {
      return NextResponse.json(
        {
          error: `${ALDEGPT_TERRA_DISPLAY_NAME} no devolvió texto. Reintenta en unos segundos.`,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      reply: finalReply,
      lines,
      extractMode,
    });
  } catch (e) {
    const status =
      e && typeof e === "object" && "status" in e
        ? Number((e as { status?: unknown }).status)
        : undefined;
    const msg =
      e instanceof Error
        ? e.message
        : `Error inesperado al comunicar con ${ALDEGPT_TERRA_DISPLAY_NAME}.`;

    if (status === 401 || status === 403) {
      return NextResponse.json(
        {
          error:
            "OpenAI rechazó la clave o el acceso. Revisa OPENAI_API_KEY en el servidor.",
        },
        { status: 403 },
      );
    }
    if (status === 429) {
      return NextResponse.json(
        {
          error:
            "Se alcanzó el límite de uso de OpenAI. Espera un momento e inténtalo de nuevo.",
        },
        { status: 429 },
      );
    }

    console.error("[api/chat]", msg);
    return NextResponse.json(
      {
        error:
          msg || `No se pudo obtener respuesta de ${ALDEGPT_TERRA_DISPLAY_NAME}.`,
      },
      { status: status && status >= 400 && status < 600 ? status : 502 },
    );
  } finally {
    await Promise.all(
      uploadedIds.map((id) =>
        client.files.delete(id).catch(() => {
          /* limpieza best-effort */
        }),
      ),
    );
  }
}
