/**
 * Proforma/facturas en PDF con texto seleccionable: extraer texto en servidor y
 * mandar solo texto a Gemini suele reducir mucho la latencia frente al PDF multimodal.
 * PDF escaneados devuelven poco texto → el caller debe volver al modo visión (binario).
 */

import { formatPdfPageBlock, joinPdfPageBlocks } from "@/lib/geminiPdfPageText";
import { PDF_TEXT_MIN_CHARS } from "@/lib/geminiDocumentLimits";

function normalizePdfText(raw: string): string {
  return raw
    .replace(/\u0000/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extrae texto plano útil para el modelo, o `null` si no conviene usar vía rápida.
 */
export async function extractPdfTextForGeminiFastPath(
  pdfBase64: string,
): Promise<string | null> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const buf = Buffer.from(pdfBase64, "base64");
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    try {
      const tr = await parser.getText();
      const pageBlocks: string[] = [];

      if (Array.isArray(tr.pages) && tr.pages.length > 0) {
        for (const page of tr.pages) {
          const block = formatPdfPageBlock(page.num, normalizePdfText(page.text ?? ""));
          if (block) pageBlocks.push(block);
        }
      }

      let text =
        pageBlocks.length > 0
          ? joinPdfPageBlocks(pageBlocks)
          : normalizePdfText(String(tr.text ?? ""));

      /** Heurística simple: OCR/escaneo suele producir pocas palabras repetidas */
      const wordish = text.split(/\s+/).filter((w) => w.length > 1).length;
      if (
        text.length < PDF_TEXT_MIN_CHARS ||
        wordish < PDF_TEXT_MIN_CHARS / 14
      ) {
        return null;
      }

      return text;
    } finally {
      await parser.destroy();
    }
  } catch {
    return null;
  }
}
