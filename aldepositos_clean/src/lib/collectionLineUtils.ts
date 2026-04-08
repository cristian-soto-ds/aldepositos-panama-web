import type { CollectionOrderLine } from "@/lib/types/collectionOrder";

function parseN(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function parseIntN(v: unknown): number {
  const n = parseN(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

/** Unidades totales = bultos × und/bulto */
export function unidadesTotalesFromLine(line: CollectionOrderLine): number {
  return parseIntN(line.bultos) * parseIntN(line.unidadesPorBulto);
}

/**
 * Usuario edita unidades totales: recalcula und/bulto si hay bultos > 0.
 */
export function applyUnidadesTotalesToLine(
  line: CollectionOrderLine,
  unidadesTotalesRaw: string,
): CollectionOrderLine {
  const tot = parseIntN(unidadesTotalesRaw);
  const b = parseIntN(line.bultos);
  if (b <= 0 || tot <= 0) {
    return { ...line };
  }
  const und = Math.round(tot / b);
  return { ...line, unidadesPorBulto: String(und) };
}

/** Peso total = bultos × peso por bulto */
export function pesoTotalFromLine(line: CollectionOrderLine): number {
  return parseN(line.bultos) * parseN(line.pesoPorBulto);
}

/**
 * Usuario edita peso total: recalcula peso por bulto si hay bultos > 0.
 */
export function applyPesoTotalToLine(
  line: CollectionOrderLine,
  pesoTotalRaw: string,
): CollectionOrderLine {
  const total = parseN(pesoTotalRaw);
  const b = parseN(line.bultos);
  if (b <= 0 || total <= 0) {
    return { ...line };
  }
  const pesoPorBulto = total / b;
  const rounded = pesoPorBulto.toFixed(2);
  return { ...line, pesoPorBulto: rounded };
}

export function lineHasData(line: CollectionOrderLine): boolean {
  if (String(line.referencia ?? "").trim()) return true;
  if (String(line.descripcion ?? "").trim()) return true;
  if (parseN(line.bultos) > 0) return true;
  if (parseN(line.unidadesPorBulto) > 0) return true;
  if (parseN(line.pesoPorBulto) > 0) return true;
  if (parseN(line.l) || parseN(line.w) || parseN(line.h)) return true;
  return false;
}

/**
 * Convierte líneas de recolección a filas `measureData` para RA tipo detallado.
 */
export function collectionLinesToDetailedMeasureData(
  lines: CollectionOrderLine[],
): Record<string, unknown>[] {
  return lines.filter(lineHasData).map((row) => ({
    id: row.id,
    referencia: String(row.referencia ?? "").trim(),
    descripcion: String(row.descripcion ?? "").trim(),
    bultos: row.bultos === "" || row.bultos === undefined ? "" : row.bultos,
    unidadesPorBulto:
      row.unidadesPorBulto === "" || row.unidadesPorBulto === undefined
        ? ""
        : row.unidadesPorBulto,
    pesoPorBulto:
      row.pesoPorBulto === "" || row.pesoPorBulto === undefined ? "" : row.pesoPorBulto,
    l: row.l ?? "",
    w: row.w ?? "",
    h: row.h ?? "",
    volumenM3: row.volumenM3 ?? "",
    unidad: row.unidad ?? "",
    reempaque: false,
    bultoContenedor: "",
    referenciasContenedor: "",
    referenciaContenedora: "",
  }));
}
