import type { CollectionOrderLine } from "@/lib/types/collectionOrder";
import { applyPesoTotalToLine, applyUnidadesTotalesToLine } from "@/lib/collectionLineUtils";

const DOZEN = 12;
/** 12 docenas — uso mayorista en facturas/packing lists. */
const GROSS = 144;

function parseFloatLoose(s: string): number {
  const n = parseFloat(String(s).replace(",", ".").trim());
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Detecta cantidad en docenas en un texto (facturas locales e internacionales).
 * Ej.: "2 docenas", "1.5 dz", "24dz", "3 dozen", "5 gross", "media docena", "douzaine", "dúzias".
 * Devuelve equivalente en piezas (enteros) o null si no aplica.
 */
export function parseDozensToUnits(text: string): number | null {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ");
  if (!t) return null;

  const grossMatch = t.match(/\b([\d.,]+)[\s_]*(?:gross|grs\.?)\b/);
  if (grossMatch) {
    const v = parseFloatLoose(grossMatch[1]);
    if (Number.isFinite(v) && v >= 0) return Math.round(v * GROSS);
  }

  if (/\bmedia\s+docena\b/.test(t) || /\bmitad\s+de\s+docena\b/.test(t)) {
    return DOZEN / 2;
  }
  if (/\bcuarto(s)?\s+de\s+docena\b/.test(t)) {
    return DOZEN / 4;
  }

  if (/\bhalf\s+a\s+dozen\b/.test(t) || /\bhalf[-\s]?dozen\b/.test(t)) {
    const lead = t.match(/^([\d.,]+)[\s_]*(?:×|x|-)?[\s_]*/);
    const mult =
      lead && parseFloatLoose(lead[1]) > 0 ? parseFloatLoose(lead[1]) : 1;
    return Math.round(mult * (DOZEN / 2));
  }

  if (
    /\b(?:uma|un)\s+d[uú]zia\b/.test(t) &&
    !/\b([\d.,]+)[\s_]*d[uú]zias?\b/.test(t)
  ) {
    return DOZEN;
  }

  const duziaMatch = t.match(/\b([\d.,]+)[\s_]*d[uú]zias?\b/);
  if (duziaMatch) {
    const v = parseFloatLoose(duziaMatch[1]);
    if (Number.isFinite(v) && v >= 0) return Math.round(v * DOZEN);
  }

  const douzMatch = t.match(/\b([\d.,]+)[\s_]*douzaines?\b/);
  if (douzMatch) {
    const v = parseFloatLoose(douzMatch[1]);
    if (Number.isFinite(v) && v >= 0) return Math.round(v * DOZEN);
  }

  let m = t.match(
    /\b([\d.,]+)[\s_]*(?:docenas?|dozens?|dozen)(?:s|es)?\b/i,
  );
  if (!m) m = t.match(/\b([\d.,]+)[\s_]*dz\b/i);
  if (!m) m = t.match(/\b([\d.,]+)[\s_]*d\.z\.?\b/i);
  if (m) {
    const v = parseFloatLoose(m[1]);
    if (Number.isFinite(v) && v >= 0) return Math.round(v * DOZEN);
  }

  return null;
}

/**
 * Facturas / packing LATAM: cantidad tipo `11 (8)` = 11 docenas + 8 piezas = 140 (no interpretar como otros decimales).
 */
export function parseDozenPlusParenPiecesTotal(text: string): number | null {
  const t = String(text ?? "")
    .replace(/\u00a0/g, " ")
    .trim();
  const m = /^(\d{1,6})\s*\(\s*(\d{1,5})\s*\)\s*$/.exec(t);
  if (!m) return null;
  const dz = parseInt(m[1], 10);
  const pcs = parseInt(m[2], 10);
  if (!Number.isFinite(dz) || !Number.isFinite(pcs) || dz < 0 || pcs < 0) {
    return null;
  }
  return dz * DOZEN + pcs;
}

function extractParenDozenPiecesFromSnippet(text: string): number | null {
  const m = /\b(\d{1,5})\s*\(\s*(\d{1,3})\s*\)\b/.exec(text);
  if (!m) return null;
  return parseDozenPlusParenPiecesTotal(`${m[1]} (${m[2]})`);
}

/**
 * Convierte un total «60», «60 docenas», «5 dz», «120 pcs» a string entero de piezas para reparto entre bultos.
 */
export function normalizePiezasTotalesInput(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  const parenTot = parseDozenPlusParenPiecesTotal(t);
  if (parenTot !== null) return String(parenTot);
  const fromDozen = parseDozensToUnits(t);
  if (fromDozen !== null) return String(fromDozen);
  const stripped = t
    .replace(/\bpcs?\b/gi, "")
    .replace(/\bunits?\b/gi, "")
    .replace(/\bpzas?\b/gi, "")
    .replace(/\bpiezas?\b/gi, "")
    .replace(/\bu\.?\b/gi, "")
    .trim();
  const n = parseFloatLoose(stripped);
  if (Number.isFinite(n) && n >= 0) return String(Math.round(n));
  return "";
}

/**
 * Convierte el valor capturado en und/bulto: número plano o expresión en docenas → unidades enteras.
 */
export function normalizeUnidadesPorBultoInput(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (parseDozenPlusParenPiecesTotal(t) !== null) {
    return "";
  }
  const fromDozen = parseDozensToUnits(t);
  if (fromDozen !== null) return String(fromDozen);
  const n = parseFloatLoose(t);
  if (Number.isFinite(n) && n >= 0) {
    const intish = Math.round(n);
    if (Math.abs(n - intish) < 1e-6) return String(intish);
    const rounded = Math.round(n * 1e8) / 1e8;
    return rounded.toFixed(8).replace(/\.?0+$/, "");
  }
  return "";
}

/**
 * Si la descripción menciona docenas y no hay und/bulto, intenta rellenar unidades.
 */
export function extractUnidadesPorBultoFromDescripcion(descripcion: string): string {
  const u = parseDozensToUnits(descripcion);
  return u !== null ? String(u) : "";
}

/** Piezas totales cuando en descripción aparece `Nd (Mx)` pero no está en otros campos. */
export function extractTotalPiecesFromDescripcionParen(descripcion: string): string {
  const n = extractParenDozenPiecesFromSnippet(descripcion);
  return n !== null ? String(n) : "";
}

export type ImportLineInput = {
  referencia?: string;
  descripcion?: string;
  bultos?: string;
  unidadesPorBulto?: string;
  pesoPorBulto?: string;
  unidadesTotales?: string;
  pesoTotalKg?: string;
  pesoUnaPiezaKg?: string;
  l?: string;
  w?: string;
  h?: string;
  volumenM3?: string;
  unidad?: string;
  modelo?: string;
  paisOrigen?: string;
  tejido?: string;
  talla?: string;
  forro?: string;
  genero?: string;
  composicion?: string;
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

  let pesoPorBulto = String(row.pesoPorBulto ?? "").trim();
  const unidadesTotalesRaw = String(row.unidadesTotales ?? "").trim();
  let unidadesTotales = normalizePiezasTotalesInput(unidadesTotalesRaw);
  if (!unidadesTotales) {
    const fromUndMisfiled = parseDozenPlusParenPiecesTotal(
      String(row.unidadesPorBulto ?? "").trim(),
    );
    if (fromUndMisfiled !== null) unidadesTotales = String(fromUndMisfiled);
  }
  if (!unidadesTotales && descripcion) {
    const asTotPieces = extractTotalPiecesFromDescripcionParen(descripcion);
    if (asTotPieces) unidadesTotales = asTotPieces;
  }
  if (!unidadesPorBulto && descripcion) {
    unidadesPorBulto = extractUnidadesPorBultoFromDescripcion(descripcion);
  }
  const pesoTotalKg = String(row.pesoTotalKg ?? "").trim();
  const piezaFromIa = String(row.pesoUnaPiezaKg ?? "").trim();
  let pesoPiezaKg = piezaFromIa;

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
    magayaModelo: String(row.modelo ?? "").trim(),
    paisOrigen: String(row.paisOrigen ?? "").trim(),
    tejido: String(row.tejido ?? "").trim(),
    talla: String(row.talla ?? "").trim(),
    forro: String(row.forro ?? "").trim(),
    genero: String(row.genero ?? "").trim(),
    composicion: String(row.composicion ?? "").trim(),
    pesoPiezaKg,
  };

  const bultosNum = Math.max(0, Math.round(parseFloatLoose(String(draft.bultos)) || 0));

  if (unidadesTotales && bultosNum > 0) {
    const withTot = applyUnidadesTotalesToLine(draft, unidadesTotales);
    draft.unidadesPorBulto = withTot.unidadesPorBulto;
  }

  if (pesoTotalKg && bultosNum > 0 && !piezaFromIa) {
    const withPeso = applyPesoTotalToLine(draft, pesoTotalKg);
    draft.pesoPorBulto = withPeso.pesoPorBulto;
  }

  const undNum = Math.max(0, parseFloatLoose(String(draft.unidadesPorBulto ?? "")) || 0);

  const pbStr = String(draft.pesoPorBulto ?? "").trim();
  if (!pesoPiezaKg && pbStr && undNum > 0) {
    const pb = parseFloatLoose(pbStr);
    if (Number.isFinite(pb) && pb > 0) {
      pesoPiezaKg = (pb / undNum).toFixed(4).replace(/\.?0+$/, "");
      draft.pesoPiezaKg = pesoPiezaKg;
    }
  }

  if (pesoPiezaKg && undNum > 0 && !String(draft.pesoPorBulto ?? "").trim()) {
    const pp = parseFloatLoose(pesoPiezaKg);
    if (Number.isFinite(pp) && pp > 0) {
      draft.pesoPorBulto = (pp * undNum).toFixed(2);
    }
  }

  return {
    referencia: draft.referencia,
    descripcion: draft.descripcion,
    bultos: draft.bultos,
    unidadesPorBulto: draft.unidadesPorBulto,
    pesoPorBulto: draft.pesoPorBulto,
    pesoPiezaKg: draft.pesoPiezaKg,
    l: draft.l,
    w: draft.w,
    h: draft.h,
    volumenM3: draft.volumenM3,
    unidad: draft.unidad,
    magayaModelo: draft.magayaModelo,
    paisOrigen: draft.paisOrigen,
    tejido: draft.tejido,
    talla: draft.talla,
    forro: draft.forro,
    genero: draft.genero,
    composicion: draft.composicion,
  };
}
