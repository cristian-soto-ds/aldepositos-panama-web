import type { CollectionGeminiLine } from "@/lib/collectionOrderGeminiSchema";

const JEANCENTER_CODE_RE = /\b(\d{5}-\d{5}(?:-[A-Z0-9][\w-]*)?)\b/gi;

/** Fila típica JEANCENTER: Codigo … Bultos … NNN PZA */
const JEANCENTER_ROW_RE =
  /\b(\d{5}-\d{5}(?:-[A-Z0-9][\w-]*)?)\b[\s\S]{0,400}?\b(\d{1,3})\s+(\d{2,5})\s+PZA\.?\b/gi;

const MARCA_SUFFIX_RE =
  /\s+(MOST WANTED|MISS CALIFORNIA|BONGO(?:\s+JEANS)?)\s*$/i;
const GENERO_RE = /\b(DAMA|CABALLERO|NIÑ[OA]|MAMA|BEB[EÉ])\b/i;

const PZA_TAIL_RE = /\b(\d{1,3})\s+(\d{2,5})\s+PZA\.?\b/i;
const PZAS_TAIL_RE = /\b(\d{1,3})\s+(\d{2,5})\s+PZAS?\.?\b/i;

export type JeancenterInvoiceRow = {
  referencia: string;
  bultos: string;
  descripcion?: string;
  unidadesTotales?: string;
  unidadesPorBulto?: string;
  pesoPorBulto?: string;
  modelo?: string;
  genero?: string;
};

