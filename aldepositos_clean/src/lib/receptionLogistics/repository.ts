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
  buildGroupReceptionTruck,
  collectionOrderToReceptionTruck,
  isReceptionGroupTruckId,
  mergeCollectionOrdersIntoTrucks,
  newReceptionGroupId,
  receptionOrderIds,
  receptionTruckIdForCollectionOrder,
} from "@/lib/receptionLogistics/syncCollectionOrderReception";
import { RAMP_OCCUPANCY_META_ID } from "@/lib/receptionLogistics/rampOccupancy";
import {
  fetchCollectionOrdersByReceptionGroupId,
  fetchCollectionOrdersForReception,
  fetchCollectionOrderById,
  updateCollectionOrder,
} from "@/lib/collectionOrders";
import type { CollectionOrder } from "@/lib/types/collectionOrder";
import { supabase } from "@/lib/supabase";
import {
  publishReceptionTruckLive,
  subscribeReceptionLive,
} from "@/lib/receptionLogistics/receptionLiveSync";

function findLocalTruck(id: string): ReceptionTruck | null {
  return readLocalSnapshot().trucks.find((t) => t.id === id) ?? null;
}

/** Preferir snapshot local; si falta, solo la tabla de camiones (sin merge de OR). */
async function findTruckPreferLocal(
  truckId: string,
): Promise<ReceptionTruck | null> {
  const local = findLocalTruck(truckId);
  if (local) return local;
  try {
    const raw = await fetchReceptionTrucksRaw();
    return raw.find((t) => t.id === truckId) ?? null;
  } catch {
    return null;
  }
}

/** Completados más viejos que esto no se bajan en el hydrate del tablero. */
const RECEPTION_COMPLETED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

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

/** Snapshot local para paint inmediato (sin red). */
export function peekReceptionTrucksLocal(): ReceptionTruck[] {
  return readLocalSnapshot().trucks;
}

/** Firma liviana para evitar re-renders cuando el refetch no cambió nada. */
export function receptionTrucksFingerprint(list: ReceptionTruck[]): string {
  if (list.length === 0) return "";
  return list
    .map(
      (t) =>
        `${t.id}:${t.updatedAt}:${t.status}:${t.sortOrder ?? ""}:${t.warehouseReceiptNumber ?? ""}`,
    )
    .join("|");
}

function keepReceptionTruckForBoard(
  truck: ReceptionTruck,
  nowMs: number,
): boolean {
  if (truck.status !== RECEPTION_STATUS.COMPLETADO) return true;
  const stamp = Date.parse(
    truck.completedAt || truck.updatedAt || truck.createdAt || "",
  );
  if (!Number.isFinite(stamp)) return true;
  return nowMs - stamp <= RECEPTION_COMPLETED_RETENTION_MS;
}

async function fetchReceptionTrucksRaw(): Promise<ReceptionTruck[]> {
  const { data, error } = await supabase
    .from(RECEPTION_TABLE)
    .select("id, payload, updated_at")
    .order("updated_at", { ascending: false });

  if (error) throw error;
  const rows = (data ?? []) as {
    id?: string;
    payload: unknown;
    updated_at?: string;
  }[];
  const nowMs = Date.now();
  return rows
    .filter((r) => r.id !== RAMP_OCCUPANCY_META_ID)
    .map((r) => r.payload)
    .filter(isTruck)
    .filter((t) => keepReceptionTruckForBoard(t, nowMs));
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
  const localFallback = readLocalSnapshot().trucks;

  const [trucksResult, ordersResult] = await Promise.allSettled([
    fetchReceptionTrucksRaw(),
    fetchCollectionOrdersForReception(),
  ]);

  let trucks: ReceptionTruck[] =
    trucksResult.status === "fulfilled" ? trucksResult.value : localFallback;

  if (ordersResult.status === "fulfilled") {
    trucks = mergeCollectionOrdersIntoTrucks(trucks, ordersResult.value);
    const nowMs = Date.now();
    trucks = trucks.filter((t) => keepReceptionTruckForBoard(t, nowMs));
  }

  writeLocalSnapshot(trucks);
  return trucks;
}

