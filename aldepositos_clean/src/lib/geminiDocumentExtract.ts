import type { CollectionGeminiLine } from "@/lib/collectionOrderGeminiSchema";
import { postProcessGeminiExtractedLines } from "@/lib/collectionOrderGeminiPostProcess";
import { shouldChunkDocumentText } from "@/lib/geminiDocumentLimits";
import {
  countPdfPagesInText,
  detectPdfTotalPagesFromFooter,
} from "@/lib/geminiPdfPageText";
import {
  enrichGeminiLinesFromPdfText,
  estimateProductCodesInChunk,
  validatePdfExtraction,
  type PdfExtractionValidation,
} from "@/lib/geminiChunkCoverage";
import {
  isRefsBultosExtractMode,
  toRefsBultosOnlyLines,
  type GeminiExtractMode,
} from "@/lib/geminiRefsBultosMode";

export type { PdfExtractionValidation };

/** Intro compartido: extracción multipágina (Alde.IA general y «Leer documento»). */
export const PDF_DOCUMENT_CHUNK_INTRO = [
  "Este PDF tiene texto seleccionable. Se procesa por páginas o fragmentos para extraer TODAS las líneas sin omitir páginas finales.",
  "Los fragmentos se envían en orden de página (1, 2, 3…). Las filas finales deben quedar en ese mismo orden: primero página 1, luego 2, etc.",
  "En cada fragmento: extrae SOLO las filas de producto/referencia visibles en ese texto; no inventes filas de otras partes del PDF.",
  'En cada fila JSON completá referencia, descripcion, bultos, unidadesTotales o unidadesPorBulto, pesoPorBulto y demás columnas visibles; no devuelvas solo referencia.',
  'En "reply" máximo 1 frase por fragmento (español, operativo). Prioriza completar "lines".',
] as const;

export function shouldUseChunkedPdfExtraction(
  pdfText: string,
  minToSplit: number,
): boolean {
  const t = String(pdfText ?? "").trim();
  if (!t) return false;
  if (shouldChunkDocumentText(t, minToSplit)) return true;
  const pagesInText = countPdfPagesInText(t);
  const footerTotal = detectPdfTotalPagesFromFooter(t);
  if (pagesInText > 1) return true;
  if (footerTotal > 1) return true;
  if (footerTotal > pagesInText) return true;
  if (estimateProductCodesInChunk(t) >= 2) return true;
  return false;
}

export type FinalizeDocumentResult = {
  lines: CollectionGeminiLine[];
  validation: PdfExtractionValidation | null;
};

export function finalizeDocumentGeminiLines(
  lines: CollectionGeminiLine[],
  opts: {
    extractMode?: GeminiExtractMode;
    alreadyPostProcessed?: boolean;
    pdfText?: string | null;
  } = {},
): FinalizeDocumentResult {
  const refsBultosOnly = isRefsBultosExtractMode(opts.extractMode);
  const sourceText = String(opts.pdfText ?? "").trim();

  let processed = postProcessGeminiExtractedLines(lines);

  let validation: PdfExtractionValidation | null = null;

  if (sourceText) {
    processed = postProcessGeminiExtractedLines(
      enrichGeminiLinesFromPdfText(sourceText, processed, {
        fillRefsBultosFromPdf: true,
      }),
    );
    validation = validatePdfExtraction(sourceText, processed);
  }

  if (!refsBultosOnly) {
    return { lines: processed, validation };
  }
  return {
    lines: toRefsBultosOnlyLines(processed),
    validation,
  };
}
