import type { CollectionOrder } from "@/lib/types/collectionOrder";
import type { ReceptionTruck } from "@/lib/receptionLogistics/types";

export function receptionTruckIdForCollectionOrder(orderId: string): string {
  return `or-co-${orderId}`;
}

function orderBultos(order: CollectionOrder): number {
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
  orderUpdatedAt?: string,
): number {
  const so = existing?.sortOrder;
  if (so != null && so >= RECEPTION_SORT_EPOCH_MIN) return so;
  if (existing?.createdAt) {
    const t = Date.parse(existing.createdAt);
    if (Number.isFinite(t)) return t;
  }
  if (orderUpdatedAt) {
    const t = Date.parse(orderUpdatedAt);
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

export function collectionOrderToReceptionTruck(
  order: CollectionOrder,
  existing?: ReceptionTruck | null,
): ReceptionTruck | null {
  if (!order.receptionStatus) return null;

  const now = new Date().toISOString();
  const numero = String(order.numero ?? "").trim() || order.id.slice(0, 8);
  const status = order.receptionStatus;

  return {
    id: receptionTruckIdForCollectionOrder(order.id),
    plate: `OR #${numero}`,
    provider: order.proveedor?.trim() || "—",
    client: order.cliente?.trim() || "—",
    ra: order.linkedRaNumbers?.[0]?.trim() || `OR-${numero}`,
    expectedBultos: orderBultos(order),
    notes: order.expedidor?.trim() || order.notes?.trim() || undefined,
    status,
    sortOrder: resolveReceptionSortOrder(existing, order.updatedAt),
    collectionOrderId: order.id,
    source: "collection_order",
    rampAssignedAt: status.startsWith("RAMPA")
      ? (existing?.rampAssignedAt ?? now)
      : existing?.rampAssignedAt,
    warehouseReceiptNumber: existing?.warehouseReceiptNumber,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function isCollectionOrderReceptionTruck(truck: ReceptionTruck): boolean {
  return (
    truck.source === "collection_order" ||
    !!truck.collectionOrderId ||
    truck.id.startsWith("or-co-")
  );
}

/** Mezcla camiones importados con órdenes de recolección en recepción. */
export function mergeCollectionOrdersIntoTrucks(
  trucks: ReceptionTruck[],
  orders: CollectionOrder[],
): ReceptionTruck[] {
  const manual = trucks.filter((t) => !isCollectionOrderReceptionTruck(t));
  const existingByOrderId = new Map<string, ReceptionTruck>();
  for (const t of trucks) {
    const orderId = t.collectionOrderId ?? (t.id.startsWith("or-co-") ? t.id.slice(6) : "");
    if (orderId) existingByOrderId.set(orderId, t);
  }

  const fromOrders: ReceptionTruck[] = [];
  for (const order of orders) {
    if (!order.receptionStatus) continue;
    const existing = existingByOrderId.get(order.id) ?? null;
    const truck = collectionOrderToReceptionTruck(order, existing);
    if (truck) fromOrders.push(truck);
  }

  return [...manual, ...fromOrders];
}
