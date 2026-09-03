import {
  RECEPTION_STATUS,
  RECEPTION_STATUS_LABELS,
  type ReceptionStatusId,
} from "@/lib/receptionLogistics/config";
import {
  defaultTodayReportFilter,
  isIsoInPanamaRange,
  resolveFilterRangeBounds,
  type ReceptionReportFilter,
} from "@/lib/receptionLogistics/receptionReportFilter";
import {
  isCollectionOrderReceptionTruck,
  isGroupedReceptionTruck,
  receptionOrderIds,
} from "@/lib/receptionLogistics/syncCollectionOrderReception";
import {
  diffReceptionMinutes,
  formatReceptionClock,
  resolveQueuedAt,
} from "@/lib/receptionLogistics/receptionTiming";
import type { ReceptionTruck } from "@/lib/receptionLogistics/types";

export type { ReceptionReportFilter } from "@/lib/receptionLogistics/receptionReportFilter";
export {
  defaultTodayReportFilter,
  formatReportRangeLabel,
  formatReportFilenameStamp,
  presetDateRange,
  formatDateInputPanama,
  parseDateInputPanama,
} from "@/lib/receptionLogistics/receptionReportFilter";

export type DailyReceptionReportRow = {
  queuePosition: number | null;
  orNumero: string;
  cliente: string;
  proveedor: string;
  expedidor: string;
  bultos: number;
  estado: string;
  rampa: string;
  horaLlegada: string;
  horaRampa: string;
  horaCompletado: string;
  minutosEnFila: number | null;
  minutosDescarga: number | null;
  minutosTotal: number | null;
  reciboAlmacen: string;
  notas: string;
  createdAtIso: string;
  queuedAtIso: string;
  statusId: ReceptionStatusId;
};

export type DailyReceptionReportSummary = {
  totalOr: number;
  totalBultos: number;
  completadas: number;
  enProceso: number;
  promedioMinFila: number | null;
  promedioMinDescarga: number | null;
  promedioMinTotal: number | null;
  /** Estado al momento de generar el reporte (recepcionista / TV). */
  rampa1Estado?: string;
  rampa2Estado?: string;
};

function parseOrNumero(plate: string): string {
  const match = /^OR\s*#\s*(.+)$/i.exec(plate.trim());
  return match ? match[1].trim() : plate.trim();
}

function rampLabel(status: ReceptionStatusId): string {
  if (status === RECEPTION_STATUS.RAMPA_1) return "Rampa 1";
  if (status === RECEPTION_STATUS.RAMPA_2) return "Rampa 2";
  if (status === RECEPTION_STATUS.RAMPA_EXTRA) return "Rampa Extra";
  if (status === RECEPTION_STATUS.CARRETILLADO) return "Carretillado";
  return "—";
}

function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function resolveCompletedAt(truck: ReceptionTruck): string | undefined {
  return (
    truck.completedAt ??
    (truck.status === RECEPTION_STATUS.COMPLETADO ? truck.updatedAt : undefined)
  );
}

function resolveFilterDateIso(
  truck: ReceptionTruck,
  dateField: ReceptionReportFilter["dateField"],
): string | undefined {
  if (dateField === "arrival") return resolveQueuedAt(truck) ?? truck.createdAt;
  return resolveCompletedAt(truck);
}

function truckMatchesFilter(truck: ReceptionTruck, filter: ReceptionReportFilter): boolean {
  if (!isCollectionOrderReceptionTruck(truck)) return false;
  if (
    filter.statusScope === "completed_only" &&
    truck.status !== RECEPTION_STATUS.COMPLETADO
  ) {
    return false;
  }
  const { rangeStart, rangeEndExclusive } = resolveFilterRangeBounds(filter);
  const dateIso = resolveFilterDateIso(truck, filter.dateField);
  return isIsoInPanamaRange(dateIso, rangeStart, rangeEndExclusive);
}

