import type { CollectionOrderLine } from "@/lib/types/collectionOrder";

function norm(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function pickMergedField(
  baseVal: unknown,
  localVal: unknown,
  remoteVal: unknown,
): unknown {
  const base = norm(baseVal);
  const local = norm(localVal);
  const remote = norm(remoteVal);
  const localChanged = local !== base;
  const remoteChanged = remote !== base;

  if (localChanged && !remoteChanged) return localVal;
  if (remoteChanged && !localChanged) return remoteVal;
  if (!localChanged && !remoteChanged) {
    return localVal !== undefined ? localVal : remoteVal !== undefined ? remoteVal : baseVal;
  }
  if (local === remote) return localVal;
  // Conflicto en el mismo campo: conservar local (quien está tipando aquí).
  return localVal;
}

function mergeLineThreeWay(
  base: CollectionOrderLine | undefined,
  local: CollectionOrderLine | undefined,
  remote: CollectionOrderLine | undefined,
): CollectionOrderLine | null {
  if (!local && !remote) return null;

  // Existía en baseline: falta en local o remoto = borrado.
  if (base) {
    if (!local || !remote) return null;
  } else {
    if (local && !remote) return { ...local };
    if (remote && !local) return { ...remote };
  }

  const id = String(local!.id || remote!.id || base?.id || "");
  const keys = new Set<keyof CollectionOrderLine>([
    ...Object.keys(base ?? {}),
    ...Object.keys(local ?? {}),
    ...Object.keys(remote ?? {}),
  ] as (keyof CollectionOrderLine)[]);

  const out: CollectionOrderLine = { id };
  for (const key of keys) {
    if (key === "id") continue;
    const picked = pickMergedField(base?.[key], local![key], remote![key]);
    if (picked === undefined || picked === null || picked === "") continue;
    (out as Record<string, unknown>)[key] = picked;
  }
  return out;
}

/**
 * Une líneas concurrentes de una orden de recolección (baseline / local / remoto).
 * Conserva altas locales y remotas; respeta borrados; no pierde filas al agregar.
 */
export function mergeConcurrentCollectionLines(
  baselineLines: CollectionOrderLine[],
  localLines: CollectionOrderLine[],
  remoteLines: CollectionOrderLine[],
): CollectionOrderLine[] {
  // Remoto vacío incompleto: no borrar todo lo local.
  if (remoteLines.length === 0 && localLines.length > 0) {
    return localLines.map((l) => ({ ...l }));
  }

  const baseById = new Map(baselineLines.map((l) => [String(l.id), l]));
  const localById = new Map(localLines.map((l) => [String(l.id), l]));
  const remoteById = new Map(remoteLines.map((l) => [String(l.id), l]));

  const order: string[] = [];
  const seen = new Set<string>();
  const pushId = (id: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    order.push(id);
  };

  for (const row of localLines) pushId(String(row.id));
  for (const row of remoteLines) pushId(String(row.id));
  for (const row of baselineLines) pushId(String(row.id));

  const merged: CollectionOrderLine[] = [];
  for (const id of order) {
    const row = mergeLineThreeWay(
      baseById.get(id),
      localById.get(id),
      remoteById.get(id),
    );
    if (row) merged.push(row);
  }
  return merged;
}
