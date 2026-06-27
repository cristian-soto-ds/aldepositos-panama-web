import type { CollectionGeminiLine } from "@/lib/collectionOrderGeminiSchema";
import type { GeminiTokenUsage } from "@/lib/geminiClientUsage";
import { splitTextByPdfPages } from "@/lib/geminiPdfPageText";

/** Normaliza campos string como en la ruta API. */
export function trimGeminiLine(row: CollectionGeminiLine): CollectionGeminiLine {
  return {
    referencia: String(row.referencia ?? "").trim(),
    descripcion: String(row.descripcion ?? "").trim(),
    bultos: String(row.bultos ?? "").trim(),
    unidadesPorBulto: String(row.unidadesPorBulto ?? "").trim(),
    unidadesTotales: String(row.unidadesTotales ?? "").trim(),
    pesoUnaPiezaKg: String(row.pesoUnaPiezaKg ?? "").trim(),
    pesoPorBulto: String(row.pesoPorBulto ?? "").trim(),
    pesoTotalKg: String(row.pesoTotalKg ?? "").trim(),
    l: String(row.l ?? "").trim(),
    w: String(row.w ?? "").trim(),
    h: String(row.h ?? "").trim(),
    volumenM3: String(row.volumenM3 ?? "").trim(),
    unidad: String(row.unidad ?? "").trim(),
    modelo: String(row.modelo ?? "").trim(),
    paisOrigen: String(row.paisOrigen ?? "").trim(),
    tejido: String(row.tejido ?? "").trim(),
    talla: String(row.talla ?? "").trim(),
    forro: String(row.forro ?? "").trim(),
    genero: String(row.genero ?? "").trim(),
    composicion: String(row.composicion ?? "").trim(),
  };
}

/** Parte un texto largo en fragmentos con solapamiento para no cortar tablas a la mitad. */
export function splitTextIntoChunks(
  text: string,
  chunkSize: number,
  overlap: number,
): string[] {
  const t = String(text ?? "");
  if (!t) return [];
  if (t.length <= chunkSize) return [t];

  const chunks: string[] = [];
  let start = 0;
  while (start < t.length) {
    let end = Math.min(start + chunkSize, t.length);
    if (end < t.length) {
      const searchFrom = Math.max(start + Math.floor(chunkSize * 0.65), start);
      const nl = t.lastIndexOf("\n", end - 1);
      if (nl >= searchFrom) end = nl + 1;
    }
    chunks.push(t.slice(start, end));
    if (end >= t.length) break;
    start = Math.max(0, end - overlap);
    if (start >= t.length - 1) break;
  }
  return chunks;
}

/**
 * Parte el documento por páginas PDF (si hay marcadores) o por tamaño con solapamiento.
 */
export function splitTextIntoDocumentChunks(
  text: string,
  chunkSize: number,
  overlap: number,
): string[] {
  const byPage = splitTextByPdfPages(text);
  if (byPage && byPage.length > 1) return byPage;
  return splitTextIntoChunks(text, chunkSize, overlap);
}

function preferFilled(a: string | undefined, b: string | undefined): string {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  if (!y) return x;
  if (!x) return y;
  if (y.length > x.length) return y;
  return x;
}

function lineMergeKey(row: CollectionGeminiLine): string {
  const ref = String(row.referencia ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (ref) return `r:${ref}`;
  const d = String(row.descripcion ?? "")
    .trim()
    .toUpperCase()
    .slice(0, 80);
  const b = String(row.bultos ?? "").trim();
  const ut = String(row.unidadesTotales ?? "").trim();
  const ub = String(row.unidadesPorBulto ?? "").trim();
  return `n:${d}|${b}|${ut}|${ub}`;
}

/** Une filas de fragmentos solapados: misma referencia → unifica campos no vacíos. */
export function mergeDedupedGeminiLines(rows: CollectionGeminiLine[]): CollectionGeminiLine[] {
  const map = new Map<string, CollectionGeminiLine>();
  const order: string[] = [];

  for (const row of rows) {
    const key = lineMergeKey(row);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...row });
      order.push(key);
      continue;
    }
    map.set(key, {
      referencia: preferFilled(prev.referencia, row.referencia),
      descripcion: preferFilled(prev.descripcion, row.descripcion),
      bultos: preferFilled(prev.bultos, row.bultos),
      unidadesPorBulto: preferFilled(prev.unidadesPorBulto, row.unidadesPorBulto),
      unidadesTotales: preferFilled(prev.unidadesTotales, row.unidadesTotales),
      pesoUnaPiezaKg: preferFilled(prev.pesoUnaPiezaKg, row.pesoUnaPiezaKg),
      pesoPorBulto: preferFilled(prev.pesoPorBulto, row.pesoPorBulto),
      pesoTotalKg: preferFilled(prev.pesoTotalKg, row.pesoTotalKg),
      l: preferFilled(prev.l, row.l),
      w: preferFilled(prev.w, row.w),
      h: preferFilled(prev.h, row.h),
      volumenM3: preferFilled(prev.volumenM3, row.volumenM3),
      unidad: preferFilled(prev.unidad, row.unidad),
      modelo: preferFilled(prev.modelo, row.modelo),
      paisOrigen: preferFilled(prev.paisOrigen, row.paisOrigen),
      tejido: preferFilled(prev.tejido, row.tejido),
      talla: preferFilled(prev.talla, row.talla),
      forro: preferFilled(prev.forro, row.forro),
      genero: preferFilled(prev.genero, row.genero),
      composicion: preferFilled(prev.composicion, row.composicion),
    });
  }

  return order.map((k) => map.get(k)!);
}

export function sumGeminiUsage(usages: (GeminiTokenUsage | null | undefined)[]): GeminiTokenUsage | null {
  let prompt = 0;
  let candidates = 0;
  let total = 0;
  let any = false;
  for (const u of usages) {
    if (!u) continue;
    any = true;
    if (typeof u.promptTokenCount === "number" && Number.isFinite(u.promptTokenCount)) {
      prompt += u.promptTokenCount;
    }
    if (typeof u.candidatesTokenCount === "number" && Number.isFinite(u.candidatesTokenCount)) {
      candidates += u.candidatesTokenCount;
    }
    if (typeof u.totalTokenCount === "number" && Number.isFinite(u.totalTokenCount)) {
      total += u.totalTokenCount;
    }
  }
  if (!any) return null;
  const out: GeminiTokenUsage = {};
  if (prompt > 0) out.promptTokenCount = prompt;
  if (candidates > 0) out.candidatesTokenCount = candidates;
  if (total > 0) out.totalTokenCount = total;
  else if (prompt > 0 || candidates > 0) out.totalTokenCount = prompt + candidates;
  return Object.keys(out).length > 0 ? out : null;
}
