import type { Task } from "@/lib/types/task";
import {
  isAllowedInventoryOperator,
  resolveAllowedInventoryOperator,
} from "@/lib/inventoryOperatorsAllowlist";
import { isLikelyEmail, presenceVisibleLabel } from "@/lib/viewerIdentity";

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

function resolveAttributionIdentity(
  userKey: string,
  userLabel: string | null | undefined,
): { email: string; displayName: string } | null {
  const email = String(userKey ?? "").trim().toLowerCase();
  if (!email) return null;

  const rawLabel = String(userLabel ?? "").trim();
  const displayName = presenceVisibleLabel(
    userLabel,
    email.includes("@") ? email : null,
  );
  const nameForAllowlist =
    displayName === "Operador" && rawLabel && !isLikelyEmail(rawLabel)
      ? rawLabel
      : displayName;
  const storedName =
    rawLabel && !isLikelyEmail(rawLabel) ? rawLabel : displayName;

  if (!isAllowedInventoryOperator(email, nameForAllowlist)) {
    return null;
  }

  return { email, displayName: storedName };
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
  const identity = resolveAttributionIdentity(
    String(options.userKey ?? ""),
    options.userLabel,
  );
  if (!identity) return task;

  const { email, displayName } = identity;

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

/** Nombre del inventariador permitido que capturó (ignora supervisores u otros operadores). */
export function inventoryCompletedByLabel(task: Task): string | null {
  const resolved = resolveAllowedInventoryOperator(task);
  return resolved?.displayName?.trim() || null;
}