export function previewReceptionReport(
  trucks: ReceptionTruck[],
  filter: ReceptionReportFilter,
): { orCount: number; bultos: number } {
  const matched = trucks.filter((t) => truckMatchesFilter(t, filter));
  return {
    orCount: matched.reduce(
      (sum, t) => sum + Math.max(1, receptionOrderIds(t).length),
      0,
    ),
    bultos: matched.reduce((sum, t) => sum + t.expectedBultos, 0),
  };
}

export function buildDailyReceptionReport(
  trucks: ReceptionTruck[],
  filter: ReceptionReportFilter = defaultTodayReportFilter(),
): { rows: DailyReceptionReportRow[]; summary: DailyReceptionReportSummary } {
  const arrivalMs = (t: ReceptionTruck): number => {
    const queued = resolveQueuedAt(t);
    if (queued) {
      const q = Date.parse(queued);
      if (Number.isFinite(q)) return q;
    }
    const c = Date.parse(t.createdAt);
    if (Number.isFinite(c)) return c;
    return Number.isFinite(t.sortOrder) ? t.sortOrder : 0;
  };

  const filteredOr = trucks
    .filter((t) => truckMatchesFilter(t, filter))
    .sort((a, b) => arrivalMs(a) - arrivalMs(b));

  const rows: DailyReceptionReportRow[] = filteredOr.map((t, i) => {
    const queuedAt = resolveQueuedAt(t);
    const completedAt = resolveCompletedAt(t);
    const minutosEnFila = diffReceptionMinutes(queuedAt, t.rampAssignedAt);
    const minutosDescarga = diffReceptionMinutes(t.rampAssignedAt, completedAt);
    const minutosTotal = diffReceptionMinutes(queuedAt, completedAt);
    const orNumero =
      isGroupedReceptionTruck(t) && t.orderNumeros?.length
        ? t.orderNumeros.map((n) => `#${n}`).join(" · ")
        : parseOrNumero(t.plate);

    return {
      queuePosition: i + 1,
      orNumero,
      cliente: t.client !== "—" ? t.client : "",
      proveedor: t.provider !== "—" ? t.provider : "",
      expedidor: t.notes?.trim() ?? "",
      bultos: t.expectedBultos,
      estado: RECEPTION_STATUS_LABELS[t.status],
      rampa: rampLabel(t.rampUsed ?? t.status),
      horaLlegada: formatReceptionClock(queuedAt),
      horaRampa: formatReceptionClock(t.rampAssignedAt),
      horaCompletado: formatReceptionClock(completedAt),
      minutosEnFila,
      minutosDescarga,
      minutosTotal,
      reciboAlmacen: t.warehouseReceiptNumber?.trim() ?? "",
      notas: t.driverName?.trim() ? `Conductor: ${t.driverName}` : "",
      createdAtIso: t.createdAt,
      queuedAtIso: queuedAt ?? "",
      statusId: t.status,
    };
  });

  const filaTimes = rows
    .map((r) => r.minutosEnFila)
    .filter((n): n is number => n != null);
  const descargaTimes = rows
    .map((r) => r.minutosDescarga)
    .filter((n): n is number => n != null);
  const totalTimes = rows
    .map((r) => r.minutosTotal)
    .filter((n): n is number => n != null);

  const summary: DailyReceptionReportSummary = {
    totalOr: filteredOr.reduce(
      (sum, t) => sum + Math.max(1, receptionOrderIds(t).length),
      0,
    ),
    totalBultos: rows.reduce((a, r) => a + r.bultos, 0),
    completadas: rows.filter((r) => r.statusId === RECEPTION_STATUS.COMPLETADO).length,
    enProceso: rows.filter((r) => r.statusId !== RECEPTION_STATUS.COMPLETADO).length,
    promedioMinFila: average(filaTimes),
    promedioMinDescarga: average(descargaTimes),
    promedioMinTotal: average(totalTimes),
  };

  return { rows, summary };
}

/** @deprecated Usar formatReportRangeLabel con ReceptionReportFilter */
export function formatReportDateLabel(date: Date): string {
  return date.toLocaleDateString("es-PA", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function formatMinutesLabel(minutes: number | null | undefined): string {
  if (minutes == null || minutes < 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}
