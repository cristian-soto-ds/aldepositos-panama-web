/** Peso, medidas (cm) y CBM: siempre 2 decimales, redondeo hacia arriba. */

export const MEASURE_DECIMALS = 2;

/**
 * Interpreta números con separadores de miles/decimales (HTML Magaya, facturas, CSV).
 * Ejemplos:
 * - "1,320.30" → 1320.30 (miles con coma, decimal con punto)
 * - "1.320,30" → 1320.30 (miles con punto, decimal con coma)
 * - "21,25" / "21.25" → 21.25
 */
export function parseMeasureNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  let s = String(value)
    .trim()
    .replace(/\u00a0/g, "")
    .replace(/\s/g, "")
    .replace(/[^\d,.\-]/g, "");
  if (!s || s === "-" || s === "." || s === ",") return 0;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    // Ambos: el último es el decimal.
    if (lastComma > lastDot) {
      // 1.320,30
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // 1,320.30
      s = s.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    const parts = s.split(",");
    const last = parts[parts.length - 1] ?? "";
    if (parts.length === 2 && last.length > 0 && last.length <= 2) {
      // 21,25 → decimal
      s = `${parts[0]}.${last}`;
    } else {
      // 1,320 o 1,320,500 → miles
      s = s.replace(/,/g, "");
    }
  } else if (lastDot !== -1) {
    const parts = s.split(".");
    if (parts.length > 2) {
      const last = parts[parts.length - 1] ?? "";
      // 1.320.30 → miles + decimal; 1.320.456 → solo miles
      if (last.length > 0 && last.length !== 3) {
        s = `${parts.slice(0, -1).join("")}.${last}`;
      } else {
        s = s.replace(/\./g, "");
      }
    }
    // Un solo punto: decimal (21.25 / 1.936)
  }

  const n = parseFloat(s);
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

/**
 * Redondeo al múltiplo más cercano (medio hacia arriba) a N decimales, estable
 * ante el error de coma flotante.
 *
 * Es el redondeo CANÓNICO del CUBICAJE (CBM): al usar el más cercano —y no hacia
 * arriba— la suma de las líneas coincide con el total mostrado y no se infla el
 * volumen. El cubicaje es el dato más delicado (facturación), así que TODO el
 * sistema debe pasar por aquí.
 */
export function roundMeasureNearest(
  value: unknown,
  decimals = MEASURE_DECIMALS,
): number {
  const n = parseMeasureNumber(value);
  if (!Number.isFinite(n) || n === 0) return 0;
  const factor = 10 ** decimals;
  const scaled = n * factor;
  // Corrige representaciones como 11.5 => 11.49999999 antes de redondear.
  const corrected = scaled + (scaled >= 0 ? 1e-6 : -1e-6);
  return Math.round(corrected) / factor;
}

