import type { CollectionOrder } from "@/lib/types/collectionOrder";
import type { ReceptionTruck } from "@/lib/receptionLogistics/types";
import {
  RECEPTION_STATUS,
  isRampReceptionStatus,
} from "@/lib/receptionLogistics/config";

export function receptionTruckIdForCollectionOrder(orderId: string): string {
  return `or-co-${orderId}`;
}

export function newReceptionGroupId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `or-grp-${crypto.randomUUID()}`;
  }
  return `or-grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isReceptionGroupTruckId(id: string): boolean {
  return id.startsWith("or-grp-");
}

export function orderBultos(order: CollectionOrder): number {
  if (order.expectedBultos != null && order.expectedBultos > 0) {
    return Math.round(order.expectedBultos);
  }
  let sum = 0;
  for (const l of order.lines) {
    const n = parseFloat(String(l.bultos ?? "").replace(",", "."));
    if (Number.isFinite(n) && n > 0) sum += Math.round(n);
  }
  return sum;
}

/** sortOrder en ms; valores bajos son legado (número OR usado por error). */
const RECEPTION_SORT_EPOCH_MIN = 1_000_000_000_000;

/** Posición en fila: primero en llegar = primero en cola (no por número OR). */
function resolveReceptionSortOrder(
  existing: ReceptionTruck | null | undefined,
  queueHint?: string,
): number {
  const so = existing?.sortOrder;
  if (so != null && so >= RECEPTION_SORT_EPOCH_MIN) return so;
  if (queueHint) {
    const t = Date.parse(queueHint);
    if (Number.isFinite(t)) return t;
  }
  if (existing?.createdAt) {
    const t = Date.parse(existing.createdAt);
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

function earliestReceptionQueueHint(orders: CollectionOrder[]): string | undefined {
  let best: number | null = null;
  for (const o of orders) {
    for (const raw of [o.receptionQueuedAt, o.updatedAt, o.createdAt]) {
      const t = Date.parse(raw || "");
      if (!Number.isFinite(t) || t <= 0) continue;
      if (best == null || t < best) best = t;
      break;
    }
  }
  return best != null ? new Date(best).toISOString() : undefined;
}

export function orderDisplayNumero(order: CollectionOrder): string {
  return String(order.numero ?? "").trim() || order.id.slice(0, 8);
}

export function receptionOrderIds(truck: ReceptionTruck): string[] {
  if (truck.collectionOrderIds && truck.collectionOrderIds.length > 0) {
    return [...truck.collectionOrderIds];
  }
  if (truck.collectionOrderId) return [truck.collectionOrderId];
  if (truck.id.startsWith("or-co-")) return [truck.id.slice(6)];
  return [];
}

export function isGroupedReceptionTruck(truck: ReceptionTruck): boolean {
  return (
    isReceptionGroupTruckId(truck.id) ||
    (truck.collectionOrderIds?.length ?? 0) > 1
  );
}

export function collectionOrderToReceptionTruck(
  order: CollectionOrder,
  existing?: ReceptionTruck | null,
): ReceptionTruck | null {
  if (!order.receptionStatus) return null;
  // Las OR de un grupo se materializan vía buildGroupReceptionTruck.
  if (order.receptionGroupId) return null;

  const now = new Date().toISOString();
  const numero = orderDisplayNumero(order);
  const status = order.receptionStatus;
  const isRamp = isRampReceptionStatus(status);

  return {
    id: receptionTruckIdForCollectionOrder(order.id),
    plate: order.proveedor?.trim() || `OR #${numero}`,
    provider: order.proveedor?.trim() || "—",
    client: order.cliente?.trim() || "—",
    ra: order.linkedRaNumbers?.[0]?.trim() || `OR-${numero}`,
    expectedBultos: orderBultos(order),
    notes: order.expedidor?.trim() || order.notes?.trim() || undefined,
    status,
    sortOrder: resolveReceptionSortOrder(
      existing,
      order.receptionQueuedAt || order.updatedAt,
    ),
    collectionOrderId: order.id,
    collectionOrderIds: [order.id],
    orderNumeros: [numero],
    orderLines: [{ numero, bultos: orderBultos(order) }],
    source: "collection_order",
    rampAssignedAt: isRamp
      ? (existing?.rampAssignedAt ?? now)
      : existing?.rampAssignedAt,
    rampUsed: isRamp ? status : existing?.rampUsed,
    completedAt:
      status === RECEPTION_STATUS.COMPLETADO
        ? (existing?.completedAt ??
          order.updatedAt ??
          existing?.updatedAt ??
          now)
        : existing?.completedAt,
    warehouseReceiptNumber: existing?.warehouseReceiptNumber,
    createdAt: existing?.createdAt ?? order.createdAt ?? now,
    updatedAt: now,
  };
}

export type BuildGroupTruckMeta = {
  groupId: string;
  plate?: string | null;
  driverName?: string | null;
};

