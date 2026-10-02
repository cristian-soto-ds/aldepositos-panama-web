import { describe, expect, it } from "vitest";
import {
  forgetDeletedCollectionOrder,
  mergeCollectionOrdersSnapshot,
  pickCollectionOrderListOwnedFields,
  rememberDeletedCollectionOrder,
} from "@/lib/collectionOrders";
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

const startedAt = Date.parse("2026-10-01T21:05:58.000Z");
const noTouch = () => false;

describe("mergeCollectionOrdersSnapshot", () => {
  it("no resucita OR borradas mientras el reload estaba en curso", () => {
    rememberDeletedCollectionOrder("del-1");
    try {
      const merged = mergeCollectionOrdersSnapshot({
        prev: [stubOrder({ id: "keep", numero: "1" })],
        snapshot: [
          stubOrder({ id: "keep", numero: "1" }),
          stubOrder({ id: "del-1", numero: "2" }),
        ],
        snapshotStartedAt: startedAt,
        touchedSince: noTouch,
      });
      expect(merged.map((o) => o.id)).toEqual(["keep"]);
    } finally {
      forgetDeletedCollectionOrder("del-1");
    }
  });

  it("conserva Sin inventario marcado después de que arrancó el reload", () => {
    const local = stubOrder({
      id: "a",
      numero: "6077",
      sinInventario: true,
      updatedAt: "2026-10-01T21:06:30.000Z",
    });
    const stale = stubOrder({
      id: "a",
      numero: "6077",
      updatedAt: "2026-10-01T20:00:00.000Z",
    });
    const merged = mergeCollectionOrdersSnapshot({
      prev: [local],
      snapshot: [stale],
      snapshotStartedAt: startedAt,
      touchedSince: noTouch,
    });
    expect(merged[0]?.sinInventario).toBe(true);
  });

  it("aplica el snapshot cuando la copia local es vieja", () => {
    const local = stubOrder({ id: "a", numero: "1", cliente: "VIEJO" });
    const remote = stubOrder({
      id: "a",
      numero: "1",
      cliente: "NUEVO",
      updatedAt: "2026-10-01T21:00:00.000Z",
    });
    const merged = mergeCollectionOrdersSnapshot({
      prev: [local],
      snapshot: [remote],
      snapshotStartedAt: startedAt,
      touchedSince: noTouch,
    });
    expect(merged[0]?.cliente).toBe("NUEVO");
  });

  it("no revive una OR borrada por realtime durante el reload", () => {
    const merged = mergeCollectionOrdersSnapshot({
      prev: [],
      snapshot: [stubOrder({ id: "gone", numero: "9" })],
      snapshotStartedAt: startedAt,
      touchedSince: (id) => id === "gone",
    });
    expect(merged).toEqual([]);
  });

  it("quita de la lista OR viejas que ya no están en BD", () => {
    const merged = mergeCollectionOrdersSnapshot({
      prev: [stubOrder({ id: "old", numero: "3" })],
      snapshot: [],
      snapshotStartedAt: startedAt,
      touchedSince: noTouch,
    });
    expect(merged).toEqual([]);
  });
});

describe("pickCollectionOrderListOwnedFields", () => {
  it("toma Sin inventario y recepción de la lista, no del editor", () => {
    const editor = stubOrder({ id: "a", numero: "1", cliente: "EDIT" });
    const list = stubOrder({
      id: "a",
      numero: "1",
      sinInventario: true,
      receptionStatus: "COMPLETADO" as CollectionOrder["receptionStatus"],
    });
    const payload = { ...editor, ...pickCollectionOrderListOwnedFields(list) };
    expect(payload.cliente).toBe("EDIT");
    expect(payload.sinInventario).toBe(true);
    expect(payload.receptionStatus).toBe("COMPLETADO");
  });
});
