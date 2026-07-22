import type { ReceptionTruck, ReceptionQueueSnapshot } from "@/lib/receptionLogistics/types";
import {
  RECEPTION_BROADCAST_CHANNEL,
  RECEPTION_RECEIPT_PREFIX,
  RECEPTION_STATUS,
  RECEPTION_STORAGE_KEY,
  RECEPTION_TABLE,
  isRampReceptionStatus,
  type ReceptionStatusId,
} from "@/lib/receptionLogistics/config";
import {
  collectionOrderToReceptionTruck,
  mergeCollectionOrdersIntoTrucks,
  receptionTruckIdForCollectionOrder,
} from "@/lib/receptionLogistics/syncCollectionOrderReception";
import { RAMP_OCCUPANCY_META_ID } from "@/lib/receptionLogistics/rampOccupancy";
import {
  fetchCollectionOrders,
  fetchCollectionOrderById,
  updateCollectionOrder,
} from "@/lib/collectionOrders";
import type { CollectionOrder } from "@/lib/types/collectionOrder";
import { supabase } from "@/lib/supabase";
import {
  publishReceptionTruckLive,
  subscribeReceptionLive,
} from "@/lib/receptionLogistics/receptionLiveSync";

function isTruck(value: unknown): value is ReceptionTruck {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "plate" in value &&
    "status" in value
  );
}

function readLocalSnapshot(): ReceptionQueueSnapshot {
  if (typeof window === "undefined") {
    return { trucks: [], updatedAt: new Date().toISOString() };
  }
  try {
    const raw = window.localStorage.getItem(RECEPTION_STORAGE_KEY);
    if (!raw) return { trucks: [], updatedAt: new Date().toISOString() };
    const parsed = JSON.parse(raw) as ReceptionQueueSnapshot;
    return {
      trucks: (parsed.trucks ?? []).filter(isTruck),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return { trucks: [], updatedAt: new Date().toISOString() };
  }
}

function writeLocalSnapshot(trucks: ReceptionTruck[]) {
  if (typeof window === "undefined") return;
  const snapshot: ReceptionQueueSnapshot = {
    trucks,
    updatedAt: new Date().toISOString(),
  };
  const serialized = JSON.stringify(snapshot);
  const prev = window.localStorage.getItem(RECEPTION_STORAGE_KEY);
  if (prev === serialized) return;
  window.localStorage.setItem(RECEPTION_STORAGE_KEY, serialized);
  try {
    const ch = new BroadcastChannel(RECEPTION_BROADCAST_CHANNEL);
    ch.postMessage({ type: "sync", updatedAt: snapshot.updatedAt });
    ch.close();
  } catch {
    /* BroadcastChannel no disponible */
  }
}

export function generateWarehouseReceiptNumber(plate: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14);
  const plateSafe = plate.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 8);
  return `${RECEPTION_RECEIPT_PREFIX}${stamp}-${plateSafe || "CAMION"}`;
}

export async function fetchReceptionTrucks(): Promise<ReceptionTruck[]> {
  let trucks: ReceptionTruck[] = [];
  try {
    const { data, error } = await supabase
      .from(RECEPTION_TABLE)
      .select("payload")
      .order("updated_at", { ascending: false });

    if (error) throw error;
    const rows = (data ?? []) as { id?: string; payload: unknown }[];
    trucks = rows
      .filter((r) => r.id !== RAMP_OCCUPANCY_META_ID)
      .map((r) => r.payload)
      .filter(isTruck);
  } catch {
    trucks = readLocalSnapshot().trucks;
  }

  try {
    const orders = await fetchCollectionOrders();
    trucks = mergeCollectionOrdersIntoTrucks(trucks, orders);
  } catch {
    /* Sin órdenes de recolección */
  }

  writeLocalSnapshot(trucks);
  return trucks;
}

