import {
  RECEPTION_STATUS,
  RECEPTION_STATUS_LABELS,
  type ReceptionStatusId,
} from "@/lib/receptionLogistics/config";
import { isCollectionOrderReceptionTruck } from "@/lib/receptionLogistics/syncCollectionOrderReception";
import type { ReceptionTruck } from "@/lib/receptionLogistics/types";

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
};

function parseOrNumero(plate: string): string {
  const match = /^OR\s*#\s*(.+)$/i.exec(plate.trim());
  return match ? match[1].trim() : plate.trim();
}

function isSameLocalDay(iso: string, ref: Date): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

function formatTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("es-PA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function diffMinutes(startIso: string | undefined, endIso: string | undefined): number | null {
  if (!startIso || !endIso) return null;
  const a = Date.parse(startIso);
  const b = Date.parse(endIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 60_000);
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

export function buildDailyReceptionReport(
  trucks: ReceptionTruck[],
  reportDate: Date = new Date(),
): { rows: DailyReceptionReportRow[]; summary: DailyReceptionReportSummary } {
  // Orden por llegada real: primero el que entró antes (hora de llegada).
  const arrivalMs = (t: ReceptionTruck): number => {
    const c = Date.parse(t.createdAt);
    if (Number.isFinite(c)) return c;
    return Number.isFinite(t.sortOrder) ? t.sortOrder : 0;
  };
  const todaysOr = trucks
    .filter((t) => isCollectionOrderReceptionTruck(t))
    .filter((t) => isSameLocalDay(t.createdAt, reportDate))
    .sort((a, b) => arrivalMs(a) - arrivalMs(b));

  const rows: DailyReceptionReportRow[] = todaysOr.map((t, i) => {
    // Hora real de completado (sellada); respaldo para datos antiguos: updatedAt.
    const completedAt =
      t.completedAt ??
      (t.status === RECEPTION_STATUS.COMPLETADO ? t.updatedAt : undefined);
    const minutosEnFila = diffMinutes(t.createdAt, t.rampAssignedAt);
    const minutosDescarga = diffMinutes(t.rampAssignedAt, completedAt);
    const minutosTotal = diffMinutes(t.createdAt, completedAt);

    return {
      // Posición según el orden de llegada (para TODAS las OR, no solo las en fila).
      queuePosition: i + 1,
      orNumero: parseOrNumero(t.plate),
      cliente: t.client !== "—" ? t.client : "",
      proveedor: t.provider !== "—" ? t.provider : "",
      expedidor: t.notes?.trim() ?? "",
      bultos: t.expectedBultos,
      estado: RECEPTION_STATUS_LABELS[t.status],
      // Rampa/carretillado usado (persistido); se mantiene aunque ya esté completado.
      rampa: rampLabel(t.rampUsed ?? t.status),
      horaLlegada: formatTime(t.createdAt),
      horaRampa: formatTime(t.rampAssignedAt),
      horaCompletado: formatTime(completedAt),
      minutosEnFila,
      minutosDescarga,
      minutosTotal,
      reciboAlmacen: t.warehouseReceiptNumber?.trim() ?? "",
      notas: t.driverName?.trim() ? `Conductor: ${t.driverName}` : "",
      createdAtIso: t.createdAt,
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
    totalOr: rows.length,
    totalBultos: rows.reduce((a, r) => a + r.bultos, 0),
    completadas: rows.filter((r) => r.statusId === RECEPTION_STATUS.COMPLETADO).length,
    enProceso: rows.filter((r) => r.statusId !== RECEPTION_STATUS.COMPLETADO).length,
    promedioMinFila: average(filaTimes),
    promedioMinDescarga: average(descargaTimes),
    promedioMinTotal: average(totalTimes),
  };

  return { rows, summary };
}

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
