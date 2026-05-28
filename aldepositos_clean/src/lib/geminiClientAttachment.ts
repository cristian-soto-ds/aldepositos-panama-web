import { extractPdfTextInBrowser } from "@/lib/geminiClientPdfExtract";
import { prepareFilePayloadForGemini } from "@/lib/geminiClientImagePrep";
import type { GeminiAttachment } from "@/lib/geminiCollectionOrderApi";

const MAX_BINARY_UPLOAD_BYTES = 6 * 1024 * 1024;

/**
 * Prepara adjunto para Alde.IA: PDF con texto → solo texto; imágenes/PDF escaneado → archivo binario (multipart).
 */
export async function prepareGeminiAttachment(
  file: File,
  mimeType: string,
): Promise<GeminiAttachment> {
  const mime = (mimeType || file.type || "application/octet-stream").toLowerCase();

  if (mime === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const pdfText = await extractPdfTextInBrowser(file);
    if (pdfText) {
      return { mode: "pdfText", pdfText };
    }
    if (file.size > MAX_BINARY_UPLOAD_BYTES) {
      throw new Error(
        "El PDF supera 6 MB y no tiene texto seleccionable (escaneado). Dividí el archivo o exportá un PDF con texto.",
      );
    }
    return { mode: "file", file, mimeType: "application/pdf" };
  }

  if (!/^image\/(png|jpeg|webp)$/i.test(mime)) {
    if (file.size > MAX_BINARY_UPLOAD_BYTES) {
      throw new Error("El archivo supera el tamaño máximo (6 MB).");
    }
    return { mode: "file", file, mimeType: mime };
  }

  const optimized = await prepareFilePayloadForGemini(file, mime);
  const approxBytes = Math.ceil((optimized.base64.length * 3) / 4);
  if (approxBytes > MAX_BINARY_UPLOAD_BYTES) {
    throw new Error("La imagen optimizada sigue siendo demasiado grande (máx. 6 MB).");
  }

  const blob = await (
    await fetch(`data:${optimized.mimeType};base64,${optimized.base64}`)
  ).blob();
  const outFile = new File([blob], file.name || "imagen.jpg", {
    type: optimized.mimeType,
  });
  return { mode: "file", file: outFile, mimeType: optimized.mimeType };
}
