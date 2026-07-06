import type { CollectionGeminiLine } from "@/lib/collectionOrderGeminiSchema";
import {
  isJeancenterInvoiceText,
  jeancenterRowToGeminiLine,
  parseJeancenterRowsFromPdfText,
  type JeancenterInvoiceRow,
} from "@/lib/geminiJeancenterInvoiceParse";
import {
  isTabularInvoiceText,
  parseTabularRowsFromPdfText,
  tabularRowToGeminiLine,
  type TabularInvoiceRow,
} from "@/lib/geminiTabularInvoiceParse";

/** Códigos JEANCENTER: #####-##### con sufijo opcional. */
const JEANCENTER_CODE_RE = /\b(\d{5}-\d{5}(?:-[A-Z0-9][\w-]*)?)\b/gi;
/** Referencias puntomoda / similares. */
const PUNTOMODA_CODE_RE = /\b([BJ]-\d{4,}[\w-]*)\b/gi;
const JN_CODE_RE = /\b(JN-\d{3,}[\w-]*)\b/gi;

const CODE_PATTERNS = [JEANCENTER_CODE_RE, PUNTOMODA_CODE_RE, JN_CODE_RE];

export type PdfBackboneRow = JeancenterInvoiceRow | TabularInvoiceRow | RefBultosBackbone;

type RefBultosBackbone = { referencia: string; bultos: string };

