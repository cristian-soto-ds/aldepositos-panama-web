/**
 * Extrae texto de PDF en el navegador para no enviar el binario en base64 al API.
 * Misma heurística que `extractPdfTextForGeminiFastPath` en servidor.
 */

import { formatPdfPageBlock, joinPdfPageBlocks } from "@/lib/geminiPdfPageText";
import { PDF_TEXT_MIN_CHARS } from "@/lib/geminiDocumentLimits";

const BROWSER_EXTRACT_TIMEOUT_MS = 45_000;

function normalizePdfText(raw: string): string {
  return raw
    .replace(/\u0000/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isUsefulPdfText(text: string): boolean {
  const wordish = text.split(/\s+/).filter((w) => w.length > 1).length;
  return text.length >= PDF_TEXT_MIN_CHARS && wordish >= PDF_TEXT_MIN_CHARS / 14;
}

let workerSrcConfigured = false;

async function ensurePdfWorker(pdfjs: typeof import("pdfjs-dist")): Promise<void> {
  if (workerSrcConfigured || typeof window === "undefined") return;
  pdfjs.GlobalWorkerOptions.workerSrc = `${window.location.origin}/pdf.worker.min.mjs`;
  workerSrcConfigured = true;
}

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 40 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function extractPdfTextInBrowserCore(file: File): Promise<string | null> {
  const mime = (file.type || "").toLowerCase();
  if (mime !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return null;
  }

  const pdfjs = await import("pdfjs-dist");
  await ensurePdfWorker(pdfjs);

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

  const pageBlocks: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
      .join(" ");
    const block = formatPdfPageBlock(pageNum, normalizePdfText(pageText));
    if (block) pageBlocks.push(block);
    if (pageNum % 6 === 0) await yieldToMain();
  }

  await doc.destroy();

  const text = joinPdfPageBlocks(pageBlocks);
  if (!isUsefulPdfText(text)) return null;
  return text;
}

/**
 * Devuelve texto listo para `pdfText` en el API, o `null` si conviene enviar binario (escaneo).
 * Si la extracción en el navegador tarda demasiado, devuelve null y el servidor extrae el texto.
 */
export async function extractPdfTextInBrowser(file: File): Promise<string | null> {
  if (typeof window === "undefined") return null;

  try {
    return await Promise.race([
      extractPdfTextInBrowserCore(file),
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), BROWSER_EXTRACT_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  }
}
