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
  const rounded = pesoPorBulto.toFixed(2);
  return { ...line, pesoPorBulto: rounded };
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
 */
function cubicajeTotalM3FromLine(line: CollectionOrderLine): string {
  const l = parseN(line.l);
  const w = parseN(line.w);
  const h = parseN(line.h);
  const b = parseIntN(line.bultos);
  if (l <= 0 || w <= 0 || h <= 0 || b <= 0) return "";
  const tot = ((l * w * h) / 1_000_000) * b;
  return tot > 0 ? tot.toFixed(4) : "";
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
    return {
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
      pesoPiezaKg:
        row.pesoPiezaKg === "" || row.pesoPiezaKg === undefined ? "" : row.pesoPiezaKg,
      l: row.l ?? "",
      w: row.w ?? "",
      h: row.h ?? "",
      volumenM3: volumenM3 ?? "",
      unidad: row.unidad ?? "",
      magayaModelo: row.magayaModelo ?? "",
      paisOrigen: row.paisOrigen ?? "",
      tejido: row.tejido ?? "",
      talla: row.talla ?? "",
      forro: row.forro ?? "",
      genero: row.genero ?? "",
      composicion: row.composicion ?? "",
      reempaque: false,
      bultoContenedor: "",
      referenciasContenedor: "",
      referenciaContenedora: "",
    };
  });
}
