/**
 * Filtros de fecha para el reporte de recepción (zona America/Panama).
 */

export type ReceptionReportDateField = "arrival" | "completed";
export type ReceptionReportStatusScope = "all" | "completed_only";
export type ReceptionReportPreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "custom";

export type ReceptionReportFilter = {
  from: Date;
  to: Date;
  dateField: ReceptionReportDateField;
  statusScope: ReceptionReportStatusScope;
};

const TZ = "America/Panama";

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

export function panamaMidnightUtc(y: number, m: number, d: number): Date {
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

export function panamaDayBounds(date: Date): { start: Date; endExclusive: Date } {
  const { y, m, d } = panamaDateParts(date);
  const start = panamaMidnightUtc(y, m, d);
  const endExclusive = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, endExclusive };
}

export function resolveFilterRangeBounds(filter: ReceptionReportFilter): {
  rangeStart: Date;
  rangeEndExclusive: Date;
} {
  const fromBounds = panamaDayBounds(filter.from);
  const toBounds = panamaDayBounds(filter.to);
  const rangeStart =
    fromBounds.start.getTime() <= toBounds.start.getTime()
      ? fromBounds.start
      : toBounds.start;
  const rangeEndExclusive =
    fromBounds.start.getTime() <= toBounds.start.getTime()
      ? toBounds.endExclusive
      : fromBounds.endExclusive;
  return { rangeStart, rangeEndExclusive };
}

export function isIsoInPanamaRange(
  iso: string | undefined,
  rangeStart: Date,
  rangeEndExclusive: Date,
): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t >= rangeStart.getTime() && t < rangeEndExclusive.getTime();
}

export function formatDateInputPanama(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function parseDateInputPanama(value: string): Date {
  const [y, m, d] = value.split("-").map((n) => Number(n));
  if (!y || !m || !d) return panamaDayBounds(new Date()).start;
  return panamaMidnightUtc(y, m, d);
}

export function presetDateRange(
  preset: ReceptionReportPreset,
  now: Date = new Date(),
): { from: Date; to: Date } {
  const { y, m, d, dow } = panamaDateParts(now);
  const todayStart = panamaMidnightUtc(y, m, d);

  if (preset === "today") {
    return { from: new Date(todayStart), to: new Date(todayStart) };
  }
  if (preset === "yesterday") {
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    return { from: yesterdayStart, to: yesterdayStart };
  }
  if (preset === "this_week") {
    const daysFromMonday = dow === 0 ? 6 : dow - 1;
    const weekStart = new Date(
      todayStart.getTime() - daysFromMonday * 24 * 60 * 60 * 1000,
    );
    return { from: weekStart, to: new Date(todayStart) };
  }
  if (preset === "this_month") {
    const monthStart = panamaMidnightUtc(y, m, 1);
    return { from: monthStart, to: new Date(todayStart) };
  }
  return { from: new Date(todayStart), to: new Date(todayStart) };
}

export function defaultTodayReportFilter(now: Date = new Date()): ReceptionReportFilter {
  const { from, to } = presetDateRange("today", now);
  return {
    from,
    to,
    dateField: "arrival",
    statusScope: "all",
  };
}

export function formatReportRangeLabel(filter: ReceptionReportFilter): string {
  const fromLabel = filter.from.toLocaleDateString("es-PA", {
    timeZone: TZ,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const toLabel = filter.to.toLocaleDateString("es-PA", {
    timeZone: TZ,
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  if (formatDateInputPanama(filter.from) === formatDateInputPanama(filter.to)) {
    return fromLabel;
  }
  return `${fromLabel} — ${toLabel}`;
}

export function formatReportFilenameStamp(filter: ReceptionReportFilter): string {
  const from = formatDateInputPanama(filter.from);
  const to = formatDateInputPanama(filter.to);
  if (from === to) return from;
  return `${from}_a_${to}`;
}
