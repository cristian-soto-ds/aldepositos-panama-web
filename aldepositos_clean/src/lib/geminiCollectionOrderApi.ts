import { fetchWithTimeout } from "@/lib/clientFetch";
import { CLIENT_MAX_TIMEOUT_MS, geminiClientTimeoutMs } from "@/lib/geminiDocumentLimits";

export type CollectionOrderGeminiHistoryTurn = {
  role: "user" | "model";
  text: string;
};

export type GeminiAttachment =
  | { mode: "pdfText"; pdfText: string }
  | {
      mode: "pdfWithFile";
      file: File;
      pdfText?: string;
      mimeType: string;
      isPdf?: boolean;
    }
  | { mode: "file"; file: File; mimeType: string; isPdf?: boolean };

export type CollectionOrderGeminiRequestPayload = {
  message: string;
  history: CollectionOrderGeminiHistoryTurn[];
  orderNumber?: string;
  contextHint?: string;
  viewerDisplayName?: string;
  attachment?: GeminiAttachment;
  /** Solo referencias y bultos (botón «Leer documento»). Mismo pipeline multipágina que Alde.IA general. */
  extractMode?: "full" | "refsBultosOnly";
};

const GEMINI_API_PATH = "/api/collection-order/gemini";

const RETRYABLE = new Set([408, 429, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveTimeoutMs(payload: CollectionOrderGeminiRequestPayload): number {
  const { attachment, message } = payload;
  if (attachment?.mode === "pdfText") {
    return geminiClientTimeoutMs({ pdfText: attachment.pdfText });
  }
  if (attachment?.mode === "pdfWithFile") {
    return geminiClientTimeoutMs({
      pdfText: attachment.pdfText,
      hasBinaryFile: true,
      isPdf: true,
      fileSizeBytes: attachment.file.size,
    });
  }
  if (attachment?.mode === "file") {
    return geminiClientTimeoutMs({
      hasBinaryFile: true,
      isPdf: attachment.isPdf ?? attachment.mimeType === "application/pdf",
      fileSizeBytes: attachment.file.size,
    });
  }
  return geminiClientTimeoutMs({ message });
}

function timeoutReasonForMs(timeoutMs: number, isPdfFile?: boolean): string {
  if (timeoutMs >= CLIENT_MAX_TIMEOUT_MS - 5_000) {
    return "Alde.IA está procesando un documento muy extenso (casi 5 min). Esperá un poco más o dividí el PDF en dos partes.";
  }
  if (timeoutMs >= 200_000) {
    return "Alde.IA está procesando un documento extenso. Esperá un poco más; no cierres la pestaña.";
  }
  if (isPdfFile) {
    return "Alde.IA tardó demasiado con el PDF. Reintenta; si persiste, dividí el archivo en partes más pequeñas.";
  }
  return "Alde.IA tardó demasiado en analizar el documento. Reintenta en unos segundos.";
}

async function callOnce(
  token: string,
  payload: CollectionOrderGeminiRequestPayload,
): Promise<Response> {
  const { attachment, ...rest } = payload;
  const timeoutMs = resolveTimeoutMs(payload);
  const isPdfFile =
    attachment?.mode === "file" || attachment?.mode === "pdfWithFile"
      ? attachment.isPdf ?? attachment.mimeType === "application/pdf"
      : false;
  const timeoutReason = timeoutReasonForMs(timeoutMs, isPdfFile);

  if (attachment?.mode === "pdfText") {
    return fetchWithTimeout(GEMINI_API_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ...rest, pdfText: attachment.pdfText }),
      timeoutMs,
      timeoutReason,
    });
  }

  if (attachment?.mode === "pdfWithFile") {
    const fd = new FormData();
    const payloadJson: Record<string, unknown> = { ...rest };
    if (attachment.pdfText?.trim()) {
      payloadJson.pdfText = attachment.pdfText.trim();
    }
    fd.append("payload", JSON.stringify(payloadJson));
    fd.append("file", attachment.file, attachment.file.name || "documento.pdf");
    return fetchWithTimeout(GEMINI_API_PATH, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
      timeoutMs,
      timeoutReason,
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
      timeoutMs,
      timeoutReason,
    });
  }

  return fetchWithTimeout(GEMINI_API_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(rest),
    timeoutMs,
    timeoutReason,
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
