/**
 * Copias verificables de inventario en `public.ra_inventory_snapshots`.
 * - initial: primer cierre a completed
 * - rectification: cierre posterior (desde rectificación o si ya había initial)
 */

import { supabase } from "@/lib/supabase";
import type { Task } from "@/lib/types/task";

export type RaInventorySnapshotKind = "initial" | "rectification";

export type RaInventorySnapshotRow = {
  id: string;
  task_id: string;
  ra: string;
  kind: RaInventorySnapshotKind;
  version: number;
  saved_at: string;
  saved_by_email: string | null;
  saved_by_name: string | null;
  payload: Task;
};

function normalizeStatus(s: unknown): string {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

/** ¿Conviene intentar guardar una copia tras persistir el RA? */
export function shouldAttemptRaInventorySnapshot(
  priorStatus: string | undefined,
  nextStatus: string | undefined,
): boolean {
  if (normalizeStatus(nextStatus) !== "completed") return false;
  const prior = normalizeStatus(priorStatus);
  // Primera vez / desde trabajo / desde rectificación.
  if (prior !== "completed") return true;
  // RA ya completed: solo si aún no hay historial (RAs cerrados antes de esta feature).
  return true;
}

export async function countRaInventorySnapshots(taskId: string): Promise<number> {
  const { count, error } = await supabase
    .from("ra_inventory_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("task_id", taskId);
  if (error) throw error;
  return count ?? 0;
}

export async function nextRaInventorySnapshotVersion(
  taskId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("ra_inventory_snapshots")
    .select("version")
    .eq("task_id", taskId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const last = typeof data?.version === "number" ? data.version : 0;
  return last + 1;
}

function resolveKind(
  priorStatus: string | undefined,
  existingCount: number,
): RaInventorySnapshotKind {
  if (normalizeStatus(priorStatus) === "rectification") return "rectification";
  if (existingCount <= 0) return "initial";
  return "rectification";
}

/**
 * Inserta snapshot si corresponde. Idempotente ante RAs ya completed sin historial.
 * No lanza al caller de guardado: loguea y sigue (el inventario ya está en `tasks`).
 */
export async function saveRaInventorySnapshotAfterPersist(opts: {
  priorStatus: string | undefined;
  task: Task;
}): Promise<{ saved: boolean; kind?: RaInventorySnapshotKind; version?: number }> {
  const { priorStatus, task } = opts;
  if (!shouldAttemptRaInventorySnapshot(priorStatus, task.status)) {
    return { saved: false };
  }

  const prior = normalizeStatus(priorStatus);
  let existingCount = 0;
  try {
    existingCount = await countRaInventorySnapshots(task.id);
  } catch (e) {
    console.warn("[ra_inventory_snapshots] no se pudo contar versiones:", e);
    return { saved: false };
  }

  // Correcciones sobre un completed: no spamear versiones en cada autosave.
  if (prior === "completed" && existingCount > 0) {
    return { saved: false };
  }

  const kind = resolveKind(priorStatus, existingCount);
  let version = 1;
  try {
    version = await nextRaInventorySnapshotVersion(task.id);
  } catch (e) {
    console.warn("[ra_inventory_snapshots] no se pudo obtener version:", e);
    return { saved: false };
  }

  const savedBy = task.inventoryCompletedBy;
  const row = {
    task_id: task.id,
    ra: String(task.ra ?? "").trim(),
    kind,
    version,
    saved_at: new Date().toISOString(),
    saved_by_email: savedBy?.email?.trim() || null,
    saved_by_name: savedBy?.displayName?.trim() || null,
    payload: task,
  };

  const { error } = await supabase.from("ra_inventory_snapshots").insert(row);
  if (error) {
    // unique (task_id, version) en carrera: reintentar una vez con version+1
    if (error.code === "23505") {
      try {
        const v2 = await nextRaInventorySnapshotVersion(task.id);
        const { error: err2 } = await supabase
          .from("ra_inventory_snapshots")
          .insert({ ...row, version: v2 });
        if (err2) {
          console.warn("[ra_inventory_snapshots] insert reintento falló:", err2);
          return { saved: false };
        }
        return { saved: true, kind, version: v2 };
      } catch (e) {
        console.warn("[ra_inventory_snapshots] reintento falló:", e);
        return { saved: false };
      }
    }
    console.warn("[ra_inventory_snapshots] insert falló:", error);
    return { saved: false };
  }

  return { saved: true, kind, version };
}
