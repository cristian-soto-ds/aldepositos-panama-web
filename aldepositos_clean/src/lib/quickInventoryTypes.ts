import { normalizeMeasureFieldsOnRow } from "@/lib/measureDecimals";

/** Tipos y utilidades compartidas — ingreso rápido / vista Reekon */

export type QuickMeasureRow = {
  id: string;
  referencia?: string;
  descripcion?: string;
  bultos?: string | number;
  unidadesPorBulto?: string | number;
  pesoPorBulto?: string | number;
  l?: string | number;
  w?: string | number;
  h?: string | number;
  weight?: string | number;
  volumenM3?: string | number;
  unidad?: string;
  reempaque?: boolean;
  bultoContenedor?: string;
  referenciasContenedor?: string;
  reempaqueRefs?: string[];
  referenciaContenedora?: string;
  /** Modo paletizado: número de paleta al que pertenece la fila (agrupación en captura). */
  pallet?: number;
  /** Modo paletizado: peso total de la paleta (kg). Se replica en todas las filas de la paleta. */
  palletWeight?: string | number;
};

export type ReferenceCaptureMode = "with" | "without" | "palletized";

export function isReferenceCaptureMode(value: unknown): value is ReferenceCaptureMode {
  return value === "with" || value === "without" || value === "palletized";
}
export type CaptureLayout = "table" | "reekon";

export const CAPTURE_LAYOUTS = ["table", "reekon"] as const satisfies readonly CaptureLayout[];

export function isCaptureLayout(value: unknown): value is CaptureLayout {
  return value === "table" || value === "reekon";
}

export const CAPTURE_LAYOUT_STORAGE_KEY = "quick_capture_layout_v1";

export function isConsecutiveReference(ref: string): boolean {
  return /^\d+$/.test(ref.trim());
}

/** Referencia capturada por el usuario (incluye códigos solo numéricos, ej. "21", "1234"). */
export function hasReferenceValue(ref: string): boolean {
  return String(ref ?? "").trim().length > 0;
}

export function rowHasRealReference(ref: string): boolean {
  return hasReferenceValue(ref);
}

/** Bloque 1,2,3…n generado por modo «Sin refs» (no confundir con códigos numéricos reales). */
export function isAutoConsecutiveBlock(rows: QuickMeasureRow[]): boolean {
  if (rows.length === 0) return false;
  return rows.every(
    (row, i) => String(row.referencia ?? "").trim() === String(i + 1),
  );
}

export function taskHasImportedReferences(rows: QuickMeasureRow[]): boolean {
  return rows.some((r) => hasReferenceValue(String(r.referencia ?? "")));
}

export function applyConsecutiveReferences<T extends QuickMeasureRow>(rows: T[]): T[] {
  return rows.map((row, i) => {
    const ref = String(i + 1);
    // Conserva la misma referencia de objeto si el número ya es correcto: así la
    // memoización de las filas no se rompe y no se re-renderiza toda la tabla.
    return String(row.referencia ?? "") === ref ? row : { ...row, referencia: ref };
  });
}

export function buildReferenceSnapshot(rows: QuickMeasureRow[]): Record<string, string> {
  return Object.fromEntries(
    rows.map((r) => [r.id, String(r.referencia ?? "")]),
  );
}

/**
 * Snapshot de referencias originales (servidor + filas actuales).
 * Debe llamarse **antes** de applyConsecutiveReferences.
 */
export function buildSourceReferenceSnapshot(
  rows: QuickMeasureRow[],
  serverRows: QuickMeasureRow[] = [],
): Record<string, string> {
  const serverById = new Map(
    serverRows.map((r) => [r.id, String(r.referencia ?? "").trim()]),
  );
  const out: Record<string, string> = {};

  rows.forEach((row, index) => {
    const fromId = serverById.get(row.id) ?? "";
    const fromIndex = String(serverRows[index]?.referencia ?? "").trim();
    const current = String(row.referencia ?? "").trim();

    if (hasReferenceValue(fromId)) {
      out[row.id] = fromId;
    } else if (hasReferenceValue(fromIndex)) {
      out[row.id] = fromIndex;
    } else if (hasReferenceValue(current)) {
      out[row.id] = current;
    } else if (fromId) {
      out[row.id] = fromId;
    } else if (fromIndex) {
      out[row.id] = fromIndex;
    } else {
      out[row.id] = current;
    }
  });

  return out;
}

/** Al pasar a modo sin refs: conserva refs reales en snapshot sin pisar las importadas. */
export function captureSourceReferencesFromRows(
  rows: QuickMeasureRow[],
  snapshot: Record<string, string>,
): Record<string, string> {
  const next = { ...snapshot };
  for (const row of rows) {
    const ref = String(row.referencia ?? "").trim();
    if (ref) {
      next[row.id] = ref;
    }
  }
  return next;
}

