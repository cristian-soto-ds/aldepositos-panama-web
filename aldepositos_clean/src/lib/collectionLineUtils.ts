import type { CollectionOrderLine } from "@/lib/types/collectionOrder";
import {
  cubicajeM3FromDims,
  formatCubicaje2,
  formatMeasure2,
  normalizeMeasureFieldsOnRow,
} from "@/lib/measureDecimals";

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

/** Peso y medidas de una línea de recolección: siempre 2 decimales. */
export function normalizeCollectionOrderLineMeasures(
  line: CollectionOrderLine,
): CollectionOrderLine {
  return normalizeMeasureFieldsOnRow(
    line as unknown as Record<string, unknown>,
  ) as CollectionOrderLine;
}

/** Unidades totales = bultos × und/bulto (admite und/bulto decimal para cuadrar totales exactos p. ej. 140÷3). */
export function unidadesTotalesFromLine(line: CollectionOrderLine): number {
  const b = parseN(line.bultos);
  const u = parseN(line.unidadesPorBulto);
  if (b <= 0 || u <= 0) return 0;
  const product = b * u;
  const r = Math.round(product);
  return Math.abs(product - r) < 1e-3 ? r : product;
}

function formatUnidadesPorBultoFromTotal(tot: number, bultos: number): string {
  const und = tot / bultos;
  if (!Number.isFinite(und) || und <= 0) return "";
  if (Math.abs(und - Math.round(und)) < 1e-9) {
    return String(Math.round(und));
  }
  const rounded = Math.round(und * 1e8) / 1e8;
  return rounded.toFixed(8).replace(/\.?0+$/, "");
}

/**
 * Usuario edita unidades totales: recalcula und/bulto si hay bultos > 0.
 * No redondea a entero si el total no es múltiplo de los bultos (evita 140 → 47×3=141).
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
  return { ...line, unidadesPorBulto: formatUnidadesPorBultoFromTotal(tot, b) };
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
  return { ...line, pesoPorBulto: formatMeasure2(pesoPorBulto) };
}

export function lineHasData(line: CollectionOrderLine): boolean {
  if (String(line.referencia ?? "").trim()) return true;
  if (String(line.descripcion ?? "").trim()) return true;
  if (parseN(line.bultos) > 0) return true;
  if (parseN(line.unidadesPorBulto) > 0) return true;
  if (parseN(line.pesoPorBulto) > 0) return true;
  if (parseN(line.pesoPiezaKg) > 0) return true;
  if (parseN(line.l) || parseN(line.w) || parseN(line.h)) return true;
  return false;
}

/**
 * Convierte líneas de recolección a filas `measureData` para RA tipo detallado.
 * Solo incluye campos que existen en el módulo de ingreso detallado.
 */
function cubicajeTotalM3FromLine(line: CollectionOrderLine): string {
  const tot = cubicajeM3FromDims(line.l, line.w, line.h, line.bultos, false);
  return tot > 0 ? formatCubicaje2(tot) : "";
}

export function collectionLinesToDetailedMeasureData(
  lines: CollectionOrderLine[],
): Record<string, unknown>[] {
  return lines.filter(lineHasData).map((row) => {
    const hasVol =
      row.volumenM3 !== undefined &&
      row.volumenM3 !== "" &&
      String(row.volumenM3).trim() !== "";
    const volumenM3 = hasVol ? row.volumenM3 : cubicajeTotalM3FromLine(row);
    return stripDetailedMeasureRow({
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
      volumenM3: volumenM3 ?? "",
      unidad: row.unidad ?? "",
      reempaque: false,
      bultoContenedor: "",
      referenciasContenedor: "",
      referenciaContenedora: "",
    });
  });
}

/**
 * Convierte líneas de recolección a filas para ingreso rápido / guía aérea.
 * Solo referencia y bultos: peso y medidas los captura el inventariado en almacén.
 */
export function collectionLinesToQuickMeasureData(
  lines: CollectionOrderLine[],
): Record<string, unknown>[] {
  return lines
    .filter((row) => {
      const ref = String(row.referencia ?? "").trim();
      const bultos = parseN(row.bultos);
      return ref.length > 0 || bultos > 0;
    })
    .map((row) => ({
      id: row.id,
      referencia: String(row.referencia ?? "").trim(),
      bultos: row.bultos === "" || row.bultos === undefined ? "" : row.bultos,
    }));
}

/** Solo campos del módulo detallado (sin `weight` del ingreso rápido). */
export function stripDetailedMeasureRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return normalizeMeasureFieldsOnRow({
    id: row.id,
    referencia: row.referencia ?? "",
    descripcion: row.descripcion ?? "",
    bultos: row.bultos ?? "",
    unidadesPorBulto: row.unidadesPorBulto ?? "",
    pesoPorBulto: row.pesoPorBulto ?? "",
    l: row.l ?? "",
    w: row.w ?? "",
    h: row.h ?? "",
    volumenM3: row.volumenM3 ?? "",
    unidad: row.unidad ?? "",
    reempaque: row.reempaque ?? false,
    bultoContenedor: row.bultoContenedor ?? "",
    referenciasContenedor: row.referenciasContenedor ?? "",
    referenciaContenedora: row.referenciaContenedora ?? "",
  });
}

export function sanitizeMeasureDataForTarget(
  rows: Record<string, unknown>[],
  targetType: RaMeasureModule | string,
): Record<string, unknown>[] {
  const t: RaMeasureModule =
    targetType === "detailed" ? "detailed" : targetType === "airway" ? "airway" : "quick";
  if (t === "detailed") {
    return rows.map(stripDetailedMeasureRow);
  }
  return rows.map((row) => {
    const out: Record<string, unknown> = {
      id: row.id,
      referencia: row.referencia ?? "",
      bultos: row.bultos ?? "",
    };
    for (const key of ["l", "w", "h", "weight", "volumenM3", "unidad", "reempaque", "bultoContenedor", "referenciasContenedor", "referenciaContenedora", "reempaqueRefs"] as const) {
      const v = row[key];
      if (v === undefined || v === "" || v === false) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[key] = v;
    }
    return out;
  });
}

export type RaMeasureModule = "quick" | "detailed" | "airway";

/** Volcado OR → RA según el tipo de módulo de destino. */
export function collectionLinesToRaMeasureData(
  lines: CollectionOrderLine[],
  targetType: RaMeasureModule | string,
): Record<string, unknown>[] {
  const t = targetType === "detailed" ? "detailed" : "quick";
  return t === "detailed"
    ? collectionLinesToDetailedMeasureData(lines)
    : collectionLinesToQuickMeasureData(lines);
}
