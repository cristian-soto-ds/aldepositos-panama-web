import { describe, expect, it } from "vitest";
import {
  collectionOrderTransferBlockedReason,
  findOtherOrderWithNumero,
  isCollectionOrderInBodega,
} from "@/lib/collectionOrders";
import { RECEPTION_STATUS } from "@/lib/receptionLogistics/config";
import type { CollectionOrder } from "@/lib/types/collectionOrder";

function stubOrder(
  partial: Partial<CollectionOrder> & Pick<CollectionOrder, "id" | "numero">,
): CollectionOrder {
  return {
    cliente: "AAA",
    proveedor: "Prov",
    lines: [],
    status: "draft",
    linkedRaNumbers: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("collection order uniqueness and transfer gate", () => {
  it("detecta otro OR con el mismo número normalizado", () => {
    const orders = [
      stubOrder({ id: "a", numero: "3759" }),
      stubOrder({ id: "b", numero: " 3759 " }),
    ];
    expect(findOtherOrderWithNumero(orders, "3759", "a")?.id).toBe("b");
    expect(findOtherOrderWithNumero(orders, "3759", "b")?.id).toBe("a");
    expect(findOtherOrderWithNumero(orders, "9999")).toBeUndefined();
  });

  it("solo permite transferir en bodega (COMPLETADO)", () => {
    const enFila = stubOrder({
      id: "1",
      numero: "1",
      receptionStatus: RECEPTION_STATUS.EN_FILA,
    });
    const bodega = stubOrder({
      id: "2",
      numero: "2",
      receptionStatus: RECEPTION_STATUS.COMPLETADO,
    });
    expect(isCollectionOrderInBodega(enFila)).toBe(false);
    expect(collectionOrderTransferBlockedReason(enFila)).toMatch(/bodega/i);
    expect(isCollectionOrderInBodega(bodega)).toBe(true);
    expect(collectionOrderTransferBlockedReason(bodega)).toBeNull();
  });
});
