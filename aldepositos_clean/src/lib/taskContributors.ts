import type { Task } from "@/lib/types/task";
import { presenceVisibleLabel } from "@/lib/viewerIdentity";

function mergeContributor(
  task: Task,
  email: string,
  displayName: string,
): Task {
  const at = new Date().toISOString();
  const prev = task.contributors ?? [];
  const idx = prev.findIndex((c) => c.email.toLowerCase() === email);
  const entry = { email, displayName, at };
  const contributors =
    idx >= 0
      ? prev.map((c, i) => (i === idx ? { ...c, ...entry } : c))
      : [...prev, entry];
  return { ...task, contributors };
}

/** Registra quién capturó medidas/peso y quién cerró el inventario. */
export function applyInventoryAttribution(
  task: Task,
  options: {
    userKey: string | null | undefined;
    userLabel: string | null | undefined;
    hasCapture: boolean;
    isCompleted: boolean;
  },
): Task {
  const email = String(options.userKey ?? "").trim().toLowerCase();
  if (!email) return task;

  const displayName = presenceVisibleLabel(
    options.userLabel,
    email.includes("@") ? email : null,
  );

  let next = task;
  if (options.hasCapture) {
    next = mergeContributor(next, email, displayName);
  }
  if (options.isCompleted) {
    next = {
      ...next,
      inventoryCompletedBy: {
        email,
        displayName,
        at: new Date().toISOString(),
      },
    };
  }
  return next;
}

export function inventoryCompletedByLabel(task: Task): string | null {
  const name = task.inventoryCompletedBy?.displayName?.trim();
  if (name) return name;
  const last = task.contributors?.[task.contributors.length - 1];
  return last?.displayName?.trim() || null;
}