/** Texto con exactamente 2 decimales (tras redondeo hacia arriba). */
export function formatMeasure2(value: unknown): string {
  if (value === "" || value === undefined || value === null) return "";
  const n = parseMeasureNumber(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return roundUpMeasure(n).toFixed(MEASURE_DECIMALS);
}

/**
 * Peso derivado de un total de factura: hasta 6 decimales, redondeo al más
 * cercano (NO hacia arriba). Así bultos × peso/b recupera el total del documento
 * (ej. 487.73 ÷ 12 → 40.644167 → ×12 = 487.73, no 487.80).
 */
export function formatWeightPrecise(value: unknown, maxDecimals = 6): string {
  if (value === "" || value === undefined || value === null) return "";
  const n = parseMeasureNumber(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(n * factor + Number.EPSILON) / factor;
  // Quita ceros finales innecesarios pero conserva precisión útil.
  return String(rounded);
}

/** Conserva el número tal cual vino del documento (coma→punto, sin re-redondear). */
export function preserveDocumentNumber(raw: unknown): string {
  const n = parseMeasureNumber(raw);
  if (!Number.isFinite(n) || n <= 0) return "";

  // Si el texto original ya es un decimal simple tras normalizar miles, conserva decimales.
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/\u00a0/g, "")
    .replace(/\s/g, "");
  const asPlain = (() => {
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    let t = cleaned.replace(/[^\d,.\-]/g, "");
    if (lastComma !== -1 && lastDot !== -1) {
      t =
        lastComma > lastDot
          ? t.replace(/\./g, "").replace(",", ".")
          : t.replace(/,/g, "");
    } else if (lastComma !== -1) {
      const parts = t.split(",");
      const last = parts[parts.length - 1] ?? "";
      t =
        parts.length === 2 && last.length > 0 && last.length <= 2
          ? `${parts[0]}.${last}`
          : t.replace(/,/g, "");
    } else if ((t.match(/\./g) || []).length > 1) {
      const parts = t.split(".");
      const last = parts[parts.length - 1] ?? "";
      t =
        last.length > 0 && last.length !== 3
          ? `${parts.slice(0, -1).join("")}.${last}`
          : t.replace(/\./g, "");
    }
    return t;
  })();

  if (/^\d+(\.\d+)?$/.test(asPlain)) {
    const [intPart, dec = ""] = asPlain.split(".");
    if (!dec) return intPart!;
    return `${intPart}.${dec.slice(0, 6)}`;
  }
  return String(roundMeasureNearest(n, 4));
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

/**
 * CUBICAJE de una línea (m³) = (L × W × H en cm ÷ 1.000.000) × bultos.
 *
 * Fórmula ÚNICA del sistema: se calcula con las dimensiones tal cual (ya vienen
 * normalizadas a 2 decimales) y se redondea el resultado al más cercano. NO se
 * redondea cada dimensión por separado (eso inflaba el volumen) ni hacia arriba.
 */
export function cubicajeM3FromDims(
  l: unknown,
  w: unknown,
  h: unknown,
  bultos: unknown,
  isReempaque = false,
): number {
  if (isReempaque) return 0;
  const L = parseMeasureNumber(l);
  const W = parseMeasureNumber(w);
  const H = parseMeasureNumber(h);
  const b = parseMeasureNumber(bultos);
  if (L <= 0 || W <= 0 || H <= 0 || b <= 0) return 0;
  return roundMeasureNearest(((L * W * H) / 1_000_000) * b);
}

/** Fila mínima para calcular cubicaje. */
export type CubicajeRowInput = {
  l?: unknown;
  w?: unknown;
  h?: unknown;
  bultos?: unknown;
  reempaque?: unknown;
  /** Volumen TOTAL de la línea (m³) declarado; solo se usa si no hay dimensiones. */
  volumenM3?: unknown;
};

/**
 * CUBICAJE total de una fila (m³). Prioriza las dimensiones (L×W×H×bultos); si la
 * fila no tiene dimensiones usa el campo `volumenM3` como volumen total de línea.
 * El reempaque no cubica.
 */
export function cubicajeM3FromRow(row: CubicajeRowInput): number {
  if (row.reempaque === true) return 0;
  const L = parseMeasureNumber(row.l);
  const W = parseMeasureNumber(row.w);
  const H = parseMeasureNumber(row.h);
  const b = parseMeasureNumber(row.bultos);
  if (L > 0 && W > 0 && H > 0 && b > 0) {
    return roundMeasureNearest(((L * W * H) / 1_000_000) * b);
  }
  const vol = parseMeasureNumber(row.volumenM3);
  return vol > 0 ? roundMeasureNearest(vol) : 0;
}

/**
 * CUBICAJE total de varias filas (m³). El total es la SUMA de los cubicajes por
 * fila (ya redondeados), de modo que las filas mostradas siempre cuadran con el
 * total. Devuelve un número redondeado al más cercano.
 */
export function sumCubicajeM3(rows: CubicajeRowInput[]): number {
  const total = rows.reduce((acc, row) => acc + cubicajeM3FromRow(row), 0);
  return roundMeasureNearest(total);
}

/** Texto de cubicaje con 2 decimales (redondeo al más cercano). Usar en TODA la UI/exports. */
export function formatCubicaje2(value: unknown): string {
  return roundMeasureNearest(value).toFixed(MEASURE_DECIMALS);
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
