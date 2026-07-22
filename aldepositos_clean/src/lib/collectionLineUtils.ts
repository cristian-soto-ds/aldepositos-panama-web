import type { CollectionOrderLine } from "@/lib/types/collectionOrder";
import {
  cubicajeM3FromDims,
  formatCubicaje2,
  formatMeasure2,
  formatWeightPrecise,
  normalizeMeasureFieldsOnRow,
  preserveDocumentNumber,
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

/**
 * Unidades totales de la línea.
 * Si hay `unidadesTotales` de factura, ese valor manda (aunque und/bulto sea 48 decorativo).
 * Si no, bultos × und/bulto.
 */
export function unidadesTotalesFromLine(line: CollectionOrderLine): number {
  const stored = parseN(line.unidadesTotales);
  if (stored > 0) {
    const r = Math.round(stored);
    return Math.abs(stored - r) < 1e-3 ? r : stored;
  }
  const b = parseN(line.bultos);
  const u = parseN(line.unidadesPorBulto);
  if (b <= 0 || u <= 0) return 0;
  const product = b * u;
  const r = Math.round(product);
  return Math.abs(product - r) < 1e-3 ? r : product;
}

/** Und/bulto fijo cuando Tot ÷ bultos no es entero (regla operativa / Magaya). */
export const UND_BULTO_WHEN_TOT_NOT_DIVISIBLE = 48;

/**
 * Tot ÷ bultos: si es entero → ese cociente; si no → 48 (no inventar 312 ni decimales).
 * El total de factura se guarda en `unidadesTotales`.
 */
export function formatUnidadesPorBultoFromTotal(
  tot: number,
  bultos: number,
): string {
  if (!Number.isFinite(tot) || !Number.isFinite(bultos) || tot <= 0 || bultos <= 0) {
    return "";
  }
  if (tot % bultos === 0) {
    return String(tot / bultos);
  }
  return String(UND_BULTO_WHEN_TOT_NOT_DIVISIBLE);
}

/**
 * Usuario edita unidades totales: guarda tot de factura y recalcula und/bulto.
 * Si tot no es múltiplo de bultos → und=48 (decorativo); tot permanece exacto.
 */
export function applyUnidadesTotalesToLine(
  line: CollectionOrderLine,
  unidadesTotalesRaw: string,
): CollectionOrderLine {
  const tot = parseIntN(unidadesTotalesRaw);
  const b = parseIntN(line.bultos);
  if (tot <= 0) {
    return { ...line, unidadesTotales: "" };
  }
  if (b <= 0) {
    return { ...line, unidadesTotales: String(tot) };
  }
  return {
    ...line,
    unidadesTotales: String(tot),
    unidadesPorBulto: formatUnidadesPorBultoFromTotal(tot, b),
  };
}

/** Peso total: factura (`pesoTotalKg`) manda; si no, bultos × peso/b. */
export function pesoTotalFromLine(line: CollectionOrderLine): number {
  const stored = parseN(line.pesoTotalKg);
  if (stored > 0) return stored;
  return parseN(line.bultos) * parseN(line.pesoPorBulto);
}

/**
 * Usuario edita peso total: guarda el total de factura y deriva peso/b.
 * No altera el total (fidelidad a factura).
 */
export function applyPesoTotalToLine(
  line: CollectionOrderLine,
  pesoTotalRaw: string,
): CollectionOrderLine {
  const raw = String(pesoTotalRaw ?? "").trim();
  const total = parseN(raw);
  const b = parseN(line.bultos);
  if (total <= 0) {
    return { ...line, pesoTotalKg: "" };
  }
  const preserved = preserveDocumentNumber(raw) || String(total);
  if (b <= 0) {
    return { ...line, pesoTotalKg: preserved };
  }
  return {
    ...line,
    pesoTotalKg: preserved,
    pesoPorBulto: formatWeightPrecise(total / b),
  };
}

export function lineHasData(line: CollectionOrderLine): boolean {
  if (String(line.referencia ?? "").trim()) return true;
  if (line.reempaque === true) return true;
  if (String(line.descripcion ?? "").trim()) return true;
  if (parseN(line.bultos) > 0) return true;
  if (parseN(line.unidadesPorBulto) > 0) return true;
  if (parseN(line.unidadesTotales) > 0) return true;
  if (parseN(line.pesoPorBulto) > 0) return true;
  if (parseN(line.pesoTotalKg) > 0) return true;
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
    const isReempaque = row.reempaque === true;
    const hasVol =
      !isReempaque &&
      row.volumenM3 !== undefined &&
      row.volumenM3 !== "" &&
      String(row.volumenM3).trim() !== "";
    const volumenM3 = isReempaque
      ? ""
      : hasVol
        ? row.volumenM3
        : cubicajeTotalM3FromLine(row);
    return stripDetailedMeasureRow({
      id: row.id,
      referencia: String(row.referencia ?? "").trim(),
      descripcion: String(row.descripcion ?? "").trim(),
      bultos: isReempaque
        ? ""
        : row.bultos === "" || row.bultos === undefined
          ? ""
          : row.bultos,
      unidadesPorBulto: isReempaque
        ? ""
        : row.unidadesPorBulto === "" || row.unidadesPorBulto === undefined
          ? ""
          : row.unidadesPorBulto,
      pesoPorBulto: isReempaque
        ? ""
        : row.pesoPorBulto === "" || row.pesoPorBulto === undefined
          ? ""
          : row.pesoPorBulto,
      l: isReempaque ? "" : (row.l ?? ""),
      w: isReempaque ? "" : (row.w ?? ""),
      h: isReempaque ? "" : (row.h ?? ""),
      volumenM3: volumenM3 ?? "",
      unidad: row.unidad ?? "",
      reempaque: isReempaque,
      bultoContenedor: "",
      referenciasContenedor: "",
      referenciaContenedora: "",
    });
  });
}

/**
 * Convierte líneas de recolección a filas para ingreso rápido / guía aérea.
 * Solo referencia y bultos: peso y medidas los captura el inventariado en almacén.
 * Conserva `reempaque` para que el RA ya lo muestre marcado.
 */
export function collectionLinesToQuickMeasureData(
  lines: CollectionOrderLine[],
): Record<string, unknown>[] {
  return lines
    .filter((row) => {
      const ref = String(row.referencia ?? "").trim();
      const bultos = parseN(row.bultos);
      return ref.length > 0 || bultos > 0 || row.reempaque === true;
    })
    .map((row) => {
      const isReempaque = row.reempaque === true;
      const out: Record<string, unknown> = {
        id: row.id,
        referencia: String(row.referencia ?? "").trim(),
        bultos: isReempaque
          ? ""
          : row.bultos === "" || row.bultos === undefined
            ? ""
            : row.bultos,
      };
      if (isReempaque) out.reempaque = true;
      return out;
    });
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
