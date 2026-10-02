import { normalizeContainerLoadRa } from "@/lib/containerLoadItems";
import type { Task } from "@/lib/types/task";
import type { ContainerLoad, ContainerLoadItem } from "@/lib/types/containerLoad";

export type ContainerLoadItemState =
  | "completed"
  | "in_progress"
  | "pending"
  | "rectification"
  | "not_required"
  | "missing";

export const CONTAINER_LOAD_STATE_LABELS: Record<ContainerLoadItemState, string> = {
  completed: "Inventariado",
  in_progress: "En proceso",
  pending: "Falta inventariar",
  rectification: "En rectificación",
  not_required: "Listo · sin inventario",
  missing: "Esperando OR",
};

export const DEFAULT_NO_INVENTORY_REASON = "No requiere inventario";

export const CONTAINER_LOAD_STATE_CHIP: Record<ContainerLoadItemState, string> = {
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  not_required: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
  pending: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  rectification: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  missing: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

export type ContainerLoadItemView = {
  item: ContainerLoadItem;
  task: Task | null;
  state: ContainerLoadItemState;
  isNext: boolean;
};

export type ContainerLoadSummary = {
  load: ContainerLoad;
  rows: ContainerLoadItemView[];
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  rectification: number;
  /** Marcados por un admin como listos sin inventario. */
  notRequired: number;
  missing: number;
  /** Inventariados + marcados sin inventario. */
  ready: number;
  /** RA que aún no están listos (pendiente + en proceso + rectificación + esperando OR). */
  notInventoried: number;
  totals: { bultos: number; cbm: number; peso: number; capturedBultos: number };
  nextRa: string | null;
};

export function buildTasksByRa(tasks: Task[]): Map<string, Task> {
  const map = new Map<string, Task>();
  for (const t of tasks) {
    const key = normalizeContainerLoadRa(t.ra);
    if (key && !map.has(key)) map.set(key, t);
  }
  return map;
}

export function containerLoadItemState(
  task: Task | null,
  item?: Pick<ContainerLoadItem, "noInventoryRequired">,
): ContainerLoadItemState {
  if (task?.status === "completed") return "completed";
  if (item?.noInventoryRequired) return "not_required";
  if (!task) return "missing";
  if (task.status === "in_progress" || task.status === "paused") return "in_progress";
  if (task.status === "rectification") return "rectification";
  return "pending";
}

export function summarizeContainerLoad(
  load: ContainerLoad,
  tasksByRa: Map<string, Task>,
): ContainerLoadSummary {
  let completed = 0;
  let inProgress = 0;
  let pending = 0;
  let rectification = 0;
  let notRequired = 0;
  let missing = 0;
  let bultos = 0;
  let cbm = 0;
  let peso = 0;
  let capturedBultos = 0;
  let nextRa: string | null = null;

  const rows: ContainerLoadItemView[] = load.items.map((item) => {
    const task = tasksByRa.get(normalizeContainerLoadRa(item.ra)) ?? null;
    const state = containerLoadItemState(task, item);
    if (state === "completed") completed += 1;
    else if (state === "in_progress") inProgress += 1;
    else if (state === "pending") pending += 1;
    else if (state === "rectification") rectification += 1;
    else if (state === "not_required") notRequired += 1;
    else missing += 1;
    bultos += item.bultos ?? task?.expectedBultos ?? 0;
    cbm += item.cbm ?? 0;
    peso += item.peso ?? 0;
    capturedBultos += task?.currentBultos ?? 0;
    // Siguiente = primero (arriba) con RA en sistema que no esté terminado.
    const isNext =
      nextRa === null &&
      (state === "pending" || state === "in_progress" || state === "rectification");
    if (isNext) nextRa = item.ra;
    return { item, task, state, isNext };
  });

  return {
    load,
    rows,
    total: rows.length,
    completed,
    inProgress,
    pending,
    rectification,
    notRequired,
    missing,
    ready: completed + notRequired,
    notInventoried: rows.length - completed - notRequired,
    totals: {
      bultos,
      cbm: Math.round(cbm * 100) / 100,
      peso: Math.round(peso * 100) / 100,
      capturedBultos,
    },
    nextRa,
  };
}

/** Orden de trabajo: `sortOrder` ascendente; empate por fecha de creación. */
export function compareContainerLoadWorkOrder(a: ContainerLoad, b: ContainerLoad): number {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
}

/** RA (normalizados) que están en algún cargue abierto → salen de Pendientes/Prioridad. */
export function raKeysInOpenContainerLoads(loads: ContainerLoad[]): Set<string> {
  const out = new Set<string>();
  for (const load of loads) {
    if (load.status !== "open") continue;
    for (const item of load.items) {
      const key = normalizeContainerLoadRa(item.ra);
      if (key) out.add(key);
    }
  }
  return out;
}

export function taskIsInOpenContainerLoad(task: Task, openKeys: Set<string>): boolean {
  if (openKeys.size === 0) return false;
  return openKeys.has(normalizeContainerLoadRa(task.ra));
}

export type InventoryTab =
  | "pending"
  | "priority"
  | "completed"
  | "rectification"
  | "containerLoad";

/** Pestaña de Inventarios donde aparece el RA; un cargue abierto le gana a todas. */
export function inventoryTabForTask(
  task: Task,
  openKeys: Set<string>,
): InventoryTab | null {
  if (taskIsInOpenContainerLoad(task, openKeys)) return "containerLoad";
  if (task.status === "completed") return "completed";
  if (task.status === "rectification") return "rectification";
  if (
    task.status !== "pending" &&
    task.status !== "in_progress" &&
    task.status !== "paused"
  ) {
    return null;
  }
  return task.containerDraft === true || task.dispatched === true
    ? "priority"
    : "pending";
}

/** RA (normalizado) → nombre del cargue abierto que ya lo tiene. */
export function findRaConflicts(
  loads: ContainerLoad[],
  ras: string[],
  excludeLoadId?: string,
): Map<string, string> {
  const wanted = new Set(ras.map(normalizeContainerLoadRa).filter(Boolean));
  const out = new Map<string, string>();
  if (wanted.size === 0) return out;
  for (const load of loads) {
    if (load.status !== "open" || load.id === excludeLoadId) continue;
    for (const item of load.items) {
      const key = normalizeContainerLoadRa(item.ra);
      if (wanted.has(key) && !out.has(key)) out.set(key, load.name);
    }
  }
  return out;
}

export function describeRaConflicts(conflicts: Map<string, string>): string {
  const parts = [...conflicts].map(([ra, name]) => `RA ${ra} (en «${name}»)`);
  const shown = parts.slice(0, 6).join(", ");
  const more = parts.length > 6 ? ` y ${parts.length - 6} más` : "";
  return `${shown}${more}`;
}
