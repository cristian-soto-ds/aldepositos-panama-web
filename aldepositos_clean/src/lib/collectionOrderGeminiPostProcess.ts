import type { CollectionGeminiLine } from "@/lib/collectionOrderGeminiSchema";
import { normalizeCollectionOrderLineFromImport } from "@/lib/collectionOrderUnitNormalization";

function parseLooseN(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Gemini a veces pone «Peso B.» (26 kg) en el campo w cuando l/h van vacíos.
 */
export function remapWeightMisfiledAsWidth(
  row: CollectionGeminiLine,
): CollectionGeminiLine {
  if (String(row.pesoPorBulto ?? "").trim()) return row;
  const l = parseLooseN(row.l);
  const w = parseLooseN(row.w);
  const h = parseLooseN(row.h);
  if (l > 0 || h > 0 || w <= 0) return row;
  // Peso típico por bulto (kg); anchos de caja suelen ser > 40 cm si fueran medidas.
  if (w >= 0.5 && w <= 200) {
    return { ...row, pesoPorBulto: String(row.w).trim(), w: "" };
  }
  return row;
}

/**
 * Quita patrones típicos de medidas que a veces filtran al campo descripcion.
 */
function stripMeasuresFromDescripcion(raw: string): string {
  let s = raw.trim();
  if (!s) return "";
  // "10x20x30", "10 x 20 x 30 cm", "10X10X10CM"
  s = s.replace(
    /\b\d+([.,]\d+)?\s*[x×]\s*\d+([.,]\d+)?(\s*[x×]\s*\d+([.,]\d+)?)?\s*(cm|mm|m|in|")?\b/gi,
    " ",
  );
  return s.replace(/\s{2,}/g, " ").trim();
}

function geminiLineFromNormalized(
  row: CollectionGeminiLine,
  normalized: ReturnType<typeof normalizeCollectionOrderLineFromImport>,
): CollectionGeminiLine {
  const descripcion = stripMeasuresFromDescripcion(
    String(normalized.descripcion ?? ""),
  );
  return {
    referencia: normalized.referencia ?? "",
    descripcion,
    bultos: String(normalized.bultos ?? "").trim(),
    unidadesPorBulto: String(normalized.unidadesPorBulto ?? "").trim(),
    unidadesTotales: String(row.unidadesTotales ?? "").trim(),
    pesoUnaPiezaKg: String(normalized.pesoPiezaKg ?? "").trim(),
    pesoPorBulto: String(normalized.pesoPorBulto ?? "").trim(),
    pesoTotalKg: String(row.pesoTotalKg ?? "").trim(),
    l: String(normalized.l ?? "").trim(),
    w: String(normalized.w ?? "").trim(),
    h: String(normalized.h ?? "").trim(),
    volumenM3: String(normalized.volumenM3 ?? "").trim(),
    unidad: String(normalized.unidad ?? "").trim(),
    modelo: String(normalized.magayaModelo ?? "").trim(),
    paisOrigen: String(normalized.paisOrigen ?? "").trim(),
    tejido: String(normalized.tejido ?? "").trim(),
    talla: String(normalized.talla ?? "").trim(),
    forro: String(normalized.forro ?? "").trim(),
    genero: String(normalized.genero ?? "").trim(),
    composicion: String(normalized.composicion ?? "").trim(),
  };
}

function lineHasExtractedData(row: CollectionGeminiLine): boolean {
  return Boolean(
    row.referencia ||
      row.descripcion ||
      row.bultos ||
      row.unidadesPorBulto ||
      row.unidadesTotales ||
      row.pesoUnaPiezaKg ||
      row.pesoPorBulto ||
      row.pesoTotalKg ||
      row.l ||
      row.w ||
      row.h ||
      row.volumenM3 ||
      row.modelo ||
      row.paisOrigen ||
      row.tejido ||
      row.talla ||
      row.forro ||
      row.genero ||
      row.composicion,
  );
}

/**
 * Normaliza números/cantidades como en el resto del módulo y descarta basura vacía.
 * Las filas pasan por la misma lógica que al pulsar «Añadir a la tabla».
 */
export function postProcessGeminiExtractedLines(
  lines: CollectionGeminiLine[],
): CollectionGeminiLine[] {
  const out: CollectionGeminiLine[] = [];
  for (const row of lines) {
    const remapped = remapWeightMisfiledAsWidth(row);
    const normalized = normalizeCollectionOrderLineFromImport(remapped);
    const mapped = geminiLineFromNormalized(remapped, normalized);
    if (lineHasExtractedData(mapped)) out.push(mapped);
  }
  return out;
}