async function syncReceptionStatusToCollectionOrder(
  truck: ReceptionTruck,
  status: ReceptionStatusId,
): Promise<void> {
  const orderIds = receptionOrderIds(truck);
  if (orderIds.length === 0) return;

  const groupId = isReceptionGroupTruckId(truck.id) ? truck.id : undefined;

  await Promise.all(
    orderIds.map(async (orderId) => {
      try {
        const order = await fetchCollectionOrderById(orderId);
        if (!order) return;

        // Listo individual: no devolver a rampa/fila ni re-enganchar al camión.
        if (order.receptionStatus === RECEPTION_STATUS.COMPLETADO) {
          return;
        }
        // Ya salió del grupo (p. ej. Listo): el camión viejo no debe reclamarla.
        if (groupId) {
          const oidGroup = order.receptionGroupId?.trim();
          if (!oidGroup || oidGroup !== groupId) return;
        }

        if (
          order.receptionStatus === status &&
          (groupId ? order.receptionGroupId === groupId : true)
        ) {
          return;
        }
        const now = new Date().toISOString();
        const next: CollectionOrder = {
          ...order,
          receptionStatus: status,
          receptionQueuedAt: order.receptionQueuedAt || now,
          updatedAt: now,
        };
        if (groupId) next.receptionGroupId = groupId;
        await updateCollectionOrder(next);
      } catch (e) {
        console.error("[Reception] No se pudo sincronizar OR:", orderId, e);
      }
    }),
  );
}

/**
 * Agrupa ≥2 OR en un solo camión y las pone en fila.
 * Placa / chofer son opcionales.
 */
export async function createReceptionTruckGroup(input: {
  orderIds: string[];
  plate?: string | null;
  driverName?: string | null;
}): Promise<ReceptionTruck> {
  const uniqueIds = Array.from(
    new Set(input.orderIds.map((id) => String(id).trim()).filter(Boolean)),
  );
  if (uniqueIds.length < 2) {
    throw new Error("Seleccioná al menos 2 órdenes para un camión.");
  }

  const loaded: CollectionOrder[] = [];
  for (const id of uniqueIds) {
    const order = await fetchCollectionOrderById(id);
    if (!order) throw new Error(`No se encontró la OR ${id}`);
    if (
      order.receptionStatus &&
      order.receptionStatus !== RECEPTION_STATUS.EN_FILA
    ) {
      throw new Error(
        `La OR #${order.numero ?? id.slice(0, 8)} ya está en rampa o completada.`,
      );
    }
    if (
      order.receptionGroupId &&
      order.receptionStatus === RECEPTION_STATUS.EN_FILA
    ) {
      throw new Error(
        `La OR #${order.numero ?? id.slice(0, 8)} ya pertenece a otro camión.`,
      );
    }
    loaded.push(order);
  }

  const groupId = newReceptionGroupId();
  const now = new Date().toISOString();
  const earliestQueued = loaded.reduce((min, o) => {
    const t = Date.parse(o.receptionQueuedAt || "");
    if (!Number.isFinite(t) || t <= 0) return min;
    return min == null || t < min ? t : min;
  }, null as number | null);
  const receptionQueuedAt =
    earliestQueued != null ? new Date(earliestQueued).toISOString() : now;

  await Promise.all(
    loaded.map((order) =>
      removeReceptionTruckById(receptionTruckIdForCollectionOrder(order.id)),
    ),
  );

  const updatedOrders: CollectionOrder[] = loaded.map((order) => ({
    ...order,
    receptionStatus: RECEPTION_STATUS.EN_FILA,
    receptionGroupId: groupId,
    receptionQueuedAt: order.receptionQueuedAt || receptionQueuedAt,
    updatedAt: now,
  }));
  await Promise.all(updatedOrders.map((payload) => updateCollectionOrder(payload)));

  const truck = buildGroupReceptionTruck(updatedOrders, null, {
    groupId,
  });
  if (!truck) throw new Error("No se pudo armar el camión.");

  // FIFO: sellar posición con el instante de entrada a fila (no updatedAt).
  const queuedMs = Date.parse(receptionQueuedAt);
  truck.sortOrder =
    Number.isFinite(queuedMs) && queuedMs >= 1_000_000_000_000
      ? queuedMs
      : Date.now();

  await upsertReceptionTruck(truck);
  return truck;
}

/**
 * Suma una o más OR sueltas a un camión ya unificado (p. ej. se olvidó una).
 * Las OR nuevas adoptan el mismo estado del grupo (fila / rampa).
 */
