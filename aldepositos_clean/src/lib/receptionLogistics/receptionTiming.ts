import type { ReceptionTruck } from "@/lib/receptionLogistics/types";

/** sortOrder en ms; valores bajos son legado (número OR usado por error). */
export const RECEPTION_SORT_EPOCH_MIN = 1_000_000_000_000;

/**
 * Hora real de entrada a fila.
 * Prioridad: queuedAt → sortOrder (si es timestamp ms).
 * Nunca createdAt/updatedAt de la OR (se refrescan y no son la cola).
 */
export function resolveQueuedAt(truck: ReceptionTruck): string | undefined {
  const queued = String(truck.queuedAt ?? "").trim();
  if (queued) {
    const t = Date.parse(queued);
    if (Number.isFinite(t) && t >= RECEPTION_SORT_EPOCH_MIN) return queued;
  }
  const so = truck.sortOrder;
  if (so != null && so >= RECEPTION_SORT_EPOCH_MIN) {
    return new Date(so).toISOString();
  }
  return undefined;
}

export function formatReceptionClock(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("es-PA", {
    timeZone: "America/Panama",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export function diffReceptionMinutes(
  startIso: string | undefined,
  endIso: string | undefined,
): number | null {
  if (!startIso || !endIso) return null;
  const a = Date.parse(startIso);
  const b = Date.parse(endIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 60_000);
}

/** ISO a partir de un hint de cola o sortOrder sellado. */
export function queuedAtFromHints(
  existing: ReceptionTruck | null | undefined,
  queueHint?: string | null,
): string | undefined {
  if (existing?.queuedAt) {
    const t = Date.parse(existing.queuedAt);
    if (Number.isFinite(t) && t >= RECEPTION_SORT_EPOCH_MIN) {
      return existing.queuedAt;
    }
  }
  if (queueHint) {
    const t = Date.parse(queueHint);
    if (Number.isFinite(t) && t >= RECEPTION_SORT_EPOCH_MIN) {
      return new Date(t).toISOString();
    }
  }
  const so = existing?.sortOrder;
  if (so != null && so >= RECEPTION_SORT_EPOCH_MIN) {
    return new Date(so).toISOString();
  }
  return undefined;
}
