import type { Task } from "@/lib/types/task";
import {
  getInventariadorById,
  INVENTARIADORES,
  resolveInventariadorId,
} from "@/lib/inventariadoresRoster";
import { activeInventoryMs } from "@/lib/inventorySessionTiming";

export type LeaderboardPeriod =
  | "day"
  | "yesterday"
  | "week"
  | "lastWeek"
  | "month"
  | "lastMonth";

export const LEADERBOARD_PERIOD_OPTIONS: {
  id: LeaderboardPeriod;
  label: string;
}[] = [
  { id: "day", label: "Hoy" },
  { id: "yesterday", label: "Ayer" },
  { id: "week", label: "Esta semana" },
  { id: "lastWeek", label: "Semana pasada" },
  { id: "month", label: "Este mes" },
  { id: "lastMonth", label: "Mes pasado" },
];

function isDayLike(period: LeaderboardPeriod): boolean {
  return period === "day" || period === "yesterday";
}

function isWeekLike(period: LeaderboardPeriod): boolean {
  return period === "week" || period === "lastWeek";
}

export type InventariadorStats = {
  id: string;
  name: string;
  rank: number;
  inventarios: number;
  filas: number;
  bultos: number;
  enProceso: number;
  avgFilasPorInventario: number;
  avgBultosPorInventario: number;
  /** Promedio de minutos activos (excluye pausas). null si no hay samples medibles. */
  avgActiveMinutes: number | null;
  timedInventarios: number;
  shareInventarios: number;
  shareFilas: number;
  shareBultos: number;
  quickCount: number;
  detailedCount: number;
  modeWith: number;
  modeWithout: number;
  modePalletized: number;
  score: number;
  deltaInventarios: number;
  deltaFilas: number;
  deltaBultos: number;
  activityByDay: number[];
  isLeader: boolean;
  lastActivityAt: string | null;
};

export type LeaderboardResult = {
  period: LeaderboardPeriod;
  periodLabel: string;
  prevPeriodLabel: string;
  stats: InventariadorStats[];
  teamTotals: {
    inventarios: number;
    filas: number;
    bultos: number;
    enProceso: number;
    score: number;
    deltaInventarios: number;
    deltaFilas: number;
    deltaBultos: number;
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

function panamaHour(date: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0);
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
    probe.getTime() - (localH * 3600 + localM * 60 + localS) * 1000,
  );
}

function dayLabel(date: Date): string {
  return new Intl.DateTimeFormat("es-PA", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat("es-PA", {
    timeZone: TZ,
    month: "long",
    year: "numeric",
  }).format(date);
}

function currentWeekStart(now: Date): Date {
  const { y, m, d, dow } = panamaDateParts(now);
  const daysFromMonday = dow === 0 ? 6 : dow - 1;
  return panamaMidnightUtc(y, m, d - daysFromMonday);
}

export function getPeriodBounds(
  period: LeaderboardPeriod,
  now: Date = new Date(),
): { start: Date; end: Date; label: string } {
  const { y, m, d } = panamaDateParts(now);
  const todayStart = panamaMidnightUtc(y, m, d);
  const dayMs = 24 * 60 * 60 * 1000;

  if (period === "day") {
    return {
      start: todayStart,
      end: new Date(todayStart.getTime() + dayMs),
      label: dayLabel(now),
    };
  }

  if (period === "yesterday") {
    const start = new Date(todayStart.getTime() - dayMs);
    return {
      start,
      end: todayStart,
      label: `Ayer · ${dayLabel(start)}`,
    };
  }

  if (period === "week") {
    const weekStart = currentWeekStart(now);
    return {
      start: weekStart,
      end: new Date(weekStart.getTime() + 7 * dayMs),
      label: "Esta semana",
    };
  }

  if (period === "lastWeek") {
    const thisWeekStart = currentWeekStart(now);
    const start = new Date(thisWeekStart.getTime() - 7 * dayMs);
    return {
      start,
      end: thisWeekStart,
      label: "Semana pasada",
    };
  }

  if (period === "lastMonth") {
    const thisMonthStart = panamaMidnightUtc(y, m, 1);
    const prevY = m === 1 ? y - 1 : y;
    const prevM = m === 1 ? 12 : m - 1;
    const start = panamaMidnightUtc(prevY, prevM, 1);
    return {
      start,
      end: thisMonthStart,
      label: monthLabel(start),
    };
  }

  // month (este mes)
  const monthStart = panamaMidnightUtc(y, m, 1);
  const nextMonth =
    m === 12 ? panamaMidnightUtc(y + 1, 1, 1) : panamaMidnightUtc(y, m + 1, 1);
  return {
    start: monthStart,
    end: nextMonth,
    label: monthLabel(now),
  };
}

export function getPreviousPeriodBounds(
  period: LeaderboardPeriod,
  now: Date = new Date(),
): { start: Date; end: Date; label: string } {
  const current = getPeriodBounds(period, now);
  const durationMs = current.end.getTime() - current.start.getTime();
  const prevEnd = current.start;
  const prevStart = new Date(prevEnd.getTime() - durationMs);

  if (isDayLike(period)) {
    return {
      start: prevStart,
      end: prevEnd,
      label: dayLabel(prevStart),
    };
  }
  if (isWeekLike(period)) {
    const label =
      period === "week" ? "Semana pasada" : "Semana antepasada";
    return { start: prevStart, end: prevEnd, label };
  }
  return {
    start: prevStart,
    end: prevEnd,
    label: monthLabel(prevStart),
  };
}

function isInPeriod(date: Date, start: Date, end: Date): boolean {
  return date.getTime() >= start.getTime() && date.getTime() < end.getTime();
}

function computeScore(inventarios: number, filas: number, bultos: number): number {
  return inventarios * 100 + filas * 2 + bultos;
}

function pctShare(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function activityBucketCount(period: LeaderboardPeriod, start: Date, end: Date): number {
  if (isDayLike(period)) return 3;
  if (isWeekLike(period)) return 7;
  const days = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)),
  );
  return Math.min(31, days);
}

