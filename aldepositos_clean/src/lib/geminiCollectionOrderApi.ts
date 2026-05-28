import { fetchWithTimeout } from "@/lib/clientFetch";

export type CollectionOrderGeminiHistoryTurn = {
  role: "user" | "model";
  text: string;
};

export type GeminiAttachment =
  | { mode: "pdfText"; pdfText: string }
  | { mode: "file"; file: File; mimeType: string };

export type CollectionOrderGeminiRequestPayload = {
  message: string;
  history: CollectionOrderGeminiHistoryTurn[];
  orderNumber?: string;
  contextHint?: string;
  viewerDisplayName?: string;
  attachment?: GeminiAttachment;
};

const GEMINI_API_PATH = "/api/collection-order/gemini";

/** JSON liviano (solo texto extraído del PDF). */
const JSON_TIMEOUT_MS = 120_000;
/** Subida binaria vía multipart (sin base64 inflado en JSON). */
const MULTIPART_TIMEOUT_MS = 180_000;

const RETRYABLE = new Set([408, 429, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function callOnce(
  token: string,
  payload: CollectionOrderGeminiRequestPayload,
): Promise<Response> {
  const { attachment, ...rest } = payload;

  if (attachment?.mode === "pdfText") {
    return fetchWithTimeout(GEMINI_API_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...rest, pdfText: attachment.pdfText }),
      timeoutMs: JSON_TIMEOUT_MS,
      timeoutReason:
        "Alde.IA tardó demasiado en analizar el documento. Reintenta en unos segundos.",
    });
  }

  if (attachment?.mode === "file") {
    const fd = new FormData();
    fd.append("payload", JSON.stringify(rest));
    fd.append("file", attachment.file, attachment.file.name || "documento.pdf");
    return fetchWithTimeout(GEMINI_API_PATH, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
      timeoutMs: MULTIPART_TIMEOUT_MS,
      timeoutReason:
        "La subida del archivo tardó demasiado. Si es un PDF con texto, debería enviarse solo el texto; reintenta o divide el PDF.",
    });
  }

  return fetchWithTimeout(GEMINI_API_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(rest),
    timeoutMs: JSON_TIMEOUT_MS,
    timeoutReason: "Alde.IA tardó demasiado. Reintenta en unos segundos.",
  });
}

/** POST con reintentos en errores transitorios del gateway. */
export async function postCollectionOrderGemini(
  token: string,
  payload: CollectionOrderGeminiRequestPayload,
): Promise<Response> {
  let res = await callOnce(token, payload);
  if (RETRYABLE.has(res.status)) {
    await sleep(1700);
    res = await callOnce(token, payload);
  }
  if (RETRYABLE.has(res.status)) {
    await sleep(3000);
    res = await callOnce(token, payload);
  }
  return res;
}
