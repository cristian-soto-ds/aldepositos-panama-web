/** Peso, medidas (cm) y CBM: siempre 2 decimales, redondeo hacia arriba. */

export const MEASURE_DECIMALS = 2;

export function parseMeasureNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const n =
    typeof value === "number" ? value : parseFloat(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Redondeo hacia arriba a N decimales. */
export function roundUpMeasure(value: unknown, decimals = MEASURE_DECIMALS): number {
  const n = parseMeasureNumber(value);
  if (!Number.isFinite(n) || n === 0) return 0;
  const factor = 10 ** decimals;
  if (n < 0) {
    return Math.floor(n * factor + Number.EPSILON) / factor;
  }
  return Math.ceil(n * factor - Number.EPSILON) / factor;
}

/** Texto con exactamente 2 decimales (tras redondeo hacia arriba). */
export function formatMeasure2(value: unknown): string {
  if (value === "" || value === undefined || value === null) return "";
  const n = parseMeasureNumber(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return roundUpMeasure(n).toFixed(MEASURE_DECIMALS);
}

/** Mientras el usuario escribe: limita a N decimales sin redondear aún. */
export function sanitizeMeasureTyping(
  raw: string,
  decimals = MEASURE_DECIMALS,
): string {
  const normalized = raw.replace(",", ".").replace(/[^0-9.]/g, "");
  const [intPart = "", ...rest] = normalized.split(".");
  const decimalPart = rest.join("").slice(0, decimals);
  if (!normalized.includes(".")) return intPart;
  return `${intPart}.${decimalPart}`;
}

/** Al guardar / blur: normaliza campo de medida o peso. */
export function normalizeMeasureField(value: unknown): string {
  return formatMeasure2(value);
}

export function cubicajeM3FromDims(
  l: unknown,
  w: unknown,
  h: unknown,
  bultos: unknown,
  isReempaque = false,
): number {
  if (isReempaque) return 0;
  const L = roundUpMeasure(l);
  const W = roundUpMeasure(w);
  const H = roundUpMeasure(h);
  const b = parseMeasureNumber(bultos);
  if (L <= 0 || W <= 0 || H <= 0 || b <= 0) return 0;
  return roundUpMeasure((L * W * H) / 1_000_000 * b);
}

const MEASURE_ROW_KEYS = [
  "l",
  "w",
  "h",
  "weight",
  "volumenM3",
  "pesoPorBulto",
  "pesoPiezaKg",
] as const;

export function normalizeMeasureFieldsOnRow<T extends Record<string, unknown>>(
  row: T,
): T {
  const out = { ...row };
  for (const key of MEASURE_ROW_KEYS) {
    if (!(key in out)) continue;
    const v = out[key];
    if (v === "" || v === undefined || v === null) continue;
    const normalized = normalizeMeasureField(v);
    (out as Record<string, unknown>)[key] = normalized || "";
  }
  return out;
}

/** Para CSV / Excel: siempre 2 decimales en medidas y peso. */
export function csvMeasureNum(value: unknown): string {
  const n = parseMeasureNumber(value);
  if (!Number.isFinite(n) || n === 0) return "0.00";
  return roundUpMeasure(n).toFixed(MEASURE_DECIMALS);
}