async function syncReceptionStatusToCollectionOrder(
  truck: ReceptionTruck,
  status: ReceptionStatusId,
): Promise<void> {
  const orderId =
    truck.collectionOrderId ??
    (truck.id.startsWith("or-co-") ? truck.id.slice(6) : "");
  if (!orderId) return;

  try {
    const order = await fetchCollectionOrderById(orderId);
    if (!order || order.receptionStatus === status) return;
    await updateCollectionOrder({
      ...order,
      receptionStatus: status,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[Reception] No se pudo sincronizar OR:", e);
  }
}

export async function saveReceptionTrucks(trucks: ReceptionTruck[]): Promise<void> {
  writeLocalSnapshot(trucks);
  try {
    if (trucks.length === 0) return;
    const rows = trucks.map((t) => ({
      id: t.id,
      payload: t,
      updated_at: t.updatedAt,
    }));
    const { error } = await supabase.from(RECEPTION_TABLE).upsert(rows);
    if (error) throw error;
  } catch {
    /* Solo local */
  }
}

export async function upsertReceptionTruck(truck: ReceptionTruck): Promise<void> {
  const local = readLocalSnapshot().trucks;
  const idx = local.findIndex((t) => t.id === truck.id);
  const merged = [...local];
  const isInsert = idx < 0;
  if (idx >= 0) merged[idx] = truck;
  else merged.push(truck);
  writeLocalSnapshot(merged);
  publishReceptionTruckLive(isInsert ? "INSERT" : "UPDATE", truck.id, truck);
  try {
    const { error } = await supabase.from(RECEPTION_TABLE).upsert({
      id: truck.id,
      payload: truck,
      updated_at: truck.updatedAt,
    });
    if (error) throw error;
  } catch {
    /* Solo local */
  }
}

export async function removeReceptionTruckById(id: string): Promise<void> {
  const local = readLocalSnapshot().trucks;
  const merged = local.filter((t) => t.id !== id);
  writeLocalSnapshot(merged);
  publishReceptionTruckLive("DELETE", id, null);
  try {
    const { error } = await supabase.from(RECEPTION_TABLE).delete().eq("id", id);
    if (error) throw error;
  } catch {
    /* Solo local */
  }
}

export async function syncCollectionOrderToReceptionQueue(
  order: CollectionOrder,
): Promise<void> {
  const truckId = receptionTruckIdForCollectionOrder(order.id);
  const trucks = await fetchReceptionTrucks();
  const existing =
    trucks.find((t) => t.id === truckId) ??
    trucks.find((t) => t.collectionOrderId === order.id) ??
    null;

  if (!order.receptionStatus) {
    if (existing) await removeReceptionTruckById(existing.id);
    return;
  }

  const truck = collectionOrderToReceptionTruck(order, existing);
  if (truck) await upsertReceptionTruck(truck);
}

export async function importReceptionTrucks(
  incoming: ReceptionTruck[],
): Promise<ReceptionTruck[]> {
  const current = await fetchReceptionTrucks();
  const merged = [...current, ...incoming];
  await saveReceptionTrucks(merged);
  return merged;
}

export async function updateReceptionTruckStatus(
  truckId: string,
  status: ReceptionStatusId,
  options?: { issueReceipt?: boolean },
): Promise<ReceptionTruck | null> {
  // Preferir snapshot local (instantáneo). Si falta, un fetch puntual.
  let trucks = readLocalSnapshot().trucks;
  let idx = trucks.findIndex((t) => t.id === truckId);
  if (idx < 0) {
    trucks = await fetchReceptionTrucks();
    idx = trucks.findIndex((t) => t.id === truckId);
  }
  if (idx < 0) return null;

  const now = new Date().toISOString();
  const prev = trucks[idx]!;
  const isRamp = isRampReceptionStatus(status);
  const next: ReceptionTruck = {
    ...prev,
    status,
    updatedAt: now,
    // Sella la hora de atención al entrar a una rampa o carretillado.
    rampAssignedAt: isRamp ? (prev.rampAssignedAt ?? now) : prev.rampAssignedAt,
    // Conserva qué rampa/carretillado se usó (persiste aunque luego se complete).
    rampUsed: isRamp ? status : prev.rampUsed,
    // Sella la hora real de completado la primera vez que pasa a Completado.
    completedAt:
      status === RECEPTION_STATUS.COMPLETADO
        ? (prev.completedAt ?? now)
        : prev.completedAt,
    warehouseReceiptNumber:
      options?.issueReceipt && !prev.warehouseReceiptNumber
        ? generateWarehouseReceiptNumber(prev.plate)
        : prev.warehouseReceiptNumber,
  };

  // Persistencia + broadcast inmediato (los demás ven el movimiento al instante).
  await upsertReceptionTruck(next);

  // Sincronizar OR en segundo plano (no bloquea la UI ni el broadcast).
  if (next.collectionOrderId || next.id.startsWith("or-co-")) {
    void syncReceptionStatusToCollectionOrder(next, status);
  }
  return next;
}

const RECEPTION_POLL_MS = 4_000;

let receptionQueueListeners = new Set<() => void>();
let receptionQueueIntervalId: number | null = null;
let receptionBroadcastChannel: BroadcastChannel | null = null;
let receptionLiveUnsub: (() => void) | null = null;

function notifyReceptionQueueListeners() {
  for (const listener of receptionQueueListeners) {
    listener();
  }
}

export function subscribeReceptionQueue(onSync: () => void): () => void {
  receptionQueueListeners.add(onSync);

  const onStorage = (e: StorageEvent) => {
    if (e.key === RECEPTION_STORAGE_KEY) onSync();
  };
  window.addEventListener("storage", onStorage);

  if (!receptionBroadcastChannel) {
    try {
      receptionBroadcastChannel = new BroadcastChannel(RECEPTION_BROADCAST_CHANNEL);
      receptionBroadcastChannel.onmessage = () => notifyReceptionQueueListeners();
    } catch {
      receptionBroadcastChannel = null;
    }
  }

  if (receptionQueueIntervalId == null) {
    receptionQueueIntervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      notifyReceptionQueueListeners();
    }, RECEPTION_POLL_MS);
  }

  // Realtime + broadcast: avisa para un refetch de consistencia (el parche
  // inmediato lo aplica useReceptionQueue vía subscribeReceptionLive).
  if (!receptionLiveUnsub) {
    receptionLiveUnsub = subscribeReceptionLive(() => {
      notifyReceptionQueueListeners();
    });
  }

  return () => {
    receptionQueueListeners.delete(onSync);
    window.removeEventListener("storage", onStorage);

    if (receptionQueueListeners.size === 0) {
      if (receptionQueueIntervalId != null) {
        window.clearInterval(receptionQueueIntervalId);
        receptionQueueIntervalId = null;
      }
      if (receptionBroadcastChannel) {
        receptionBroadcastChannel.close();
        receptionBroadcastChannel = null;
      }
      if (receptionLiveUnsub) {
        receptionLiveUnsub();
        receptionLiveUnsub = null;
      }
    }
  };
}