function normalizeRef(ref: string): string {
  return ref.trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeDecimal(raw: string): string {
  const n = parseFloat(String(raw ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(n);
}

function deriveUnidadesPorBulto(bultos: string, unidadesTotales: string): string {
  const b = Number(bultos);
  const t = Number(unidadesTotales);
  if (!Number.isFinite(b) || b <= 0 || !Number.isFinite(t) || t <= 0) return "";
  const und = t / b;
  if (Math.abs(und - Math.round(und)) < 1e-3) return String(Math.round(und));
  const rounded = Math.round(und * 1e6) / 1e6;
  return String(rounded);
}

function countDistinctJeancenterCodes(text: string): number {
  const seen = new Set<string>();
  JEANCENTER_CODE_RE.lastIndex = 0;
  for (const m of text.matchAll(JEANCENTER_CODE_RE)) {
    const ref = normalizeRef(m[1] ?? "");
    if (ref) seen.add(ref);
  }
  return seen.size;
}

function splitJeancenterDescripcion(raw: string): {
  descripcion: string;
  modelo: string;
  genero: string;
} {
  let t = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!t) return { descripcion: "", modelo: "", genero: "" };

  const generoMatch = GENERO_RE.exec(t);
  const genero = generoMatch?.[1]?.toUpperCase() ?? "";

  let modelo = "";
  const marcaMatch = MARCA_SUFFIX_RE.exec(t);
  if (marcaMatch) {
    modelo = marcaMatch[1]!.trim().toUpperCase();
    t = t.slice(0, marcaMatch.index).trim();
  }

  let descripcion = t;
  if (genero) {
    descripcion = descripcion
      .replace(new RegExp(`\\b${genero}\\b`, "i"), " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return { descripcion, modelo, genero };
}

function extractPzaMatch(tail: string): RegExpExecArray | null {
  return PZA_TAIL_RE.exec(tail) ?? PZAS_TAIL_RE.exec(tail);
}

function parseJeancenterRowSlice(ref: string, slice: string): JeancenterInvoiceRow {
  const row: JeancenterInvoiceRow = { referencia: ref, bultos: "" };
  const upper = slice.toUpperCase();
  const refUpper = ref.toUpperCase();
  const refIdx = upper.indexOf(refUpper);
  const tail = refIdx >= 0 ? slice.slice(refIdx + ref.length) : slice;

  const pza = extractPzaMatch(tail);
  if (pza) {
    row.bultos = pza[1]!.trim();
    row.unidadesTotales = pza[2]!.trim();
    const afterPza = tail.slice((pza.index ?? 0) + pza[0].length);
    const pesoAfter = /^\s*([\d.,]+)/.exec(afterPza);
    if (pesoAfter?.[1]) row.pesoPorBulto = normalizeDecimal(pesoAfter[1]);
  }

  if (!row.bultos) {
    const doz = /\b(\d{1,3})\s+[\d.,]+\s+DOZ\.?\b/i.exec(tail);
    if (doz?.[1]) row.bultos = doz[1].trim();
  }

  if (!row.bultos) {
    const bultosCol = /\bBultos?\s*:?\s*(\d{1,3})\b/i.exec(slice);
    if (bultosCol?.[1]) row.bultos = bultosCol[1].trim();
  }

  const pesoB =
    /Peso\s*B\.?\s*:?\s*([\d.,]+)/i.exec(slice) ??
    /Peso\s*B\s+([\d.,]+)/i.exec(slice);
  if (!row.pesoPorBulto && pesoB?.[1]) {
    row.pesoPorBulto = normalizeDecimal(pesoB[1]);
  }

  if (pza?.index != null && pza.index > 0) {
    const descRaw = tail.slice(0, pza.index).replace(/\s+/g, " ").trim();
    const { descripcion, modelo, genero } = splitJeancenterDescripcion(descRaw);
    if (descripcion) row.descripcion = descripcion;
    if (modelo) row.modelo = modelo;
    if (genero) row.genero = genero;
  } else if (!row.descripcion) {
    const descBeforePeso = /^(.+?)(?:\s+Peso\s*B|$)/is.exec(
      tail.replace(/\s+/g, " ").trim(),
    );
    if (descBeforePeso?.[1]) {
      const { descripcion, modelo, genero } = splitJeancenterDescripcion(
        descBeforePeso[1],
      );
      if (descripcion) row.descripcion = descripcion;
      if (modelo) row.modelo = modelo;
      if (genero) row.genero = genero;
    }
  }

  if (row.bultos && row.unidadesTotales) {
    row.unidadesPorBulto = deriveUnidadesPorBulto(row.bultos, row.unidadesTotales);
  }

  return row;
}

/** Detecta facturas JEANCENTER o tablas con códigos #####-##### (≥2 códigos). */
export function isJeancenterInvoiceText(text: string): boolean {
  const t = String(text ?? "");
  if (/JEANCENTER/i.test(t)) return true;
  if (/\bCodigo\b/i.test(t) && /\bBultos\b/i.test(t) && countDistinctJeancenterCodes(t) >= 1) {
    return true;
  }
  return countDistinctJeancenterCodes(t) >= 2;
}

/**
 * Parser determinístico de filas JEANCENTER: referencia, bultos, descripción, unidades y peso.
 */
export function parseJeancenterRowsFromPdfText(text: string): JeancenterInvoiceRow[] {
  if (!isJeancenterInvoiceText(text)) return [];

  const t = String(text ?? "");
  const codeHits: { ref: string; index: number }[] = [];
  const seenCodes = new Set<string>();

  JEANCENTER_CODE_RE.lastIndex = 0;
  for (const m of t.matchAll(JEANCENTER_CODE_RE)) {
    const ref = normalizeRef(m[1] ?? "");
    const index = m.index ?? 0;
    if (!ref || seenCodes.has(ref)) continue;
    seenCodes.add(ref);
    codeHits.push({ ref, index });
  }

  if (codeHits.length >= 1) {
    return codeHits.map(({ ref, index }, i) => {
      const end =
        i + 1 < codeHits.length ? codeHits[i + 1]!.index : index + 800;
      const slice = t.slice(index, Math.min(end, index + 800));
      return parseJeancenterRowSlice(ref, slice);
    });
  }

  const rows: JeancenterInvoiceRow[] = [];
  const seen = new Set<string>();

  JEANCENTER_ROW_RE.lastIndex = 0;
  for (const m of t.matchAll(JEANCENTER_ROW_RE)) {
    const ref = normalizeRef(m[1] ?? "");
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    const idx = m.index ?? 0;
    const slice = t.slice(idx, idx + 800);
    rows.push(parseJeancenterRowSlice(ref, slice));
  }

  return rows;
}

export function jeancenterRowToGeminiLine(row: JeancenterInvoiceRow): CollectionGeminiLine {
  const line: CollectionGeminiLine = {
    referencia: row.referencia,
    bultos: row.bultos,
  };
  if (row.descripcion) line.descripcion = row.descripcion;
  if (row.unidadesTotales) line.unidadesTotales = row.unidadesTotales;
  if (row.unidadesPorBulto) line.unidadesPorBulto = row.unidadesPorBulto;
  if (row.pesoPorBulto) line.pesoPorBulto = row.pesoPorBulto;
  if (row.modelo) line.modelo = row.modelo;
  if (row.genero) line.genero = row.genero;
  return line;
}

export function jeancenterRowsToGeminiLines(
  rows: JeancenterInvoiceRow[],
): CollectionGeminiLine[] {
  return rows.map(jeancenterRowToGeminiLine);
}