function normalizeRef(ref: unknown): string {
  return String(ref ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function hasField(v: unknown): boolean {
  return String(v ?? "").trim().length > 0;
}

/**
 * Lista ordenada de códigos de producto visibles en el texto PDF (sin duplicar).
 */
export function extractProductCodesInOrder(text: string): string[] {
  const hits: { code: string; index: number }[] = [];
  const seen = new Set<string>();
  const t = String(text ?? "");

  for (const re of CODE_PATTERNS) {
    re.lastIndex = 0;
    for (const m of t.matchAll(re)) {
      const code = normalizeRef(m[1]);
      const index = m.index ?? 0;
      if (!code || seen.has(code)) continue;
      seen.add(code);
      hits.push({ code, index });
    }
  }

  hits.sort((a, b) => a.index - b.index);
  return hits.map((h) => h.code);
}

export function estimateProductCodesInChunk(text: string): number {
  return extractProductCodesInOrder(text).length;
}

export function countExtractedReferencias(lines: CollectionGeminiLine[]): number {
  return lines.filter((l) => String(l.referencia ?? "").trim()).length;
}

function isJeancenterBackboneRow(row: PdfBackboneRow): row is JeancenterInvoiceRow {
  return /^\d{5}-\d{5}/.test(row.referencia);
}

function isTabularBackboneRow(row: PdfBackboneRow): row is TabularInvoiceRow {
  return /^[BJ]-\d/.test(row.referencia) || /^JN-/.test(row.referencia);
}

function backboneRowToGeminiLine(row: PdfBackboneRow, pdfText: string): CollectionGeminiLine {
  if (isJeancenterBackboneRow(row)) {
    return jeancenterRowToGeminiLine(row);
  }
  if (isTabularBackboneRow(row)) {
    return tabularRowToGeminiLine(row);
  }
  return {
    referencia: row.referencia,
    bultos: row.bultos || extractBultosNearCode(pdfText, row.referencia),
  };
}

function pdfRowHasCriticalFields(row: PdfBackboneRow): boolean {
  if (!hasField(row.bultos)) return false;
  if ("descripcion" in row && hasField(row.descripcion)) return true;
  if ("pesoPorBulto" in row && hasField(row.pesoPorBulto)) return true;
  if ("unidadesTotales" in row && hasField(row.unidadesTotales)) return true;
  return hasField(row.bultos);
}

export function isLineFieldIncomplete(
  line: CollectionGeminiLine,
  pdfRow?: PdfBackboneRow,
): boolean {
  if (!pdfRow || !pdfRowHasCriticalFields(pdfRow)) return false;
  const parsed = backboneRowToGeminiLine(pdfRow, "");
  if (hasField(parsed.bultos) && !hasField(line.bultos)) return true;
  if (hasField(parsed.descripcion) && !hasField(line.descripcion)) return true;
  if (hasField(parsed.pesoPorBulto) && !hasField(line.pesoPorBulto)) return true;
  if (
    hasField(parsed.unidadesTotales) &&
    !hasField(line.unidadesTotales) &&
    !hasField(line.unidadesPorBulto)
  ) {
    return true;
  }
  return false;
}

function countIncompleteLinesInChunk(
  chunkText: string,
  extractedLines: CollectionGeminiLine[],
): number {
  const backbone = resolvePdfBackbone(chunkText);
  if (backbone.length === 0) return 0;
  const byRef = new Map<string, CollectionGeminiLine>();
  for (const line of extractedLines) {
    const ref = normalizeRef(line.referencia);
    if (ref) byRef.set(ref, line);
  }
  let incomplete = 0;
  for (const row of backbone) {
    const ref = normalizeRef(row.referencia);
    const gemini = byRef.get(ref);
    if (!gemini || isLineFieldIncomplete(gemini, row)) incomplete += 1;
  }
  return incomplete;
}

export function isChunkLikelyIncomplete(
  chunkText: string,
  extractedLines: CollectionGeminiLine[],
): boolean {
  const estimated = estimateProductCodesInChunk(chunkText);
  if (estimated < 1) return false;
  const extracted = countExtractedReferencias(extractedLines);
  if (extracted < estimated) return true;
  const incompleteFields = countIncompleteLinesInChunk(chunkText, extractedLines);
  if (incompleteFields > 0 && extracted >= estimated) return true;
  return false;
}

/** Lee «No. de Cartones: 112» del pie de factura JEANCENTER. */
export function detectCartonesFromPdfFooter(text: string): number | null {
  const m = /\bNo\.?\s*de\s*Cartones\s*:?\s*([\d.,]+)/i.exec(String(text ?? ""));
  if (!m?.[1]) return null;
  const n = Number(String(m[1]).replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function sumBultosInLines(lines: CollectionGeminiLine[]): number {
  let sum = 0;
  for (const line of lines) {
    const n = Number(String(line.bultos ?? "").replace(/,/g, "").trim());
    if (Number.isFinite(n) && n > 0) sum += n;
  }
  return sum;
}

export type PdfExtractionValidation = {
  pdfCodesFound: number;
  cartonesFooter: number | null;
  bultosSum: number;
  extractionIncomplete: boolean;
  linesWithMissingFields?: number;
  incompleteReason?: string;
};

function countLinesWithMissingFields(
  pdfText: string,
  lines: CollectionGeminiLine[],
): number {
  const backbone = resolvePdfBackbone(pdfText);
  if (backbone.length === 0) return 0;
  const byRef = new Map<string, CollectionGeminiLine>();
  for (const line of lines) {
    const ref = normalizeRef(line.referencia);
    if (ref) byRef.set(ref, line);
  }
  let missing = 0;
  for (const row of backbone) {
    const ref = normalizeRef(row.referencia);
    const gemini = byRef.get(ref);
    if (!gemini || isLineFieldIncomplete(gemini, row)) missing += 1;
  }
  return missing;
}

export function validatePdfExtraction(
  pdfText: string,
  lines: CollectionGeminiLine[],
): PdfExtractionValidation {
  const pdfCodesFound = extractProductCodesInOrder(pdfText).length;
  const jeancenterRows = parseJeancenterRowsFromPdfText(pdfText);
  const tabularRows = parseTabularRowsFromPdfText(pdfText);
  const backboneLen = Math.max(
    jeancenterRows.length,
    tabularRows.length,
    pdfCodesFound,
  );
  const expectedCodes = backboneLen;
  const cartonesFooter = detectCartonesFromPdfFooter(pdfText);
  const bultosSum = sumBultosInLines(lines);
  const linesWithMissingFields = countLinesWithMissingFields(pdfText, lines);

  let extractionIncomplete = false;
  let incompleteReason: string | undefined;

  if (expectedCodes > 0 && countExtractedReferencias(lines) < expectedCodes) {
    extractionIncomplete = true;
    incompleteReason = `Faltan referencias (${countExtractedReferencias(lines)}/${expectedCodes}).`;
  }
  if (linesWithMissingFields > 0) {
    extractionIncomplete = true;
    incompleteReason =
      (incompleteReason ? `${incompleteReason} ` : "") +
      `Faltan campos en ${linesWithMissingFields} fila(s) (bultos, descripción o peso).`;
  }
  if (
    cartonesFooter != null &&
    bultosSum > 0 &&
    Math.abs(bultosSum - cartonesFooter) > 2
  ) {
    extractionIncomplete = true;
    incompleteReason =
      (incompleteReason ? `${incompleteReason} ` : "") +
      `Suma bultos (${bultosSum}) no coincide con No. de Cartones (${cartonesFooter}).`;
  }

  return {
    pdfCodesFound: Math.max(pdfCodesFound, jeancenterRows.length, tabularRows.length),
    cartonesFooter,
    bultosSum,
    extractionIncomplete,
    linesWithMissingFields,
    incompleteReason,
  };
}

/** Intenta leer bultos junto al código en texto PDF aplanado (factura JEANCENTER). */
export function extractBultosNearCode(text: string, code: string): string {
  const upper = text.toUpperCase();
  const codeUpper = normalizeRef(code);
  const idx = upper.indexOf(codeUpper);
  if (idx < 0) return "";

  const slice = text.slice(idx, idx + 450);
  const tail = slice.slice(code.length);

  const pza = tail.match(/\b(\d{1,3})\s+\d{2,5}\s+PZA\.?\b/i);
  if (pza?.[1]) return pza[1];

  const doz = tail.match(/\b(\d{1,3})\s+[\d.,]+\s+DOZ\.?\b/i);
  if (doz?.[1]) return doz[1];

  const firstSmall = tail.match(/\b([1-9]\d{0,2})\b/);
  return firstSmall?.[1] ?? "";
}

function pickFilled(primary: unknown, fallback: unknown): string {
  const a = String(primary ?? "").trim();
  if (a) return a;
  return String(fallback ?? "").trim();
}

function mergeGeminiWithParsedRow(
  gemini: CollectionGeminiLine | undefined,
  parsed: PdfBackboneRow,
  pdfText: string,
  fillRefsBultos: boolean,
): CollectionGeminiLine {
  const code = parsed.referencia;
  const parsedGemini = backboneRowToGeminiLine(parsed, pdfText);

  const base = gemini ? { ...gemini } : {};
  const merged: CollectionGeminiLine = {
    ...base,
    referencia: code,
    bultos: pickFilled(base.bultos, parsedGemini.bultos),
    descripcion: pickFilled(base.descripcion, parsedGemini.descripcion),
    unidadesTotales: pickFilled(base.unidadesTotales, parsedGemini.unidadesTotales),
    unidadesPorBulto: pickFilled(base.unidadesPorBulto, parsedGemini.unidadesPorBulto),
    pesoPorBulto: pickFilled(base.pesoPorBulto, parsedGemini.pesoPorBulto),
    modelo: pickFilled(base.modelo, parsedGemini.modelo),
    genero: pickFilled(base.genero, parsedGemini.genero),
    paisOrigen: pickFilled(base.paisOrigen, parsedGemini.paisOrigen),
    tejido: pickFilled(base.tejido, parsedGemini.tejido),
    talla: pickFilled(base.talla, parsedGemini.talla),
    composicion: pickFilled(base.composicion, parsedGemini.composicion),
  };

  if (fillRefsBultos) {
    if (!String(merged.referencia ?? "").trim()) merged.referencia = code;
    if (!String(merged.bultos ?? "").trim()) {
      merged.bultos =
        parsedGemini.bultos || extractBultosNearCode(pdfText, code);
    }
  }

  return merged;
}

function resolvePdfBackbone(pdfText: string): PdfBackboneRow[] {
  if (isJeancenterInvoiceText(pdfText)) {
    const rows = parseJeancenterRowsFromPdfText(pdfText);
    if (rows.length >= 1) return rows;
  }
  if (isTabularInvoiceText(pdfText)) {
    const rows = parseTabularRowsFromPdfText(pdfText);
    if (rows.length >= 1) return rows;
  }
  return extractProductCodesInOrder(pdfText).map((code) => ({
    referencia: code,
    bultos: extractBultosNearCode(pdfText, code),
  }));
}

/**
 * Enriquece líneas Gemini con backbone determinístico del PDF (orden canónico).
 */
export function enrichGeminiLinesFromPdfText(
  pdfText: string,
  lines: CollectionGeminiLine[],
  opts?: { fillRefsBultosFromPdf?: boolean },
): CollectionGeminiLine[] {
  return reconcileGeminiLinesWithPdfText(pdfText, lines, opts);
}

/**
 * Completa referencias y campos faltantes usando texto PDF (parsers JEANCENTER/tabular).
 */
export function reconcileGeminiLinesWithPdfText(
  pdfText: string,
  lines: CollectionGeminiLine[],
  opts?: { fillRefsBultosFromPdf?: boolean },
): CollectionGeminiLine[] {
  const backbone = resolvePdfBackbone(pdfText);
  if (backbone.length === 0) return lines;

  const fillRefsBultos = opts?.fillRefsBultosFromPdf === true;
  const byRef = new Map<string, CollectionGeminiLine>();
  for (const line of lines) {
    const ref = normalizeRef(line.referencia);
    if (ref && !byRef.has(ref)) byRef.set(ref, line);
  }

  const result: CollectionGeminiLine[] = [];
  const used = new Set<string>();

  for (const parsed of backbone) {
    const code = parsed.referencia;
    const existing = byRef.get(code);
    result.push(
      mergeGeminiWithParsedRow(existing, parsed, pdfText, fillRefsBultos),
    );
    used.add(code);
  }

  for (const line of lines) {
    const ref = normalizeRef(line.referencia);
    if (ref && !used.has(ref)) result.push(line);
  }

  return result;
}
