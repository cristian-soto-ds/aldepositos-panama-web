import type { Task } from "@/lib/types/task";

const CONTRIBUTORS_CAP = 48;

export function normalizeContributorEmail(
  email: string | null | undefined,
): string | null {
  if (!email || typeof email !== "string") return null;
  const t = email.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

export type TaskContributor = {
  email: string;
  displayName?: string;
  at: string;
};

/**
 * Registra quién creó el RA y quién ha guardado cambios (para productividad personal).
 */
export function withTaskContribution(
  task: Task,
  userEmail: string | null | undefined,
  userLabel: string | null | undefined,
  mode: "create" | "touch",
): Task {
  const email = normalizeContributorEmail(userEmail);
  if (!email) return task;

  const label = userLabel?.trim() || undefined;
  const now = new Date().toISOString();

  const prev = task.contributors ?? [];
  const map = new Map<string, TaskContributor>();
  for (const c of prev) {
    const k = normalizeContributorEmail(c.email);
    if (k) map.set(k, { ...c, email: k });
  }
  const existing = map.get(email);
  map.set(email, {
    email,
    displayName: label ?? existing?.displayName,
    at: now,
  });

  const contributors = Array.from(map.values())
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, CONTRIBUTORS_CAP);

  const next: Task = {
    ...task,
    contributors,
  };

  if (mode === "create" && !normalizeContributorEmail(next.createdByEmail)) {
    next.createdByEmail = email;
    if (label) next.createdByName = label;
  }

  return next;
}

export function userParticipatedInTask(
  task: Task,
  userEmail: string | null | undefined,
): boolean {
  const e = normalizeContributorEmail(userEmail);
  if (!e) return false;
  if (normalizeContributorEmail(task.createdByEmail) === e) return true;
  return (task.contributors ?? []).some(
    (c) => normalizeContributorEmail(c.email) === e,
  );
}

/** Participó en un RA que abrió otro operador (colaboración). */
export function userHelpedOnlyOnTask(
  task: Task,
  userEmail: string | null | undefined,
): boolean {
  const e = normalizeContributorEmail(userEmail);
  if (!e || !userParticipatedInTask(task, e)) return false;
  const creator = normalizeContributorEmail(task.createdByEmail);
  if (creator === e) return false;
  if (creator) return true;
  const others = (task.contributors ?? []).filter(
    (c) => normalizeContributorEmail(c.email) !== e,
  );
  return others.length > 0;
}

export function lastUserTouchTime(
  task: Task,
  userEmail: string | null | undefined,
): number {
  const e = normalizeContributorEmail(userEmail);
  if (!e) return 0;
  const row = (task.contributors ?? []).find(
    (c) => normalizeContributorEmail(c.email) === e,
  );
  if (row?.at) return new Date(row.at).getTime();
  if (normalizeContributorEmail(task.createdByEmail) === e && task.date) {
    return new Date(task.date).getTime();
  }
  return 0;
}
