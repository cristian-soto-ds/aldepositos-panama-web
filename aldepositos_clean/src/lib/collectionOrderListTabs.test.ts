import { describe, expect, it } from "vitest";
import type { CollectionOrder } from "@/lib/types/collectionOrder";
import { RECEPTION_STATUS } from "@/lib/receptionLogistics/config";
import {
  isOrderWithoutInventory,
  ordersForCollectionListTab,
} from "@/lib/collectionOrderListTabs";

function order(
  id: string,
  cliente: string,
  opts: {
    proveedor?: string;
    marca?: string;
    linkedRaNumbers?: string[];
    receptionStatus?: CollectionOrder["receptionStatus"];
    sinInventario?: boolean;
  } = {},
): CollectionOrder {
  return {
    id,
    cliente,
    proveedor: opts.proveedor ?? "",
    marca: opts.marca,
    lines: [],
    status: "draft",
    linkedRaNumbers: opts.linkedRaNumbers ?? [],
    receptionStatus: opts.receptionStatus,
    sinInventario: opts.sinInventario,
    createdAt: "",
    updatedAt: "",
  };
}

describe("pestaña de órdenes sin inventario", () => {
  it.each([
    "ROCA LOGISTIC S,A",
    "Roca Logistic S.A.",
    "70",
    "X10",
    "PM CARGO",
    "KEIKO Y CITRUS",
    "MARIO ABAD",
  ])("reconoce %s ignorando mayúsculas y puntuación", (name) => {
    expect(isOrderWithoutInventory(order("1", name))).toBe(true);
  });

  it("reconoce el nombre tanto en cliente como en proveedor", () => {
    expect(isOrderWithoutInventory(order("1", "Otro", { proveedor: "PM CARGO" }))).toBe(
      true,
    );
  });

  it("reconoce el nombre en marca (número de seguimiento)", () => {
    expect(
      isOrderWithoutInventory(order("1", "Otro cliente", { marca: "X10" })),
    ).toBe(true);
  });

  it("deja en recepción las órdenes sin inventario que aún no llegaron", () => {
    const pending = order("pending", "ROCA LOGISTIC S.A");
    const inReception = order("fila", "70", {
      receptionStatus: RECEPTION_STATUS.EN_FILA,
    });
    const orders = [pending, inReception];

    expect(ordersForCollectionListTab(orders, "general").map((o) => o.id)).toEqual([
      "pending",
      "fila",
    ]);
    expect(ordersForCollectionListTab(orders, "noInventory")).toEqual([]);
  });

  it("mueve a Sin inventario solo cuando ya están en bodega", () => {
    const warehouseNoInv = order("warehouse-ni", "ROCA LOGISTIC S.A", {
      receptionStatus: RECEPTION_STATUS.COMPLETADO,
    });
    const warehouseNormal = order("warehouse-ok", "Cliente normal", {
      receptionStatus: RECEPTION_STATUS.COMPLETADO,
    });
    const withRa = order("with-ra", "PM CARGO", {
      receptionStatus: RECEPTION_STATUS.COMPLETADO,
      linkedRaNumbers: ["RA-10"],
    });
    const orders = [warehouseNoInv, warehouseNormal, withRa];

    expect(ordersForCollectionListTab(orders, "noInventory").map((o) => o.id)).toEqual([
      "warehouse-ni",
    ]);
    expect(ordersForCollectionListTab(orders, "warehouse").map((o) => o.id)).toEqual([
      "warehouse-ok",
    ]);
    expect(ordersForCollectionListTab(orders, "linkedRa").map((o) => o.id)).toEqual([
      "with-ra",
    ]);
  });

  it("respeta el flag manual sinInventario", () => {
    const flagged = order("manual", "Cliente normal", {
      receptionStatus: RECEPTION_STATUS.COMPLETADO,
      sinInventario: true,
    });
    expect(isOrderWithoutInventory(flagged)).toBe(true);
    expect(ordersForCollectionListTab([flagged], "noInventory").map((o) => o.id)).toEqual([
      "manual",
    ]);
    expect(ordersForCollectionListTab([flagged], "warehouse")).toEqual([]);
  });
});
