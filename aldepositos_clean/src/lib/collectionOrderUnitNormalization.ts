import type { CollectionOrderLine } from "@/lib/types/collectionOrder";
import { applyPesoTotalToLine, applyUnidadesTotalesToLine } from "@/lib/collectionLineUtils";

const DOZEN = 12;

function parseFloatLoose(s: string): number {
  const n = parseFloat(String(s).replace(",", ".").trim());
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Detecta cantidad en docenas en un texto (p. ej. "2 docenas", "1.5 dz", "media docena").
 * Devuelve equivalente en unidades o null si no aplica.
 */
export function parseDozensToUnits(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  if (/\bmedia\s+docena\b/.test(t) || /\bmitad\s+de\s+docena\b/.test(t)) {
    return DOZEN / 2;
  }
  if (/\bcuarto(s)?\s+de\s+docena\b/.test(t)) {
    return DOZEN / 4;
  }

  const m = t.match(/([\d.,]+)\s*(docenas?|dozens?|dozen|dz)\b/i);
  if (m) {
    const v = parseFloatLoose(m[1]);
    if (Number.isFinite(v) && v >= 0) return Math.round(v * DOZEN);
  }
  return null;
}

/**
 * Convierte el valor capturado en und/bulto: número plano o expresión en docenas → unidades enteras.
 */
export function normalizeUnidadesPorBultoInput(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const fromDozen = parseDozensToUnits(t);
  if (fromDozen !== null) return String(fromDozen);
  const n = parseFloatLoose(t);
  if (Number.isFinite(n) && n >= 0) return String(Math.round(n));
  return "";
}

/**
 * Si la descripción menciona docenas y no hay und/bulto, intenta rellenar unidades.
 */
export function extractUnidadesPorBultoFromDescripcion(descripcion: string): string {
  const u = parseDozensToUnits(descripcion);
  return u !== null ? String(u) : "";
}

export type ImportLineInput = {
  referencia?: string;
  descripcion?: string;
  bultos?: string;
  unidadesPorBulto?: string;
  pesoPorBulto?: string;
  unidadesTotales?: string;
  pesoTotalKg?: string;
  l?: string;
  w?: string;
  h?: string;
  volumenM3?: string;
  unidad?: string;
};

/**
 * Normaliza fila desde IA o pegado: docenas → unidades; totales → por bulto si hay bultos.
 */
export function normalizeCollectionOrderLineFromImport(
  row: ImportLineInput,
): Omit<CollectionOrderLine, "id"> {
  let bultos = String(row.bultos ?? "").trim();
  let descripcion = String(row.descripcion ?? "").trim();
  let unidadesPorBulto = normalizeUnidadesPorBultoInput(
    String(row.unidadesPorBulto ?? ""),
  );
  if (!unidadesPorBulto && descripcion) {
    unidadesPorBulto = extractUnidadesPorBultoFromDescripcion(descripcion);
  }

  let pesoPorBulto = String(row.pesoPorBulto ?? "").trim();
  const unidadesTotales = String(row.unidadesTotales ?? "").trim();
  const pesoTotalKg = String(row.pesoTotalKg ?? "").trim();

  const draft: CollectionOrderLine = {
    id: "",
    referencia: String(row.referencia ?? "").trim(),
    descripcion,
    bultos,
    unidadesPorBulto,
    pesoPorBulto,
    l: row.l ?? "",
    w: row.w ?? "",
    h: row.h ?? "",
    volumenM3: row.volumenM3 ?? "",
    unidad: row.unidad ?? "",
  };

  const bultosNum = Math.max(0, Math.round(parseFloatLoose(String(draft.bultos)) || 0));

  if (unidadesTotales && bultosNum > 0) {
    const withTot = applyUnidadesTotalesToLine(draft, unidadesTotales);
    draft.unidadesPorBulto = withTot.unidadesPorBulto;
  }

  if (pesoTotalKg && bultosNum > 0) {
    const withPeso = applyPesoTotalToLine(draft, pesoTotalKg);
    draft.pesoPorBulto = withPeso.pesoPorBulto;
  }

  return {
    referencia: draft.referencia,
    descripcion: draft.descripcion,
    bultos: draft.bultos,
    unidadesPorBulto: draft.unidadesPorBulto,
    pesoPorBulto: draft.pesoPorBulto,
    l: draft.l,
    w: draft.w,
    h: draft.h,
    volumenM3: draft.volumenM3,
    unidad: draft.unidad,
  };
}