export async function addOrdersToReceptionGroup(input: {
  groupId: string;
  orderIds: string[];
}): Promise<ReceptionTruck> {
  const groupId = String(input.groupId ?? "").trim();
  const uniqueIds = Array.from(
    new Set(input.orderIds.map((id) => String(id).trim()).filter(Boolean)),
  );
  if (!groupId) {
    throw new Error("Indicá el camión al que querés agregar la OR.");
  }
  if (uniqueIds.length < 1) {
    throw new Error("Seleccioná al menos 1 OR para agregar al camión.");
  }

  const siblings = await fetchCollectionOrdersByReceptionGroupId(groupId);
  if (siblings.length === 0) {
    throw new Error("No se encontró el camión unificado (puede haberse disuelto).");
  }

  const groupStatus =
    siblings.find((s) => s.receptionStatus)?.receptionStatus ??
    RECEPTION_STATUS.EN_FILA;
  if (groupStatus === RECEPTION_STATUS.COMPLETADO) {
    throw new Error("Ese camión ya está completado; no se pueden sumar más OR.");
  }

  const loaded = await Promise.all(
    uniqueIds.map(async (id) => {
      if (siblings.some((s) => s.id === id)) {
        throw new Error("Esa OR ya forma parte del camión seleccionado.");
      }
      const order = await fetchCollectionOrderById(id);
      if (!order) throw new Error(`No se encontró la OR ${id}`);
      if (order.receptionGroupId) {
        throw new Error(
          `La OR #${order.numero ?? id.slice(0, 8)} ya pertenece a otro camión.`,
        );
      }
      if (
        order.receptionStatus &&
        order.receptionStatus !== RECEPTION_STATUS.EN_FILA
      ) {
        throw new Error(
          `La OR #${order.numero ?? id.slice(0, 8)} ya está en rampa o completada.`,
        );
      }
      return order;
    }),
  );

  const groupTruck = await findTruckPreferLocal(groupId);
  const now = new Date().toISOString();
  const groupQueuedAt =
    siblings
      .map((o) => o.receptionQueuedAt)
      .find((t) => !!t?.trim()) ?? now;

  await Promise.all(
    loaded.map((order) =>
      removeReceptionTruckById(receptionTruckIdForCollectionOrder(order.id)),
    ),
  );

  const updatedNew: CollectionOrder[] = loaded.map((order) => ({
    ...order,
    receptionStatus: groupStatus,
    receptionGroupId: groupId,
    receptionQueuedAt: order.receptionQueuedAt || groupQueuedAt,
    updatedAt: now,
  }));
  await Promise.all(updatedNew.map((payload) => updateCollectionOrder(payload)));

  const allMembers = [...siblings, ...updatedNew];
  const rebuilt = buildGroupReceptionTruck(allMembers, groupTruck, {
    groupId,
  });
  if (!rebuilt) throw new Error("No se pudo actualizar el camión.");

  if (groupTruck?.sortOrder != null) {
    rebuilt.sortOrder = groupTruck.sortOrder;
  }

  await upsertReceptionTruck(rebuilt);
  return rebuilt;
}

/**
 * Quita una OR del grupo (solo si el grupo sigue en fila).
 * Si queda 1 OR, disuelve el grupo a tarjeta suelta.
 * Si queda 0, elimina el camión.
 */