function activityBucketIndex(
  period: LeaderboardPeriod,
  activityDate: Date,
  start: Date,
  bucketCount: number,
): number {
  if (isDayLike(period)) {
    const hour = panamaHour(activityDate);
    if (hour < 12) return 0;
    if (hour < 18) return 1;
    return 2;
  }
  const dayMs = 24 * 60 * 60 * 1000;
  const idx = Math.floor((activityDate.getTime() - start.getTime()) / dayMs);
  return Math.max(0, Math.min(bucketCount - 1, idx));
}

type MutableStats = {
  inventarios: number;
  filas: number;
  bultos: number;
  enProceso: number;
  activeMsSum: number;
  timedInventarios: number;
  quickCount: number;
  detailedCount: number;
  modeWith: number;
  modeWithout: number;
  modePalletized: number;
  activityByDay: number[];
  lastActivityAt: string | null;
};

function emptyStatsMap(bucketCount: number): Map<string, MutableStats> {
  const map = new Map<string, MutableStats>();
  for (const entry of INVENTARIADORES) {
    map.set(entry.id, {
      inventarios: 0,
      filas: 0,
      bultos: 0,
      enProceso: 0,
      activeMsSum: 0,
      timedInventarios: 0,
      quickCount: 0,
      detailedCount: 0,
      modeWith: 0,
      modeWithout: 0,
      modePalletized: 0,
      activityByDay: Array.from({ length: bucketCount }, () => 0),
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

function isInProgressStatus(status: string): boolean {
  return status === "in_progress" || status === "partial";
}

function creditTaskToMap(
  map: Map<string, MutableStats>,
  tasks: Task[],
  start: Date,
  end: Date,
  period: LeaderboardPeriod,
  bucketCount: number,
  trackActivity: boolean,
) {
  for (const task of tasks) {
    const contributors = task.contributors ?? [];
    if (contributors.length === 0) continue;

    const filas = countTaskRows(task);
    const bultos = task.currentBultos ?? 0;
    const isCompleted = task.status === "completed";
    const inProgress = isInProgressStatus(task.status);
    const isQuick = task.type === "quick" || task.type === "airway" || !task.type;
    const isDetailed = task.type === "detailed";
    const mode = task.referenceMode;

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
      if (isCompleted) {
        stats.inventarios += 1;
        if (isQuick) stats.quickCount += 1;
        if (isDetailed) stats.detailedCount += 1;
        if (mode === "with") stats.modeWith += 1;
        else if (mode === "without") stats.modeWithout += 1;
        else if (mode === "palletized") stats.modePalletized += 1;

        const activeMs = activeInventoryMs(
          task,
          task.inventoryCompletedBy?.at ?? task.updatedAt,
        );
        if (activeMs != null) {
          stats.activeMsSum += activeMs;
          stats.timedInventarios += 1;
        }

        if (trackActivity) {
          const bucket = activityBucketIndex(
            period,
            activityDate,
            start,
            bucketCount,
          );
          stats.activityByDay[bucket] = (stats.activityByDay[bucket] ?? 0) + 1;
        }
      }
      if (inProgress) stats.enProceso += 1;
      bumpLastActivity(stats, activityDate.toISOString());
    }
  }
}

type RawCounts = {
  inventarios: number;
  filas: number;
  bultos: number;
  enProceso: number;
  activeMsSum: number;
  timedInventarios: number;
  quickCount: number;
  detailedCount: number;
  modeWith: number;
  modeWithout: number;
  modePalletized: number;
  activityByDay: number[];
  lastActivityAt: string | null;
};

function mapToRaw(map: Map<string, MutableStats>): Map<string, RawCounts> {
  const out = new Map<string, RawCounts>();
  for (const [id, s] of map) {
    out.set(id, { ...s, activityByDay: [...s.activityByDay] });
  }
  return out;
}

export function computeInventoryLeaderboard(
  tasks: Task[],
  period: LeaderboardPeriod,
  now: Date = new Date(),
): LeaderboardResult {
  const { start, end, label } = getPeriodBounds(period, now);
  const prev = getPreviousPeriodBounds(period, now);
  const bucketCount = activityBucketCount(period, start, end);

  const currentMap = emptyStatsMap(bucketCount);
  const prevMap = emptyStatsMap(bucketCount);

  creditTaskToMap(currentMap, tasks, start, end, period, bucketCount, true);
  creditTaskToMap(
    prevMap,
    tasks,
    prev.start,
    prev.end,
    period,
    bucketCount,
    false,
  );

  const currentRaw = mapToRaw(currentMap);
  const prevRaw = mapToRaw(prevMap);

  const sorted = INVENTARIADORES.map((entry) => {
    const s = currentRaw.get(entry.id)!;
    const p = prevRaw.get(entry.id)!;
    return {
      id: entry.id,
      name: entry.name,
      inventarios: s.inventarios,
      filas: s.filas,
      bultos: s.bultos,
      enProceso: s.enProceso,
      activeMsSum: s.activeMsSum,
      timedInventarios: s.timedInventarios,
      quickCount: s.quickCount,
      detailedCount: s.detailedCount,
      modeWith: s.modeWith,
      modeWithout: s.modeWithout,
      modePalletized: s.modePalletized,
      activityByDay: s.activityByDay,
      lastActivityAt: s.lastActivityAt,
      deltaInventarios: s.inventarios - p.inventarios,
      deltaFilas: s.filas - p.filas,
      deltaBultos: s.bultos - p.bultos,
      score: computeScore(s.inventarios, s.filas, s.bultos),
    };
  }).sort((a, b) => {
    if (b.inventarios !== a.inventarios) return b.inventarios - a.inventarios;
    if (b.filas !== a.filas) return b.filas - a.filas;
    return b.bultos - a.bultos;
  });

  const leaderId =
    sorted[0] && (sorted[0].inventarios > 0 || sorted[0].filas > 0)
      ? sorted[0].id
      : null;

  const teamInventarios = sorted.reduce((a, s) => a + s.inventarios, 0);
  const teamFilas = sorted.reduce((a, s) => a + s.filas, 0);
  const teamBultos = sorted.reduce((a, s) => a + s.bultos, 0);
  const teamEnProceso = sorted.reduce((a, s) => a + s.enProceso, 0);
  const teamScore = sorted.reduce((a, s) => a + s.score, 0);
  const teamDeltaInventarios = sorted.reduce((a, s) => a + s.deltaInventarios, 0);
  const teamDeltaFilas = sorted.reduce((a, s) => a + s.deltaFilas, 0);
  const teamDeltaBultos = sorted.reduce((a, s) => a + s.deltaBultos, 0);

  const stats: InventariadorStats[] = sorted.map((s, i) => {
    const { activeMsSum, ...rest } = s;
    return {
      ...rest,
      rank: i + 1,
      isLeader: s.id === leaderId,
      avgFilasPorInventario:
        s.inventarios > 0
          ? Math.round((s.filas / s.inventarios) * 10) / 10
          : 0,
      avgBultosPorInventario:
        s.inventarios > 0
          ? Math.round((s.bultos / s.inventarios) * 10) / 10
          : 0,
      avgActiveMinutes:
        s.timedInventarios > 0
          ? Math.round((activeMsSum / s.timedInventarios / 60_000) * 10) / 10
          : null,
      shareInventarios: pctShare(s.inventarios, teamInventarios),
      shareFilas: pctShare(s.filas, teamFilas),
      shareBultos: pctShare(s.bultos, teamBultos),
    };
  });

  return {
    period,
    periodLabel: label,
    prevPeriodLabel: prev.label,
    stats,
    teamTotals: {
      inventarios: teamInventarios,
      filas: teamFilas,
      bultos: teamBultos,
      enProceso: teamEnProceso,
      score: teamScore,
      deltaInventarios: teamDeltaInventarios,
      deltaFilas: teamDeltaFilas,
      deltaBultos: teamDeltaBultos,
    },
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
