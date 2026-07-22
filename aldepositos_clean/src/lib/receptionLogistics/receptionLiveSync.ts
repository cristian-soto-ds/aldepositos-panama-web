/**
 * Sync instantánea entre operador / TV / otras pestañas.
 * Broadcast (~50–150 ms) + parches de postgres_changes.
 */

import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { RECEPTION_TABLE } from "@/lib/receptionLogistics/config";
import { RAMP_OCCUPANCY_META_ID } from "@/lib/receptionLogistics/rampOccupancy";
import type { ReceptionTruck } from "@/lib/receptionLogistics/types";
import type { RampOccupancyState } from "@/lib/receptionLogistics/rampOccupancy";

export const RECEPTION_LIVE_CHANNEL = "aldepositos-reception-live-v1";

export type ReceptionTruckLiveChange = {
  kind: "truck";
  eventType: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  truck: ReceptionTruck | null;
  at: number;
};

export type ReceptionRampLiveChange = {
  kind: "ramp";
  occupancy: RampOccupancyState;
  at: number;
};

export type ReceptionLiveChange =
  | ReceptionTruckLiveChange
  | ReceptionRampLiveChange;

type LiveListener = (change: ReceptionLiveChange) => void;

const listeners = new Set<LiveListener>();
let channel: RealtimeChannel | null = null;
let subscribePromise: Promise<void> | null = null;

function isTruck(value: unknown): value is ReceptionTruck {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "plate" in value &&
    "status" in value
  );
}

function isRampOccupancyState(value: unknown): value is RampOccupancyState {
  if (!value || typeof value !== "object") return false;
  const v = value as RampOccupancyState;
  return (
    typeof v.RAMPA_1 === "object" &&
    typeof v.RAMPA_2 === "object" &&
    typeof v.updatedAt === "string"
  );
}

function rowPayload(row: Record<string, unknown> | null | undefined): unknown {
  if (!row) return null;
  return row.payload ?? null;
}

function rowId(row: Record<string, unknown> | null | undefined): string | null {
  if (!row || typeof row.id !== "string") return null;
  return row.id;
}

export function parseReceptionPostgresChange(
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
): ReceptionLiveChange | null {
  const eventType = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
  const newRow = payload.new as Record<string, unknown> | undefined;
  const oldRow = payload.old as Record<string, unknown> | undefined;
  const id = rowId(newRow) ?? rowId(oldRow);
  if (!id) return null;

  if (id === RAMP_OCCUPANCY_META_ID) {
    if (eventType === "DELETE") return null;
    const occ = rowPayload(newRow);
    if (!isRampOccupancyState(occ)) return null;
    return { kind: "ramp", occupancy: occ, at: Date.now() };
  }

  if (eventType === "DELETE") {
    return {
      kind: "truck",
      eventType: "DELETE",
      id,
      truck: null,
      at: Date.now(),
    };
  }

  const truckPayload = rowPayload(newRow);
  if (!isTruck(truckPayload)) return null;
  return {
    kind: "truck",
    eventType,
    id,
    truck: truckPayload,
    at: Date.now(),
  };
}

function emit(change: ReceptionLiveChange) {
  for (const fn of listeners) fn(change);
}

function ensureChannel(): Promise<void> {
  if (subscribePromise) return subscribePromise;
  subscribePromise = new Promise((resolve) => {
    const ch = supabase.channel(RECEPTION_LIVE_CHANNEL, {
      config: { broadcast: { self: false } },
    });

    ch.on("broadcast", { event: "reception" }, ({ payload }) => {
      const change = payload as ReceptionLiveChange;
      if (!change?.kind) return;
      emit(change);
    });

    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: RECEPTION_TABLE },
      (payload) => {
        const change = parseReceptionPostgresChange(
          payload as RealtimePostgresChangesPayload<Record<string, unknown>>,
        );
        if (change) emit(change);
      },
    );

    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        console.warn(`[reception-live] Realtime ${status}`);
      }
    });
    channel = ch;
  });
  return subscribePromise;
}

export function subscribeReceptionLive(listener: LiveListener): () => void {
  listeners.add(listener);
  void ensureChannel();
  return () => {
    listeners.delete(listener);
  };
}

export function publishReceptionTruckLive(
  eventType: "INSERT" | "UPDATE" | "DELETE",
  id: string,
  truck: ReceptionTruck | null,
): void {
  const change: ReceptionTruckLiveChange = {
    kind: "truck",
    eventType,
    id,
    truck,
    at: Date.now(),
  };
  // Eco local inmediato (otras vistas en la misma pestaña / mismo JS).
  emit(change);
  void ensureChannel().then(() => {
    void channel?.send({
      type: "broadcast",
      event: "reception",
      payload: change,
    });
  });
}

export function publishRampOccupancyLive(occupancy: RampOccupancyState): void {
  const change: ReceptionRampLiveChange = {
    kind: "ramp",
    occupancy,
    at: Date.now(),
  };
  emit(change);
  void ensureChannel().then(() => {
    void channel?.send({
      type: "broadcast",
      event: "reception",
      payload: change,
    });
  });
}

export function applyTruckLiveChange(
  trucks: ReceptionTruck[],
  change: ReceptionTruckLiveChange,
): ReceptionTruck[] {
  if (change.eventType === "DELETE" || !change.truck) {
    const next = trucks.filter((t) => t.id !== change.id);
    return next.length === trucks.length ? trucks : next;
  }

  const idx = trucks.findIndex((t) => t.id === change.id);
  if (idx < 0) return [...trucks, change.truck];

  const prev = trucks[idx]!;
  // Evitar eco atrasado: no sobrescribir con versión más vieja.
  if (
    prev.updatedAt &&
    change.truck.updatedAt &&
    prev.updatedAt > change.truck.updatedAt
  ) {
    return trucks;
  }
  if (JSON.stringify(prev) === JSON.stringify(change.truck)) return trucks;
  const next = [...trucks];
  next[idx] = change.truck;
  return next;
}
