/**
 * Proforma/facturas en PDF con texto seleccionable: extraer texto en servidor y
 * mandar solo texto a Gemini suele reducir mucho la latencia frente al PDF multimodal.
 * PDF escaneados devuelven poco texto → el caller debe volver al modo visión (binario).
 */

const PDF_TEXT_MIN_CHARS = 320;
const PDF_TEXT_MAX_CHARS = 72_000;

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
      let text = String(tr.text ?? "")
        .replace(/\u0000/g, "")
        .replace(/[ \t\f\v]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      /** Heurística simple: OCR/escaneo suele producir pocas palabras repetidas */
      const wordish = text.split(/\s+/).filter((w) => w.length > 1).length;
      if (
        text.length < PDF_TEXT_MIN_CHARS ||
        wordish < PDF_TEXT_MIN_CHARS / 14
      ) {
        return null;
      }

      if (text.length > PDF_TEXT_MAX_CHARS) {
        text =
          text.slice(0, PDF_TEXT_MAX_CHARS) +
          "\n\n[…contenido truncado para tiempo de respuesta — prioriza líneas ya visibles arriba…]";
      }
      return text;
    } finally {
      await parser.destroy();
    }
  } catch {
    return null;
  }
}
