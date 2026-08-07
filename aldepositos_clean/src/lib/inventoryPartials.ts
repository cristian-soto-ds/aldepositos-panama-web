/**
 * Persistencia de jobs de inventario parcial (local + Supabase).
 */

import { supabase } from "@/lib/supabase";

export type InventoryPartialStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "rectification";

export type InventoryPartialJob = {
  id: string;
  taskId: string;
  ra: string;
  containerName: string;
  status: InventoryPartialStatus;
  /** Bultos EN ALMACÉN por id de fila de measureData. */
  warehouseBultosByRowId: Record<string, number>;
  assignedAt: string;
  completedAt?: string;
  completedBy?: {
    email?: string;
    displayName?: string;
    at: string;
  };
  updatedAt: string;
};

const TABLE = "inventory_partials";
const LOCAL_KEY = "aldepositos_inventory_partials_v1";

function readLocal(): InventoryPartialJob[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPartialJob);
  } catch {
    return [];
  }
}

function writeLocal(jobs: InventoryPartialJob[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(jobs));
  } catch {
    /* quota */
  }
}

function isPartialJob(v: unknown): v is InventoryPartialJob {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.taskId === "string" &&
    typeof o.containerName === "string" &&
    typeof o.status === "string"
  );
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `ip-${crypto.randomUUID()}`;
  }
  return `ip-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function fetchInventoryPartials(): Promise<InventoryPartialJob[]> {
  const local = readLocal();
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, payload, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    const remote = (data ?? [])
      .map((row) => {
        const payload = row.payload as InventoryPartialJob;
        if (!isPartialJob(payload)) return null;
        return {
          ...payload,
          id: String(row.id),
          updatedAt:
            payload.updatedAt ||
            (typeof row.updated_at === "string"
              ? row.updated_at
              : new Date().toISOString()),
        };
      })
      .filter((j): j is InventoryPartialJob => !!j);

    if (remote.length > 0) {
      writeLocal(remote);
      return remote;
    }
  } catch {
    /* solo local */
  }
  return local;
}

export async function upsertInventoryPartial(
  job: InventoryPartialJob,
): Promise<InventoryPartialJob> {
  const next: InventoryPartialJob = {
    ...job,
    updatedAt: new Date().toISOString(),
  };
  const local = readLocal();
  const idx = local.findIndex((j) => j.id === next.id);
  const merged = [...local];
  if (idx >= 0) merged[idx] = next;
  else merged.unshift(next);
  writeLocal(merged);

  try {
    const { error } = await supabase.from(TABLE).upsert({
      id: next.id,
      payload: next,
      updated_at: next.updatedAt,
    });
    if (error) throw error;
  } catch {
    /* solo local */
  }
  return next;
}

export async function deleteInventoryPartial(id: string): Promise<void> {
  writeLocal(readLocal().filter((j) => j.id !== id));
  try {
    await supabase.from(TABLE).delete().eq("id", id);
  } catch {
    /* solo local */
  }
}

export function createPendingPartialJob(input: {
  taskId: string;
  ra: string;
  containerName: string;
}): InventoryPartialJob {
  const now = new Date().toISOString();
  return {
    id: newId(),
    taskId: input.taskId,
    ra: String(input.ra ?? "").trim(),
    containerName: String(input.containerName ?? "").trim(),
    status: "pending",
    warehouseBultosByRowId: {},
    assignedAt: now,
    updatedAt: now,
  };
}

/** Inventariador: pendientes + en curso + rectificación (no completados). */
export function filterPartialsForInventariador(
  jobs: InventoryPartialJob[],
): InventoryPartialJob[] {
  return jobs.filter(
    (j) =>
      j.status === "pending" ||
      j.status === "in_progress" ||
      j.status === "rectification",
  );
}

export function isPartialVisibleToInventariador(
  job: InventoryPartialJob,
): boolean {
  return (
    job.status === "pending" ||
    job.status === "in_progress" ||
    job.status === "rectification"
  );
}