/**
 * Fusiona snapshots sin reemplazar referencias reales por consecutivos (1, 2, 3…).
 */
export function mergePreservingRealReferences(
  existing: Record<string, string>,
  incoming: Record<string, string>,
): Record<string, string> {
  const next = { ...existing };
  for (const [id, ref] of Object.entries(incoming)) {
    const incomingRef = String(ref ?? "").trim();
    const existingRef = String(next[id] ?? "").trim();
    if (!incomingRef) continue;
    if (existingRef && isConsecutiveReference(existingRef) && !isConsecutiveReference(incomingRef)) {
      next[id] = incomingRef;
      continue;
    }
    if (existingRef && !isConsecutiveReference(existingRef) && isConsecutiveReference(incomingRef)) {
      continue;
    }
    next[id] = incomingRef;
  }
  return next;
}

export function restoreSourceReferences<T extends QuickMeasureRow>(
  rows: T[],
  snapshot: Record<string, string>,
): T[] {
  return rows.map((row) => {
    const savedStr = String(snapshot[row.id] ?? "").trim();
    const current = String(row.referencia ?? "").trim();

    if (savedStr) {
      return { ...row, referencia: savedStr };
    }
    return { ...row, referencia: current };
  });
}

export function renumberConsecutiveReferences<T extends QuickMeasureRow>(rows: T[]): T[] {
  return applyConsecutiveReferences(rows);
}

export function nextConsecutiveReference(rows: QuickMeasureRow[]): string {
  let max = 0;
  for (const row of rows) {
    const n = parseInt(String(row.referencia ?? ""), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return String(max + 1);
}

/** Modo paletizado: número de paleta más alto presente en las filas (0 si ninguna). */
export function maxPalletNumber(rows: QuickMeasureRow[]): number {
  let max = 0;
  for (const row of rows) {
    const n = Number(row.pallet);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/** Asegura que todas las filas tengan un número de paleta válido (por defecto 1). */
export function ensurePalletNumbers<T extends QuickMeasureRow>(rows: T[]): T[] {
  return rows.map((row) => {
    const n = Number(row.pallet);
    return Number.isFinite(n) && n >= 1 ? row : { ...row, pallet: 1 };
  });
}

/** Renumera las paletas a 1..k consecutivas, conservando el orden de aparición. */
export function renumberPallets<T extends QuickMeasureRow>(rows: T[]): T[] {
  const order: number[] = [];
  for (const row of rows) {
    const p = Math.max(1, Number(row.pallet) || 1);
    if (!order.includes(p)) order.push(p);
  }
  const remap = new Map(order.map((p, i) => [p, i + 1]));
  return rows.map((row) => ({
    ...row,
    pallet: remap.get(Math.max(1, Number(row.pallet) || 1)) ?? 1,
  }));
}

export function isQuickRowComplete(row: QuickMeasureRow): boolean {
  const referencia = String(row.referencia ?? "").trim();
  const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
  const l = parseFloat(String(row.l ?? 0)) || 0;
  const w = parseFloat(String(row.w ?? 0)) || 0;
  const h = parseFloat(String(row.h ?? 0)) || 0;
  return referencia.length > 0 && bultos > 0 && l > 0 && w > 0 && h > 0;
}

export function formatRowLabel(
  index: number,
  row: QuickMeasureRow,
  referenceMode: ReferenceCaptureMode,
): string {
  if (referenceMode === "without") {
    return `Bulto ${index + 1}`;
  }
  const ref = String(row.referencia ?? "").trim();
  return ref ? `${index + 1}. ${ref}` : `${index + 1}. —`;
}

/** Campos de captura en almacén (ingreso rápido / guía aérea), no del OR. */
const QUICK_WAREHOUSE_CAPTURE_KEYS = [
  "l",
  "w",
  "h",
  "weight",
  "volumenM3",
  "unidad",
  "reempaque",
  "bultoContenedor",
  "referenciasContenedor",
  "referenciaContenedora",
  "reempaqueRefs",
  "pallet",
  "palletWeight",
] as const;

/**
 * Ingreso rápido: solo referencia + bultos desde OR; medidas/peso los toma el inventariado.
 * Elimina campos propios del módulo detallado (descripción, und/bulto, pesoPorBulto).
 */
export function stripQuickMeasureRow<T extends QuickMeasureRow>(row: T): T {
  const out: QuickMeasureRow = {
    id: row.id,
    referencia: row.referencia ?? "",
    bultos: row.bultos ?? "",
  };
  for (const key of QUICK_WAREHOUSE_CAPTURE_KEYS) {
    const v = row[key];
    if (v === undefined || v === "" || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    (out as Record<string, unknown>)[key] = v;
  }
  return normalizeMeasureFieldsOnRow(out as Record<string, unknown>) as T;
}

export function stripQuickRowsForPersist<T extends QuickMeasureRow>(rows: T[]): T[] {
  return rows.map(stripQuickMeasureRow);
}