function dominantProvider(orders: CollectionOrder[]): string {
  const counts = new Map<string, number>();
  for (const o of orders) {
    const p = o.proveedor?.trim() || "—";
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let best = "—";
  let bestN = -1;
  for (const [p, n] of counts) {
    if (n > bestN) {
      best = p;
      bestN = n;
    }
  }
  return best;
}

function clientSummary(orders: CollectionOrder[]): string {
  const clients = Array.from(
    new Set(
      orders
        .map((o) => o.cliente?.trim())
        .filter((c): c is string => !!c && c !== "—"),
    ),
  );
  if (clients.length === 0) return "—";
  if (clients.length === 1) return clients[0]!;
  if (clients.length === 2) return `${clients[0]} · ${clients[1]}`;
  return `${clients[0]} +${clients.length - 1}`;
}

/** Construye la tarjeta de un camión con N OR. */
export function buildGroupReceptionTruck(
  orders: CollectionOrder[],
  existing: ReceptionTruck | null | undefined,
  meta: BuildGroupTruckMeta,
): ReceptionTruck | null {
  const withStatus = orders.filter((o) => !!o.receptionStatus);
  if (withStatus.length === 0) return null;

  const now = new Date().toISOString();
  const status = withStatus[0]!.receptionStatus!;
  const isRamp = isRampReceptionStatus(status);
  const numeros = withStatus.map(orderDisplayNumero);
  const ids = withStatus.map((o) => o.id);
  const provider = dominantProvider(withStatus);
  const orderLines = withStatus.map((o) => ({
    numero: orderDisplayNumero(o),
    bultos: orderBultos(o),
  }));

  const earliestCreated = withStatus.reduce((min, o) => {
    const t = Date.parse(o.createdAt);
    if (!Number.isFinite(t)) return min;
    return min == null || t < min ? t : min;
  }, null as number | null);

  return {
    id: meta.groupId,
    /** Título operativo: proveedor (no placa). */
    plate: provider,
    provider,
    client: clientSummary(withStatus),
    ra: withStatus
      .flatMap((o) => o.linkedRaNumbers ?? [])
      .filter(Boolean)
      .slice(0, 3)
      .join(", ") || `GRP-${withStatus.length}`,
    expectedBultos: withStatus.reduce((s, o) => s + orderBultos(o), 0),
    driverName: undefined,
    notes: withStatus
      .map((o) => o.expedidor?.trim() || o.notes?.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(" · ") || undefined,
    status,
    sortOrder: resolveReceptionSortOrder(
      existing,
      earliestReceptionQueueHint(withStatus),
    ),
    collectionOrderId: ids[0],
    collectionOrderIds: ids,
    orderNumeros: numeros,
    orderLines,
    source: "collection_order",
    rampAssignedAt: isRamp
      ? (existing?.rampAssignedAt ?? now)
      : existing?.rampAssignedAt,
    rampUsed: isRamp ? status : existing?.rampUsed,
    completedAt:
      status === RECEPTION_STATUS.COMPLETADO
        ? (existing?.completedAt ?? now)
        : existing?.completedAt,
    warehouseReceiptNumber: existing?.warehouseReceiptNumber,
    createdAt:
      existing?.createdAt ??
      (earliestCreated != null
        ? new Date(earliestCreated).toISOString()
        : now),
    updatedAt: now,
  };
}

export function isCollectionOrderReceptionTruck(truck: ReceptionTruck): boolean {
  return (
    truck.source === "collection_order" ||
    !!truck.collectionOrderId ||
    (truck.collectionOrderIds?.length ?? 0) > 0 ||
    truck.id.startsWith("or-co-") ||
    isReceptionGroupTruckId(truck.id)
  );
}

/** Mezcla camiones importados con órdenes de recolección en recepción. */
export function mergeCollectionOrdersIntoTrucks(
  trucks: ReceptionTruck[],
  orders: CollectionOrder[],
): ReceptionTruck[] {
  const manual = trucks.filter((t) => !isCollectionOrderReceptionTruck(t));

  const existingById = new Map(trucks.map((t) => [t.id, t]));
  const existingByOrderId = new Map<string, ReceptionTruck>();
  for (const t of trucks) {
    for (const orderId of receptionOrderIds(t)) {
      existingByOrderId.set(orderId, t);
    }
  }

  const groups = new Map<string, CollectionOrder[]>();
  const singles: CollectionOrder[] = [];

  for (const order of orders) {
    if (!order.receptionStatus) continue;
    const gid = order.receptionGroupId?.trim();
    if (gid) {
      const list = groups.get(gid) ?? [];
      list.push(order);
      groups.set(gid, list);
    } else {
      singles.push(order);
    }
  }

  const fromOrders: ReceptionTruck[] = [];
  const usedOrderIds = new Set<string>();

  for (const [groupId, groupOrders] of groups) {
    const existing =
      existingById.get(groupId) ??
      existingByOrderId.get(groupOrders[0]!.id) ??
      null;
    const truck = buildGroupReceptionTruck(groupOrders, existing, {
      groupId,
    });
    if (truck) {
      fromOrders.push(truck);
      for (const o of groupOrders) usedOrderIds.add(o.id);
    }
  }

  for (const order of singles) {
    if (usedOrderIds.has(order.id)) continue;
    const existing =
      existingByOrderId.get(order.id) ??
      existingById.get(receptionTruckIdForCollectionOrder(order.id)) ??
      null;
    // Si el existing era un grupo huérfano, preferir tarjeta suelta.
    const existingSingle =
      existing && !isGroupedReceptionTruck(existing) ? existing : null;
    const truck = collectionOrderToReceptionTruck(order, existingSingle);
    if (truck) {
      fromOrders.push(truck);
      usedOrderIds.add(order.id);
    }
  }

  return [...manual, ...fromOrders];
}
