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
  // Reempaque: no lleva bulto/peso/medidas → se considera LISTA con solo la referencia.
  if (row.reempaque === true) return referencia.length > 0;
  const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
  const l = parseFloat(String(row.l ?? 0)) || 0;
  const w = parseFloat(String(row.w ?? 0)) || 0;
  const h = parseFloat(String(row.h ?? 0)) || 0;
  return referencia.length > 0 && bultos > 0 && l > 0 && w > 0 && h > 0;
}

export type QuickRowMissingField = "referencia" | "bultos" | "largo" | "ancho" | "alto";

export const QUICK_ROW_MISSING_LABELS: Record<QuickRowMissingField, string> = {
  referencia: "Referencia",
  bultos: "Bultos",
  largo: "Largo",
  ancho: "Ancho",
  alto: "Alto",
};

/** Campos que aún faltan capturar en una línea (para lista de referencias en Reekon). */
export function getQuickRowMissingFields(row: QuickMeasureRow): QuickRowMissingField[] {
  const referencia = String(row.referencia ?? "").trim();
  if (row.reempaque === true) {
    return referencia.length > 0 ? [] : ["referencia"];
  }
  const missing: QuickRowMissingField[] = [];
  if (!referencia) missing.push("referencia");
  if (!(parseFloat(String(row.bultos ?? 0)) > 0)) missing.push("bultos");
  if (!(parseFloat(String(row.l ?? 0)) > 0)) missing.push("largo");
  if (!(parseFloat(String(row.w ?? 0)) > 0)) missing.push("ancho");
  if (!(parseFloat(String(row.h ?? 0)) > 0)) missing.push("alto");
  return missing;
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

/**
 * Aplica solo cambios de `reempaque` locales sobre las filas del servidor.
 * Permite que monitores (u otros no inventariadores) marquen reempaques sin
 * pisar medidas/peso que ya capturó el inventariador en otras líneas.
 */
export function mergeReempaqueFlagsOntoRows<T extends QuickMeasureRow>(
  serverRows: T[],
  localRows: T[],
): { rows: T[]; changed: boolean } {
  const localById = new Map(
    localRows.map((r) => [String(r.id ?? ""), r] as const),
  );

  if (serverRows.length === 0) {
    const hasReempaque = localRows.some((r) => r.reempaque === true);
    if (!hasReempaque) {
      return { rows: serverRows, changed: false };
    }
    return {
      rows: stripQuickRowsForPersist(localRows) as T[],
      changed: true,
    };
  }

  let changed = false;
  const next = serverRows.map((serverRow) => {
    const id = String(serverRow.id ?? "");
    const local = localById.get(id);
    if (!local) return serverRow;

    const want = local.reempaque === true;
    const have = serverRow.reempaque === true;
    if (want === have) return serverRow;

    changed = true;
    if (want) {
      return stripQuickMeasureRow({
        ...serverRow,
        reempaque: true,
        bultos: "",
        weight: "",
        l: "",
        w: "",
        h: "",
      } as T);
    }
    return stripQuickMeasureRow({
      ...serverRow,
      reempaque: false,
    } as T);
  });

  // Filas nuevas solo en local marcadas como reempaque (p. ej. línea agregada).
  for (const local of localRows) {
    const id = String(local.id ?? "");
    if (!id || next.some((r) => String(r.id ?? "") === id)) continue;
    if (local.reempaque !== true) continue;
    changed = true;
    next.push(stripQuickMeasureRow(local) as T);
  }

  return { rows: next, changed };
}

const MERGE_ROW_KEYS = [
  "referencia",
  "descripcion",
  "bultos",
  "unidadesPorBulto",
  "pesoPorBulto",
  "l",
  "w",
  "h",
  "weight",
  "volumenM3",
  "unidad",
  "reempaque",
  "bultoContenedor",
  "referenciasContenedor",
  "reempaqueRefs",
  "referenciaContenedora",
  "pallet",
  "palletWeight",
] as const satisfies readonly (keyof QuickMeasureRow)[];

function normMergeValue(value: unknown): string {
  if (value === true) return "true";
  if (value === false || value === undefined || value === null) return "";
  if (Array.isArray(value)) return JSON.stringify(value);
  const s = String(value).trim();
  if (s === "0" || s === "0.0" || s === "0.00") return "";
  return s;
}

function isMergeValueFilled(value: unknown): boolean {
  return normMergeValue(value).length > 0;
}

/**
 * Elige un campo en merge a 3 vías (baseline servidor / local / remoto).
 * Conserva ediciones locales y remotas cuando no colisionan.
 */
function pickMergedField(
  baseVal: unknown,
  localVal: unknown,
  remoteVal: unknown,
): unknown {
  const base = normMergeValue(baseVal);
  const local = normMergeValue(localVal);
  const remote = normMergeValue(remoteVal);
  const localChanged = local !== base;
  const remoteChanged = remote !== base;

  if (localChanged && !remoteChanged) return localVal;
  if (remoteChanged && !localChanged) return remoteVal;
  if (!localChanged && !remoteChanged) {
    return localVal !== undefined ? localVal : remoteVal !== undefined ? remoteVal : baseVal;
  }
  // Ambos cambiaron desde el baseline.
  if (local === remote) return localVal;
  if (isMergeValueFilled(localVal) && !isMergeValueFilled(remoteVal)) return localVal;
  if (isMergeValueFilled(remoteVal) && !isMergeValueFilled(localVal)) return remoteVal;
  // Conflicto real en el mismo campo: preferir local (no perder lo que se está midiendo aquí).
  return localVal;
}

function mergeQuickRowThreeWay<T extends QuickMeasureRow>(
  base: T | undefined,
  local: T | undefined,
  remote: T | undefined,
): T | null {
  // Ambos ausentes.
  if (!local && !remote) return null;

  // Existía en el baseline: si falta en local O en remoto = eliminación.
  // Así, cuando A borra una fila, B deja de verla (y viceversa).
  if (base) {
    if (!local || !remote) return null;
  } else {
    // No estaba en baseline → fila nueva de un lado.
    if (local && !remote) return stripQuickMeasureRow(local) as T;
    if (remote && !local) return stripQuickMeasureRow(remote) as T;
  }

  const id = String(local!.id || remote!.id || base?.id || "");
  const out: QuickMeasureRow = { id, referencia: "", bultos: "" };

  for (const key of MERGE_ROW_KEYS) {
    const picked = pickMergedField(base?.[key], local![key], remote![key]);
    if (picked === undefined || picked === "" || picked === false) continue;
    if (Array.isArray(picked) && picked.length === 0) continue;
    (out as Record<string, unknown>)[key] = picked;
  }

  return stripQuickMeasureRow(out as T) as T;
}

export type MergeConcurrentQuickRowsOptions = {
  /** Filas eliminadas localmente que aún no confirmó el servidor. */
  deletedIds?: Iterable<string>;
};

/**
 * Une capturas concurrentes de varios inventariadores sobre el mismo RA.
 * - Filas nuevas de cualquiera se conservan.
 * - Eliminaciones (fila en baseline ausente en local o remoto) se respetan.
 * - En la misma fila, cada campo se resuelve a 3 vías vs el último estado persistido.
 */
export function mergeConcurrentQuickRows<T extends QuickMeasureRow>(
  baselineRows: T[],
  localRows: T[],
  remoteRows: T[],
  options?: MergeConcurrentQuickRowsOptions,
): T[] {
  // Payload remoto vacío = incompleto (slim/eco), no un borrado masivo real.
  // En captura siempre queda ≥1 fila; [] no debe vaciar el editor local.
  if (remoteRows.length === 0 && localRows.length > 0) {
    return stripQuickRowsForPersist(localRows) as T[];
  }

  const deleted = new Set(
    Array.from(options?.deletedIds ?? []).map((id) => String(id)),
  );
  const baseById = new Map(
    baselineRows.map((r) => [String(r.id ?? ""), r] as const),
  );
  const localById = new Map(
    localRows.map((r) => [String(r.id ?? ""), r] as const),
  );
  const remoteById = new Map(
    remoteRows.map((r) => [String(r.id ?? ""), r] as const),
  );

  // Remoto quitó una fila que seguía en baseline/local → borrado remoto.
  for (const id of baseById.keys()) {
    if (!remoteById.has(id) && localById.has(id)) deleted.add(id);
  }

  const order: string[] = [];
  const seen = new Set<string>();
  const pushId = (id: string) => {
    if (!id || deleted.has(id) || seen.has(id)) return;
    seen.add(id);
    order.push(id);
  };

  // Orden: baseline, luego locales nuevas, luego remotas nuevas.
  for (const row of baselineRows) pushId(String(row.id ?? ""));
  for (const row of localRows) pushId(String(row.id ?? ""));
  for (const row of remoteRows) pushId(String(row.id ?? ""));

  const merged: T[] = [];
  for (const id of order) {
    if (deleted.has(id)) continue;
    const row = mergeQuickRowThreeWay(
      baseById.get(id),
      localById.get(id),
      remoteById.get(id),
    );
    if (row) merged.push(row);
  }
  return merged;
}
