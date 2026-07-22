import type { CollectionOrder } from "@/lib/types/collectionOrder";
import { RECEPTION_STATUS } from "@/lib/receptionLogistics/config";

export type CollectionOrderListTab = "general" | "warehouse" | "linkedRa" | "noInventory";

const NO_INVENTORY_PARTIES = new Set([
  "roca logistic s a",
  "70",
  "x10",
  "pm cargo",
  "keiko y citrus",
  "mario abad",
]);

function normalizePartyName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Clientes/proveedores/marcas que, por ahora, no pasan por el proceso de inventario. */
export function isOrderWithoutInventory(order: CollectionOrder): boolean {
  if (order.sinInventario === true) return true;
  return [order.cliente, order.proveedor, order.marca].some((value) =>
    NO_INVENTORY_PARTIES.has(normalizePartyName(value)),
  );
}

/** Recepcionista marcó completado: mercancía en bodega, pendiente de RA. */
export function isOrderInWarehouse(order: CollectionOrder): boolean {
  return order.receptionStatus === RECEPTION_STATUS.COMPLETADO;
}

export function orderHasLinkedRa(order: CollectionOrder): boolean {
  return (order.linkedRaNumbers ?? []).some((ra) => String(ra ?? "").trim().length > 0);
}

/**
 * Órdenes de clientes sin inventario que ya llegaron a bodega.
 * No incluye las que siguen en recepción: el recepcionista las maneja
 * en «En recepción» como cualquier otra.
 */
export function isNoInventoryWarehouseOrder(order: CollectionOrder): boolean {
  return (
    isOrderWithoutInventory(order) &&
    isOrderInWarehouse(order) &&
    !orderHasLinkedRa(order)
  );
}

export function ordersForCollectionListTab(
  orders: CollectionOrder[],
  tab: CollectionOrderListTab,
): CollectionOrder[] {
  if (tab === "noInventory") {
    return orders.filter(isNoInventoryWarehouseOrder);
  }
  if (tab === "linkedRa") {
    return orders.filter(orderHasLinkedRa);
  }
  if (tab === "warehouse") {
    return orders.filter(
      (o) =>
        isOrderInWarehouse(o) && !orderHasLinkedRa(o) && !isOrderWithoutInventory(o),
    );
  }
  // En recepción: todas las pendientes de llegada / en proceso, incluidos
  // clientes sin inventario (aún no van a «Sin inventario»).
  return orders.filter((o) => !isOrderInWarehouse(o) && !orderHasLinkedRa(o));
}

export function countOrdersForCollectionListTab(
  orders: CollectionOrder[],
  tab: CollectionOrderListTab,
): number {
  return ordersForCollectionListTab(orders, tab).length;
}
