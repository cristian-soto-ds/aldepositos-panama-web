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
};

export type ReferenceCaptureMode = "with" | "without";
export type CaptureLayout = "table" | "reekon";

export const CAPTURE_LAYOUTS = ["table", "reekon"] as const satisfies readonly CaptureLayout[];

export function isCaptureLayout(value: unknown): value is CaptureLayout {
  return value === "table" || value === "reekon";
}

export const CAPTURE_LAYOUT_STORAGE_KEY = "quick_capture_layout_v1";

export function isConsecutiveReference(ref: string): boolean {
  return /^\d+$/.test(ref.trim());
}

export function rowHasRealReference(ref: string): boolean {
  const t = ref.trim();
  return t.length > 0 && !isConsecutiveReference(t);
}

export function taskHasImportedReferences(rows: QuickMeasureRow[]): boolean {
  return rows.some((r) => rowHasRealReference(String(r.referencia ?? "")));
}

export function applyConsecutiveReferences<T extends QuickMeasureRow>(rows: T[]): T[] {
  return rows.map((row, i) => ({
    ...row,
    referencia: String(i + 1),
  }));
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

    if (rowHasRealReference(fromId)) {
      out[row.id] = fromId;
    } else if (rowHasRealReference(fromIndex)) {
      out[row.id] = fromIndex;
    } else if (rowHasRealReference(current)) {
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
    if (rowHasRealReference(ref)) {
      next[row.id] = ref;
    }
  }
  return next;
}

export function restoreSourceReferences<T extends QuickMeasureRow>(
  rows: T[],
  snapshot: Record<string, string>,
): T[] {
  return rows.map((row) => {
    const saved = snapshot[row.id];
    const savedStr = saved !== undefined ? String(saved).trim() : "";
    const current = String(row.referencia ?? "").trim();

    let referencia: string;
    if (savedStr && rowHasRealReference(savedStr)) {
      referencia = savedStr;
    } else if (savedStr) {
      referencia = savedStr;
    } else if (rowHasRealReference(current)) {
      referencia = current;
    } else {
      referencia = saved !== undefined ? String(saved) : current;
    }

    return { ...row, referencia };
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
