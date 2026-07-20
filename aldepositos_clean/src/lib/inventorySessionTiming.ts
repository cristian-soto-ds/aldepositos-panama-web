import type { Task } from "@/lib/types/task";

export type InventoryResumeStatus = "in_progress" | "partial";

function toIso(at?: string | Date): string {
  if (at instanceof Date) return at.toISOString();
  if (typeof at === "string" && at.trim()) {
    const d = new Date(at);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function toMs(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Setea `inventoryStartedAt` solo si aún no existe. */
export function ensureInventoryStarted(
  task: Task,
  at?: string | Date,
): Task {
  if (task.inventoryStartedAt) return task;
  return { ...task, inventoryStartedAt: toIso(at) };
}

/**
 * Marca el inventario en pausa.
 * Si ya estaba pausado, no reinicia el reloj de pausa abierta.
 */
export function pauseInventory(task: Task, at?: string | Date): Task {
  const iso = toIso(at);
  const withStart = ensureInventoryStarted(task, iso);
  if (withStart.status === "paused" && withStart.inventoryPausedAt) {
    return withStart;
  }
  return {
    ...withStart,
    status: "paused",
    inventoryPausedAt: iso,
  };
}

/**
 * Cierra la pausa abierta y vuelve a `in_progress` o `partial`.
 * Acumula ms en `inventoryPausedMs`.
 */
export function resumeInventory(
  task: Task,
  resumeStatus: InventoryResumeStatus = "in_progress",
  at?: string | Date,
): Task {
  const iso = toIso(at);
  const nowMs = toMs(iso) ?? Date.now();
  let pausedMs = Math.max(0, Number(task.inventoryPausedMs ?? 0) || 0);

  if (task.inventoryPausedAt) {
    const pausedAtMs = toMs(task.inventoryPausedAt);
    if (pausedAtMs != null && nowMs >= pausedAtMs) {
      pausedMs += nowMs - pausedAtMs;
    }
  }

  return {
    ...task,
    status: resumeStatus,
    inventoryPausedAt: undefined,
    inventoryPausedMs: pausedMs,
  };
}

/**
 * Quita la pausa desde control (supervisor): cierra el reloj de pausa y deja
 * el RA en `pending` (sin badge «En curso»), listo para que alguien lo tome.
 */
export function releaseInventoryPause(task: Task, at?: string | Date): Task {
  const closed = resumeInventory(task, "in_progress", at);
  return { ...closed, status: "pending" };
}

/**
 * Cierra pausa abierta al completar (acumula ms). El caller fija `status: "completed"`.
 */
export function closeOpenPauseOnComplete(
  task: Task,
  at?: string | Date,
): Task {
  if (!task.inventoryPausedAt) return task;
  const closed = resumeInventory(
    task,
    task.type === "detailed" ? "partial" : "in_progress",
    at,
  );
  return { ...closed, inventoryPausedAt: undefined };
}

/**
 * Tiempo activo de trabajo: (fin − start) − pausas acumuladas − pausa abierta.
 * Retorna null si no hay `inventoryStartedAt` usable.
 */
export function activeInventoryMs(
  task: Task,
  completedAt?: string | null,
  now: number = Date.now(),
): number | null {
  const startMs = toMs(task.inventoryStartedAt);
  if (startMs == null) return null;

  const endCandidate =
    toMs(completedAt) ??
    toMs(task.inventoryCompletedBy?.at) ??
    (task.status === "completed" ? toMs(task.updatedAt) : null) ??
    now;

  const endMs = Math.max(startMs, endCandidate);
  let pausedMs = Math.max(0, Number(task.inventoryPausedMs ?? 0) || 0);

  if (task.inventoryPausedAt) {
    const pausedAtMs = toMs(task.inventoryPausedAt);
    if (pausedAtMs != null) {
      pausedMs += Math.max(0, endMs - pausedAtMs);
    }
  }

  return Math.max(0, endMs - startMs - pausedMs);
}

/** Minutos activos redondeados a 1 decimal; null si no medible. */
export function activeInventoryMinutes(
  task: Task,
  completedAt?: string | null,
  now: number = Date.now(),
): number | null {
  const ms = activeInventoryMs(task, completedAt, now);
  if (ms == null) return null;
  return Math.round((ms / 60_000) * 10) / 10;
}

/**
 * Resuelve el status de trabajo post-captura respetando pausa.
 * - completed gana siempre
 * - si estaba paused y no se pide reanudar, se mantiene paused
 * - si no hay captura → pending
 * - si hay captura → in_progress / partial según tipo
 */
export function resolveInventoryWorkStatus(opts: {
  task: Task;
  hasCapture: boolean;
  isCompleted: boolean;
  workStatusWhenActive: InventoryResumeStatus;
  /** true cuando el inventariador reanudó o está guardando trabajo activo */
  forceResume?: boolean;
}): string {
  const {
    task,
    hasCapture,
    isCompleted,
    workStatusWhenActive,
    forceResume = false,
  } = opts;

  if (isCompleted) return "completed";
  if (!hasCapture) return "pending";
  if (task.status === "paused" && !forceResume) return "paused";
  return workStatusWhenActive;
}

/**
 * Aplica start / resume / complete al guardar captura.
 * `forceResume`: true si el usuario editó o pulsó Reanudar (sale de paused).
 */
export function applyInventorySessionOnSave(opts: {
  task: Task;
  hasCapture: boolean;
  isCompleted: boolean;
  workStatusWhenActive: InventoryResumeStatus;
  forceResume?: boolean;
  at?: string | Date;
}): Task {
  const {
    task,
    hasCapture,
    isCompleted,
    workStatusWhenActive,
    forceResume = false,
    at,
  } = opts;
  const iso = toIso(at);
  let next: Task = { ...task };

  if (hasCapture) {
    next = ensureInventoryStarted(next, iso);
  }

  if (isCompleted) {
    next = closeOpenPauseOnComplete(next, iso);
    return {
      ...next,
      status: "completed",
      inventoryPausedAt: undefined,
      updatedAt: iso,
    };
  }

  if (!hasCapture) {
    return {
      ...next,
      status: "pending",
      inventoryPausedAt: undefined,
      updatedAt: iso,
    };
  }

  if (task.status === "paused" && forceResume) {
    return { ...resumeInventory(next, workStatusWhenActive, iso), updatedAt: iso };
  }

  if (task.status === "paused" && !forceResume) {
    return {
      ...next,
      status: "paused",
      inventoryPausedAt: next.inventoryPausedAt ?? iso,
      updatedAt: iso,
    };
  }

  return {
    ...next,
    status: workStatusWhenActive,
    updatedAt: iso,
  };
}
