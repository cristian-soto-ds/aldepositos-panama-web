import { describe, expect, it } from "vitest";
import { RECEPTION_STATUS } from "@/lib/receptionLogistics/config";
import {
  buildGroupReceptionTruck,
  mergeCollectionOrdersIntoTrucks,
  receptionOrderIds,
} from "@/lib/receptionLogistics/syncCollectionOrderReception";
import type { CollectionOrder } from "@/lib/types/collectionOrder";
import type { ReceptionTruck } from "@/lib/receptionLogistics/types";

function makeOrder(
  partial: Partial<CollectionOrder> & { id: string },
): CollectionOrder {
  return {
    cliente: "AAA",
    proveedor: "PROV X",
    lines: [{ id: "l1", bultos: 10 }],
    status: "sent",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...partial,
  };
}

describe("reception OR truck grouping", () => {
  it("merge builds one truck for same receptionGroupId", () => {
    const groupId = "or-grp-test-1";
    const orders = [
      makeOrder({
        id: "a",
        numero: "100",
        expectedBultos: 20,
        receptionStatus: RECEPTION_STATUS.EN_FILA,
        receptionGroupId: groupId,
      }),
      makeOrder({
        id: "b",
        numero: "101",
        expectedBultos: 30,
        receptionStatus: RECEPTION_STATUS.EN_FILA,
        receptionGroupId: groupId,
      }),
    ];

    const merged = mergeCollectionOrdersIntoTrucks([], orders);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe(groupId);
    expect(receptionOrderIds(merged[0]!)).toEqual(["a", "b"]);
    expect(merged[0]!.expectedBultos).toBe(50);
    expect(merged[0]!.orderNumeros).toEqual(["100", "101"]);
  });

  it("merge keeps single OR without group as or-co card", () => {
    const orders = [
      makeOrder({
        id: "solo",
        numero: "55",
        receptionStatus: RECEPTION_STATUS.EN_FILA,
      }),
    ];
    const merged = mergeCollectionOrdersIntoTrucks([], orders);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.id).toBe("or-co-solo");
    expect(merged[0]!.provider).toBe("PROV X");
    expect(merged[0]!.orderLines?.[0]?.numero).toBe("55");
  });

  it("buildGroupReceptionTruck titles with provider", () => {
    const orders = [
      makeOrder({
        id: "a",
        numero: "1",
        proveedor: "KING CARGO",
        receptionStatus: RECEPTION_STATUS.EN_FILA,
        receptionGroupId: "or-grp-x",
      }),
      makeOrder({
        id: "b",
        numero: "2",
        proveedor: "KING CARGO",
        expectedBultos: 15,
        receptionStatus: RECEPTION_STATUS.EN_FILA,
        receptionGroupId: "or-grp-x",
      }),
    ];
    const truck = buildGroupReceptionTruck(orders, null, {
      groupId: "or-grp-x",
    });
    expect(truck?.plate).toBe("KING CARGO");
    expect(truck?.provider).toBe("KING CARGO");
    expect(truck?.orderLines).toEqual([
      { numero: "1", bultos: 10 },
      { numero: "2", bultos: 15 },
    ]);
  });

  it("merge preserves manual import trucks", () => {
    const manual: ReceptionTruck = {
      id: "manual-1",
      plate: "XYZ",
      provider: "P",
      client: "C",
      ra: "R",
      expectedBultos: 5,
      status: RECEPTION_STATUS.EN_FILA,
      sortOrder: Date.now(),
      source: "import",
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
    };
    const orders = [
      makeOrder({
        id: "solo",
        numero: "9",
        receptionStatus: RECEPTION_STATUS.RAMPA_1,
      }),
    ];
    const merged = mergeCollectionOrdersIntoTrucks([manual], orders);
    expect(merged.some((t) => t.id === "manual-1")).toBe(true);
    expect(merged.some((t) => t.id === "or-co-solo")).toBe(true);
  });
});
