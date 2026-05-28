/**
 * Extrae texto de PDF en el navegador para no enviar el binario en base64 al API.
 * Misma heurística que `extractPdfTextForGeminiFastPath` en servidor.
 */

const PDF_TEXT_MIN_CHARS = 320;
const PDF_TEXT_MAX_CHARS = 650_000;

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
  const version = pdfjs.version || "5.5.207";
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
  workerSrcConfigured = true;
}

/**
 * Devuelve texto listo para `pdfText` en el API, o `null` si conviene enviar binario (escaneo).
 */
export async function extractPdfTextInBrowser(file: File): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const mime = (file.type || "").toLowerCase();
  if (mime !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return null;
  }

  try {
    const pdfjs = await import("pdfjs-dist");
    await ensurePdfWorker(pdfjs);

    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;

    const parts: string[] = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
        .join(" ");
      if (pageText.trim()) parts.push(pageText);
    }

    await doc.destroy();

    let text = normalizePdfText(parts.join("\n\n"));
    if (!isUsefulPdfText(text)) return null;

    if (text.length > PDF_TEXT_MAX_CHARS) {
      text =
        text.slice(0, PDF_TEXT_MAX_CHARS) +
        "\n\n[…contenido truncado — prioriza líneas ya visibles arriba…]";
    }
    return text;
  } catch {
    return null;
  }
}
