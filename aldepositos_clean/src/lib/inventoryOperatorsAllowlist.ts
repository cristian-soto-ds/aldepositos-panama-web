import type { Task } from "@/lib/types/task";
import {
  getInventariadorById,
  resolveInventariadorId,
} from "@/lib/inventariadoresRoster";

export type InventoryOperatorEntry = {
  /** Nombres aceptados (perfiles.nombre_completo o variantes cortas). */
  displayNames: string[];
  /** Emails opcionales en minúsculas para match exacto. */
  emails: string[];
};

/** Inventariadores que capturan medidas en ingreso rápido / Reekon. */
export const INVENTORY_OPERATORS: InventoryOperatorEntry[] = [
  {
    displayNames: ["Jahir Jimenez", "Jahir"],
    emails: [],
  },
  {
    displayNames: ["Claudio Guitierrez", "Claudio Gutierrez", "Claudio"],
    emails: [],
  },
  {
    displayNames: ["Raul Lezcano", "Raúl Lezcano", "Raul"],
    emails: [],
  },
];

export type ResolvedInventoryOperator = {
  email: string;
  displayName: string;
  at?: string;
};

function normalizeName(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function namesMatch(candidate: string, allowed: string): boolean {
  const a = normalizeName(candidate);
  const b = normalizeName(allowed);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const aParts = a.split(" ");
  const bParts = b.split(" ");
  const aFirst = aParts[0] ?? "";
  const bFirst = bParts[0] ?? "";
  if (aFirst && bFirst && aFirst === bFirst && aParts.length === 1) return true;
  return false;
}

function matchOperatorEntry(
  email: string | undefined,
  displayName: string | undefined,
): InventoryOperatorEntry | null {
  const mail = String(email ?? "").trim().toLowerCase();
  const name = String(displayName ?? "").trim();

  for (const op of INVENTORY_OPERATORS) {
    if (mail && op.emails.some((e) => e.toLowerCase() === mail)) {
      return op;
    }
  }

  if (!name) return null;

  for (const op of INVENTORY_OPERATORS) {
    if (op.displayNames.some((allowed) => namesMatch(name, allowed))) {
      return op;
    }
  }

  return null;
}

export function isAllowedInventoryOperator(
  email?: string | null,
  displayName?: string | null,
): boolean {
  return matchOperatorEntry(
    String(email ?? "").trim() || undefined,
    String(displayName ?? "").trim() || undefined,
  ) != null;
}

/**
 * Solo inventariadores del roster (Jahir, Claudio, Raul) pueden pausar/reanudar
 * y recibir el prompt al salir. Monitores salen sin diálogo.
 */
export function canManageInventoryPause(
  email?: string | null,
  displayName?: string | null,
): boolean {
  return isAllowedInventoryOperator(email, displayName);
}

function toResolved(
  email: string,
  displayName: string | undefined,
  at?: string,
): ResolvedInventoryOperator {
  const entry = matchOperatorEntry(email, displayName);
  const canonical =
    entry?.displayNames[0] ??
    (String(displayName ?? "").trim() || email);
  return {
    email: email.toLowerCase(),
    displayName: canonical,
    at,
  };
}

/**
 * Resuelve el inventariador permitido de un RA:
 * 1) inventoryCompletedBy si es permitido
 * 2) último contributor permitido (más reciente)
 */
export type LivePresenceIdentity = {
  userKey: string;
  name: string;
  rawLabel?: string;
};

function resolveOperatorFromIdentity(
  userKey: string,
  ...nameCandidates: Array<string | undefined>
): ResolvedInventoryOperator | null {
  const key = String(userKey ?? "").trim();
  if (!key) return null;
  const email = key.includes("@") ? key : undefined;

  for (const candidate of nameCandidates) {
    const name = String(candidate ?? "").trim();
    if (!name) continue;
    if (isAllowedInventoryOperator(email ?? null, name)) {
      return toResolved(email ?? key, name);
    }
    const rosterId = resolveInventariadorId(name, email ?? key);
    if (rosterId) {
      const entry = getInventariadorById(rosterId);
      if (entry) {
        return {
          email: (email ?? key).toLowerCase(),
          displayName: entry.name,
        };
      }
    }
  }

  return null;
}

/** Inventariador permitido con presencia activa en un RA (ingreso rápido / detallado). */
export function resolveLiveInventoryOperator(
  operators: LivePresenceIdentity[],
): ResolvedInventoryOperator | null {
  for (const op of operators) {
    const resolved = resolveOperatorFromIdentity(
      op.userKey,
      op.rawLabel,
      op.name,
    );
    if (resolved) return resolved;
  }
  return null;
}

/**
 * Inventariador permitido con `contributors[].at` más reciente.
 * No depende del orden del array (mergeContributor actualiza in-place).
 */
export function resolveLatestAllowedContributor(
  task: Task,
): ResolvedInventoryOperator | null {
  const contributors = task.contributors ?? [];
  let best: ResolvedInventoryOperator | null = null;
  let bestAt = "";

  for (const c of contributors) {
    if (!c?.email) continue;
    if (!isAllowedInventoryOperator(c.email, c.displayName)) continue;
    const at = String(c.at ?? "").trim();
    if (!best || at > bestAt) {
      best = toResolved(c.email, c.displayName, c.at);
      bestAt = at;
    }
  }

  return best;
}

/**
 * Etiqueta «En curso»:
 * 1) inventariador con presencia en vivo
 * 2) si status in_progress/partial → último inventariador por `at`
 */
export function resolveActiveInventoryOperatorLabel(
  task: Task,
  operators: LivePresenceIdentity[],
): string | null {
  const live = resolveLiveInventoryOperator(operators);
  if (live?.displayName) return live.displayName;

  if (task.status === "in_progress" || task.status === "partial") {
    return resolveLatestAllowedContributor(task)?.displayName ?? null;
  }

  return null;
}

/** Nombre para badge «En pausa» (último inventariador por `at`). */
export function resolvePausedInventoryOperatorLabel(task: Task): string | null {
  if (task.status !== "paused") return null;
  return resolveLatestAllowedContributor(task)?.displayName ?? null;
}

export function resolveAllowedInventoryOperator(
  task: Task,
): ResolvedInventoryOperator | null {
  const completed = task.inventoryCompletedBy;
  if (
    completed?.email &&
    isAllowedInventoryOperator(completed.email, completed.displayName)
  ) {
    return toResolved(
      completed.email,
      completed.displayName,
      completed.at,
    );
  }

  const contributors = task.contributors ?? [];
  for (let i = contributors.length - 1; i >= 0; i--) {
    const c = contributors[i];
    if (!c?.email) continue;
    if (isAllowedInventoryOperator(c.email, c.displayName)) {
      return toResolved(c.email, c.displayName, c.at);
    }
  }

  return null;
}
