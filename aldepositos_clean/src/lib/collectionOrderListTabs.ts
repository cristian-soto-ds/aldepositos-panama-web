import type { CollectionOrder } from "@/lib/types/collectionOrder";
import { RECEPTION_STATUS } from "@/lib/receptionLogistics/config";

export type CollectionOrderListTab = "general" | "warehouse";

/** Recepcionista marcó completado: mercancía en bodega, pendiente de RA. */
export function isOrderInWarehouse(order: CollectionOrder): boolean {
  return order.receptionStatus === RECEPTION_STATUS.COMPLETADO;
}

export function orderHasLinkedRa(order: CollectionOrder): boolean {
  return (order.linkedRaNumbers ?? []).some((ra) => String(ra ?? "").trim().length > 0);
}

export function ordersForCollectionListTab(
  orders: CollectionOrder[],
  tab: CollectionOrderListTab,
): CollectionOrder[] {
  if (tab === "warehouse") return orders.filter(isOrderInWarehouse);
  return orders.filter((o) => !isOrderInWarehouse(o));
}

export function countOrdersForCollectionListTab(
  orders: CollectionOrder[],
  tab: CollectionOrderListTab,
): number {
  return ordersForCollectionListTab(orders, tab).length;
}
