import type { Task } from "@/lib/types/task";

/** Lista: quita measureData pesado; el editor carga el detalle al abrir. */
export function toListTask(task: Task): Task {
  if (!Array.isArray(task.measureData) || task.measureData.length === 0) {
    return task;
  }
  return { ...task, measureData: [] };
}

/** Tras refetch slim, conserva measureData de unos pocos RA recién hidratados (LRU). */
const SLIM_PRESERVE_MAX = 2;

export function mergeSlimTasksPreservingDetail(
  prev: Task[],
  slim: Task[],
): Task[] {
  if (prev.length === 0) return slim;
  const prevById = new Map(prev.map((t) => [t.id, t]));
  const keepIds = new Set(
    prev
      .filter((t) => Array.isArray(t.measureData) && t.measureData.length > 0)
      .sort(
        (a, b) =>
          Date.parse(String(b.updatedAt ?? 0)) -
          Date.parse(String(a.updatedAt ?? 0)),
      )
      .slice(0, SLIM_PRESERVE_MAX)
      .map((t) => t.id),
  );
  return slim.map((s) => {
    if (!keepIds.has(s.id)) return s;
    const old = prevById.get(s.id);
    if (old && Array.isArray(old.measureData) && old.measureData.length > 0) {
      return { ...s, measureData: old.measureData };
    }
    return s;
  });
}

/** Equality barata: mismos ids + updatedAt (evita JSON.stringify de toda la lista). */
export function tasksListFingerprint(tasks: Task[]): string {
  if (tasks.length === 0) return "0";
  let acc = String(tasks.length);
  for (const t of tasks) {
    acc += `|${t.id}:${t.updatedAt ?? ""}:${t.status}:${t.currentBultos ?? 0}:${t.capturedWeight ?? 0}:${t.completeRowCount ?? 0}`;
  }
  return acc;
}

export function measureDataLooksEmpty(measureData: unknown): boolean {
  return !Array.isArray(measureData) || measureData.length === 0;
}
