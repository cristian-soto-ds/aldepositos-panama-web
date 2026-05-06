import type { CollectionGeminiLine } from "@/lib/collectionOrderGeminiSchema";
import { normalizeCollectionOrderLineFromImport } from "@/lib/collectionOrderUnitNormalization";

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
    const normalized = normalizeCollectionOrderLineFromImport(row);
    const mapped = geminiLineFromNormalized(row, normalized);
    if (lineHasExtractedData(mapped)) out.push(mapped);
  }
  return out;
}