export async function removeOrderFromReceptionGroup(
  orderId: string,
): Promise<void> {
  const order = await fetchCollectionOrderById(orderId);
  if (!order?.receptionGroupId) {
    // Sin grupo: clear normal
    if (!order?.receptionStatus) return;
    const {
      receptionStatus: _s,
      receptionGroupId: _g,
      receptionQueuedAt: _q,
      ...rest
    } = order;
    const payload: CollectionOrder = {
      ...rest,
      updatedAt: new Date().toISOString(),
    };
    await updateCollectionOrder(payload);
    await syncCollectionOrderToReceptionQueue(payload);
    return;
  }

  const groupId = order.receptionGroupId;
  const groupTruck = await findTruckPreferLocal(groupId);

  const {
    receptionStatus: _s,
    receptionGroupId: _g,
    receptionQueuedAt: _q,
    ...rest
  } = order;
  const cleared: CollectionOrder = {
    ...rest,
    updatedAt: new Date().toISOString(),
  };
  await updateCollectionOrder(cleared);

  const siblings = (
    await fetchCollectionOrdersByReceptionGroupId(groupId)
  ).filter((o) => o.id !== orderId);

  if (siblings.length === 0) {
    await removeReceptionTruckById(groupId);
    return;
  }

  if (siblings.length === 1) {
    const only = siblings[0]!;
    const { receptionGroupId: _rg, ...onlyRest } = only;
    const solo: CollectionOrder = {
      ...onlyRest,
      receptionStatus: only.receptionStatus ?? RECEPTION_STATUS.EN_FILA,
      updatedAt: new Date().toISOString(),
    };
    await updateCollectionOrder(solo);
    await removeReceptionTruckById(groupId);
    const soloTruck = collectionOrderToReceptionTruck(solo, null);
    if (soloTruck) await upsertReceptionTruck(soloTruck);
    return;
  }

  const rebuilt = buildGroupReceptionTruck(siblings, groupTruck, {
    groupId,
  });
  if (rebuilt) await upsertReceptionTruck(rebuilt);
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
  // OR dentro de un grupo: reconstruir tarjeta de grupo.
  if (order.receptionGroupId) {
    const groupId = order.receptionGroupId;
    const siblings = await fetchCollectionOrdersByReceptionGroupId(groupId);

    if (!order.receptionStatus) {
      // Ya no debería llegar con groupId y sin status; limpiar huérfanos.
      if (siblings.length === 0) {
        await removeReceptionTruckById(groupId);
      }
      return;
    }

    const existing = findLocalTruck(groupId);
    const truck = buildGroupReceptionTruck(
      siblings.length ? siblings : [order],
      existing,
      { groupId },
    );
    if (truck) await upsertReceptionTruck(truck);
    // Eliminar posibles tarjetas individuales de esas OR.
    const members = siblings.length ? siblings : [order];
    await Promise.all(
      members.map((o) =>
        removeReceptionTruckById(receptionTruckIdForCollectionOrder(o.id)),
      ),
    );
    return;
  }

  const truckId = receptionTruckIdForCollectionOrder(order.id);
  const local = readLocalSnapshot().trucks;
  const existing =
    local.find((t) => t.id === truckId) ??
    local.find(
      (t) =>
        receptionOrderIds(t).includes(order.id) &&
        !isReceptionGroupTruckId(t.id),
    ) ??
    null;

  // Si estaba en un grupo y se limpió el groupId, no tocar grupos aquí.
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
  // Preferir snapshot local (instantáneo). Si falta, solo tabla de camiones.
  let trucks = readLocalSnapshot().trucks;
  let idx = trucks.findIndex((t) => t.id === truckId);
  if (idx < 0) {
    try {
      trucks = await fetchReceptionTrucksRaw();
      idx = trucks.findIndex((t) => t.id === truckId);
    } catch {
      /* seguir con local */
    }
  }

  // Grupo huérfano: reconstruir desde las OR del grupo y seguir.
  if (idx < 0 && isReceptionGroupTruckId(truckId)) {
    const siblings = await fetchCollectionOrdersByReceptionGroupId(truckId);
    if (siblings.length === 0) return null;
    const rebuilt = buildGroupReceptionTruck(siblings, null, { groupId: truckId });
    if (!rebuilt) return null;
    await upsertReceptionTruck(rebuilt);
    trucks = readLocalSnapshot().trucks;
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

  // Sincronizar OR (una o varias del grupo) — await para no perder el cambio.
  if (receptionOrderIds(next).length > 0) {
    await syncReceptionStatusToCollectionOrder(next, status);
  }
  return next;
}

/**
 * Cambia el estado de recepción de una OR (y de su camión agrupado si aplica).
 * Persiste siempre en collection_orders; si falta la tarjeta del grupo, la reconstruye.
 * Sirve para devolver a FILA desde rampa / carretillado / extra.
 *
 * Excepción LISTO (COMPLETADO): solo completa esa OR y la saca del camión;
 * las demás del grupo siguen en fila/rampa.
 */
export async function setCollectionOrderReceptionStatus(
  orderId: string,
  status: ReceptionStatusId,
  options?: { issueReceipt?: boolean },
): Promise<CollectionOrder[]> {
  const order = await fetchCollectionOrderById(orderId);
  if (!order) {
    throw new Error("No se encontró la orden de recolección.");
  }
  if (order.receptionStatus === status) {
    return [order];
  }

  const now = new Date().toISOString();
  const issueReceipt = options?.issueReceipt === true;

  // LISTO: una sola OR, aunque venga en camión agrupado.
  if (
    order.receptionGroupId &&
    status === RECEPTION_STATUS.COMPLETADO
  ) {
    return completeSingleOrderFromReceptionGroup(order, {
      issueReceipt,
      now,
    });
  }

  // Camión agrupado: mover todas las OR del grupo juntas (fila / rampas / carret.).
  if (order.receptionGroupId) {
    const groupId = order.receptionGroupId;
    const byId = new Map<string, CollectionOrder>();
    for (const o of await fetchCollectionOrdersByReceptionGroupId(groupId)) {
      byId.set(o.id, o);
    }
    byId.set(order.id, order);

    const updated: CollectionOrder[] = Array.from(byId.values()).map((o) => ({
      ...o,
      receptionStatus: status,
      receptionGroupId: groupId,
      receptionQueuedAt: o.receptionQueuedAt || now,
      updatedAt: now,
    }));
    await Promise.all(updated.map((next) => updateCollectionOrder(next)));

    const existing = await findTruckPreferLocal(groupId);
    const base = buildGroupReceptionTruck(updated, existing, { groupId });
    if (base) {
      const isRamp = isRampReceptionStatus(status);
      const truck: ReceptionTruck = {
        ...base,
        rampAssignedAt: isRamp
          ? (existing?.rampAssignedAt ?? now)
          : existing?.rampAssignedAt,
        rampUsed: isRamp ? status : existing?.rampUsed,
        completedAt: existing?.completedAt,
        warehouseReceiptNumber:
          issueReceipt && !existing?.warehouseReceiptNumber
            ? generateWarehouseReceiptNumber(base.plate)
            : existing?.warehouseReceiptNumber,
      };
      await upsertReceptionTruck(truck);
      await Promise.all(
        updated.map((o) =>
          removeReceptionTruckById(receptionTruckIdForCollectionOrder(o.id)),
        ),
      );
    }
    return updated;
  }

  // OR suelta
  const payload: CollectionOrder = {
    ...order,
    receptionStatus: status,
    receptionQueuedAt: order.receptionQueuedAt || now,
    updatedAt: now,
  };
  await updateCollectionOrder(payload);
  await syncCollectionOrderToReceptionQueue(payload);

  if (issueReceipt) {
    const truckId = receptionTruckIdForCollectionOrder(order.id);
    const updatedTruck = await updateReceptionTruckStatus(truckId, status, {
      issueReceipt: true,
    });
    // Si no existía tarjeta, sync ya la creó; volver a aplicar recibo.
    if (!updatedTruck) {
      await syncCollectionOrderToReceptionQueue(payload);
      await updateReceptionTruckStatus(truckId, status, { issueReceipt: true });
    }
  }

  return [payload];
}

/**
 * Marca LISTO solo esa OR y la separa del camión.
 * El resto del grupo permanece en su estado (fila/rampa).
 */
async function completeSingleOrderFromReceptionGroup(
  order: CollectionOrder,
  opts: { issueReceipt: boolean; now: string },
): Promise<CollectionOrder[]> {
  const groupId = order.receptionGroupId!;
  const { issueReceipt, now } = opts;

  const {
    receptionGroupId: _g,
    ...withoutGroup
  } = order;
  const completed: CollectionOrder = {
    ...withoutGroup,
    receptionStatus: RECEPTION_STATUS.COMPLETADO,
    receptionQueuedAt: order.receptionQueuedAt || now,
    updatedAt: now,
  };
  await updateCollectionOrder(completed);

  const siblings = (
    await fetchCollectionOrdersByReceptionGroupId(groupId)
  ).filter((o) => o.id !== order.id);

  const existingGroup = await findTruckPreferLocal(groupId);
  const result: CollectionOrder[] = [completed];

  if (siblings.length === 0) {
    await removeReceptionTruckById(groupId);
  } else if (siblings.length === 1) {
    const only = siblings[0]!;
    const { receptionGroupId: _rg, ...onlyRest } = only;
    const solo: CollectionOrder = {
      ...onlyRest,
      receptionStatus: only.receptionStatus ?? RECEPTION_STATUS.EN_FILA,
      receptionQueuedAt: only.receptionQueuedAt || now,
      updatedAt: now,
    };
    await updateCollectionOrder(solo);
    result.push(solo);
    await removeReceptionTruckById(groupId);
    await syncCollectionOrderToReceptionQueue(solo);
  } else {
    const rebuilt = buildGroupReceptionTruck(siblings, existingGroup, {
      groupId,
    });
    if (rebuilt) {
      await upsertReceptionTruck({
        ...rebuilt,
        rampAssignedAt: existingGroup?.rampAssignedAt ?? rebuilt.rampAssignedAt,
        rampUsed: existingGroup?.rampUsed ?? rebuilt.rampUsed,
        warehouseReceiptNumber: existingGroup?.warehouseReceiptNumber,
      });
    }
  }

  await syncCollectionOrderToReceptionQueue(completed);

  if (issueReceipt) {
    const truckId = receptionTruckIdForCollectionOrder(completed.id);
    await updateReceptionTruckStatus(truckId, RECEPTION_STATUS.COMPLETADO, {
      issueReceipt: true,
    });
  }

  return result;
}

/** Consistencia de respaldo; los movimientos van por Realtime/broadcast. */
const RECEPTION_POLL_MS = 15_000;

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
