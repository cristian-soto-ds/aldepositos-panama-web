import type { Task } from "@/lib/types/task";
import {
  getInventariadorById,
  INVENTARIADORES,
  resolveInventariadorId,
} from "@/lib/inventariadoresRoster";

export type LeaderboardPeriod = "day" | "week" | "month";

export type InventariadorStats = {
  id: string;
  name: string;
  rank: number;
  inventarios: number;
  filas: number;
  bultos: number;
  isLeader: boolean;
  lastActivityAt: string | null;
};

export type LeaderboardResult = {
  period: LeaderboardPeriod;
  periodLabel: string;
  stats: InventariadorStats[];
  teamTotals: {
    inventarios: number;
    filas: number;
    bultos: number;
  };
  leaderId: string | null;
};

const TZ = "America/Panama";

function hasAnyRowData(row: Record<string, unknown>): boolean {
  const keys = [
    "referencia",
    "bultos",
    "l",
    "w",
    "h",
    "descripcion",
    "unidadesPorBulto",
    "pesoPorBulto",
    "referenciaContenedora",
    "reempaque",
  ];
  return keys.some((key) => {
    const value = row[key];
    if (value == null) return false;
    if (typeof value === "boolean") return value;
    return String(value).trim() !== "";
  });
}

function countTaskRows(task: Task): number {
  const rows = Array.isArray(task.measureData)
    ? (task.measureData as Record<string, unknown>[])
    : [];
  return rows.filter((row) => hasAnyRowData(row)).length;
}

function parseActivityDate(iso: string | undefined | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function panamaDateParts(date: Date): { y: number; m: number; d: number; dow: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const dowMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 0,
  };
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    dow: dowMap[weekday] ?? 0,
  };
}

function panamaMidnightUtc(y: number, m: number, d: number): Date {
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(probe);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const localH = get("hour");
  const localM = get("minute");
  const localS = get("second");
  return new Date(
    probe.getTime() - ((localH * 3600 + localM * 60 + localS) * 1000),
  );
}

export function getPeriodBounds(
  period: LeaderboardPeriod,
  now: Date = new Date(),
): { start: Date; end: Date; label: string } {
  const { y, m, d, dow } = panamaDateParts(now);
  const todayStart = panamaMidnightUtc(y, m, d);

  if (period === "day") {
    const end = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const labelFmt = new Intl.DateTimeFormat("es-PA", {
      timeZone: TZ,
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    return { start: todayStart, end, label: labelFmt.format(now) };
  }

  if (period === "week") {
    const daysFromMonday = dow === 0 ? 6 : dow - 1;
    const weekStartDay = d - daysFromMonday;
    const weekStart = panamaMidnightUtc(y, m, weekStartDay);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    return { start: weekStart, end: weekEnd, label: "Esta semana" };
  }

  const monthStart = panamaMidnightUtc(y, m, 1);
  const nextMonth = m === 12 ? panamaMidnightUtc(y + 1, 1, 1) : panamaMidnightUtc(y, m + 1, 1);
  const labelFmt = new Intl.DateTimeFormat("es-PA", {
    timeZone: TZ,
    month: "long",
    year: "numeric",
  });
  return { start: monthStart, end: nextMonth, label: labelFmt.format(now) };
}

function isInPeriod(date: Date, start: Date, end: Date): boolean {
  return date.getTime() >= start.getTime() && date.getTime() < end.getTime();
}

type MutableStats = {
  inventarios: number;
  filas: number;
  bultos: number;
  lastActivityAt: string | null;
};

function emptyStatsMap(): Map<string, MutableStats> {
  const map = new Map<string, MutableStats>();
  for (const entry of INVENTARIADORES) {
    map.set(entry.id, {
      inventarios: 0,
      filas: 0,
      bultos: 0,
      lastActivityAt: null,
    });
  }
  return map;
}

function bumpLastActivity(stats: MutableStats, iso: string) {
  if (!stats.lastActivityAt || iso > stats.lastActivityAt) {
    stats.lastActivityAt = iso;
  }
}

export function computeInventoryLeaderboard(
  tasks: Task[],
  period: LeaderboardPeriod,
  now: Date = new Date(),
): LeaderboardResult {
  const { start, end, label } = getPeriodBounds(period, now);
  const map = emptyStatsMap();

  for (const task of tasks) {
    const contributors = task.contributors ?? [];
    if (contributors.length === 0) continue;

    const filas = countTaskRows(task);
    const bultos = task.currentBultos ?? 0;
    const isCompleted = task.status === "completed";

    for (const contributor of contributors) {
      const invId = resolveInventariadorId(
        contributor.displayName,
        contributor.email,
      );
      if (!invId) continue;

      const activityDate =
        parseActivityDate(contributor.at) ??
        parseActivityDate(task.inventoryCompletedBy?.at) ??
        parseActivityDate(task.updatedAt);
      if (!activityDate || !isInPeriod(activityDate, start, end)) continue;

      const stats = map.get(invId)!;
      stats.filas += filas;
      stats.bultos += bultos;
      if (isCompleted) stats.inventarios += 1;
      bumpLastActivity(stats, activityDate.toISOString());
    }
  }

  const sorted = INVENTARIADORES.map((entry) => {
    const s = map.get(entry.id)!;
    return {
      id: entry.id,
      name: entry.name,
      inventarios: s.inventarios,
      filas: s.filas,
      bultos: s.bultos,
      lastActivityAt: s.lastActivityAt,
    };
  }).sort((a, b) => {
    if (b.inventarios !== a.inventarios) return b.inventarios - a.inventarios;
    if (b.filas !== a.filas) return b.filas - a.filas;
    return b.bultos - a.bultos;
  });

  const leaderId = sorted[0]?.inventarios > 0 || sorted[0]?.filas > 0 ? sorted[0]!.id : null;

  const stats: InventariadorStats[] = sorted.map((s, i) => ({
    ...s,
    rank: i + 1,
    isLeader: s.id === leaderId,
  }));

  const teamTotals = stats.reduce(
    (acc, s) => ({
      inventarios: acc.inventarios + s.inventarios,
      filas: acc.filas + s.filas,
      bultos: acc.bultos + s.bultos,
    }),
    { inventarios: 0, filas: 0, bultos: 0 },
  );

  return {
    period,
    periodLabel: label,
    stats,
    teamTotals,
    leaderId,
  };
}

export function isCurrentUserInventariador(
  userDisplayName: string | null | undefined,
  userEmail: string | null | undefined,
): string | null {
  return resolveInventariadorId(userDisplayName, userEmail);
}

export function inventariadorDisplayName(id: string): string {
  return getInventariadorById(id)?.name ?? id;
}
