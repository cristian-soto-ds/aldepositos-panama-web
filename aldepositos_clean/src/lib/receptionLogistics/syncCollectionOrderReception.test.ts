import { describe, expect, it } from "vitest";
import {
  RECEPTION_STATUS,
  compareReceptionQueue,
} from "@/lib/receptionLogistics/config";
import {
  applyPartialDeliveryToOrder,
  buildGroupReceptionTruck,
  closePartialDelivery,
  collectionOrderToReceptionTruck,
  mergeCollectionOrdersIntoTrucks,
  orderHasOpenPartialDelivery,
  orderPendingBultos,
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
      { numero: "1", bultos: 10, cliente: "AAA" },
      { numero: "2", bultos: 15, cliente: "AAA" },
    ]);
  });

  it("buildGroupReceptionTruck incluye consignatario por OR", () => {
    const orders = [
      makeOrder({
        id: "a",
        numero: "3986",
        cliente: "PONCHO",
        expectedBultos: 12,
        receptionStatus: RECEPTION_STATUS.EN_FILA,
        receptionGroupId: "or-grp-cons",
      }),
      makeOrder({
        id: "b",
        numero: "3981",
        cliente: "RED",
        expectedBultos: 4,
        receptionStatus: RECEPTION_STATUS.EN_FILA,
        receptionGroupId: "or-grp-cons",
      }),
    ];
    const truck = buildGroupReceptionTruck(orders, null, {
      groupId: "or-grp-cons",
    });
    expect(truck?.orderLines).toEqual([
      { numero: "3986", bultos: 12, cliente: "PONCHO" },
      { numero: "3981", bultos: 4, cliente: "RED" },
    ]);
  });

  it("FIFO: camión unificado antes que OR suelta posterior", () => {
    const groupId = "or-grp-fifo";
    const tGroup = "2026-08-05T10:00:00.000Z";
    const tSolo = "2026-08-05T10:05:00.000Z";
    const orders = [
      makeOrder({
        id: "solo3",
        numero: "3",
        receptionStatus: RECEPTION_STATUS.EN_FILA,
        receptionQueuedAt: tSolo,
        // updatedAt más viejo a propósito — no debe ganar al orden de fila
        updatedAt: "2026-08-01T08:00:00.000Z",
        createdAt: "2026-08-01T08:00:00.000Z",
      }),
      makeOrder({
        id: "a",
        numero: "1",
        receptionStatus: RECEPTION_STATUS.EN_FILA,
        receptionGroupId: groupId,
        receptionQueuedAt: tGroup,
        updatedAt: "2026-08-05T12:00:00.000Z",
        createdAt: "2026-08-01T09:00:00.000Z",
      }),
      makeOrder({
        id: "b",
        numero: "2",
        receptionStatus: RECEPTION_STATUS.EN_FILA,
        receptionGroupId: groupId,
        receptionQueuedAt: tGroup,
        updatedAt: "2026-08-05T12:00:00.000Z",
        createdAt: "2026-08-01T09:00:00.000Z",
      }),
    ];
    const merged = mergeCollectionOrdersIntoTrucks([], orders);
    const sorted = [...merged].sort((a, b) => a.sortOrder - b.sortOrder);
    expect(sorted).toHaveLength(2);
    expect(sorted[0]!.id).toBe(groupId);
    expect(sorted[1]!.id).toBe("or-co-solo3");
    expect(sorted[0]!.sortOrder).toBe(Date.parse(tGroup));
    expect(sorted[1]!.sortOrder).toBe(Date.parse(tSolo));
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

  it("keeps the truck column while OR rows are still on the previous status", () => {
    const groupId = "or-grp-ahead";
    const orders = [
      makeOrder({
        id: "a",
        numero: "1",
        receptionStatus: RECEPTION_STATUS.EN_FILA,
        receptionGroupId: groupId,
        updatedAt: "2026-08-05T10:00:00.000Z",
      }),
      makeOrder({
        id: "b",
        numero: "2",
        receptionStatus: RECEPTION_STATUS.EN_FILA,
        receptionGroupId: groupId,
        updatedAt: "2026-08-05T10:00:00.000Z",
      }),
    ];
    const existing: ReceptionTruck = {
      id: groupId,
      plate: "PROV X",
      provider: "PROV X",
      client: "AAA",
      ra: "GRP-2",
      expectedBultos: 20,
      status: RECEPTION_STATUS.RAMPA_1,
      sortOrder: Date.parse("2026-08-05T10:00:00.000Z"),
      source: "collection_order",
      rampAssignedAt: "2026-08-05T10:00:05.000Z",
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-05T10:00:05.000Z",
    };
    const merged = mergeCollectionOrdersIntoTrucks([existing], orders);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.status).toBe(RECEPTION_STATUS.RAMPA_1);
    expect(merged[0]!.updatedAt).toBe("2026-08-05T10:00:05.000Z");
  });

  it("follows the OR once it is newer than the truck", () => {
    const existing: ReceptionTruck = {
      id: "or-co-solo",
      plate: "PROV X",
      provider: "PROV X",
      client: "AAA",
      ra: "OR-9",
      expectedBultos: 10,
      status: RECEPTION_STATUS.RAMPA_1,
      sortOrder: 1,
      collectionOrderId: "solo",
      source: "collection_order",
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-05T10:00:05.000Z",
    };
    const orders = [
      makeOrder({
        id: "solo",
        numero: "9",
        receptionStatus: RECEPTION_STATUS.RAMPA_2,
        updatedAt: "2026-08-05T10:00:08.000Z",
      }),
    ];
    const merged = mergeCollectionOrdersIntoTrucks([existing], orders);
    expect(merged[0]!.status).toBe(RECEPTION_STATUS.RAMPA_2);
  });
});

describe("reception priority", () => {
  it("prioridad va primero en la fila aunque haya llegado después", () => {
    const orders = [
      makeOrder({
        id: "early",
        numero: "1",
        receptionStatus: RECEPTION_STATUS.EN_FILA,
        receptionQueuedAt: "2026-08-05T08:00:00.000Z",
      }),
      makeOrder({
        id: "vip",
        numero: "2",
        receptionStatus: RECEPTION_STATUS.EN_FILA,
        receptionQueuedAt: "2026-08-05T11:00:00.000Z",
        receptionPriority: true,
        receptionPriorityAt: "2026-08-05T11:01:00.000Z",
      }),
      makeOrder({
        id: "mid",
        numero: "3",
        receptionStatus: RECEPTION_STATUS.EN_FILA,
        receptionQueuedAt: "2026-08-05T09:00:00.000Z",
      }),
    ];
    const sorted = mergeCollectionOrdersIntoTrucks([], orders).sort(
      compareReceptionQueue,
    );
    expect(sorted.map((t) => t.id)).toEqual([
      "or-co-vip",
      "or-co-early",
      "or-co-mid",
    ]);
    expect(sorted[0]!.priority).toBe(true);
    expect(sorted[1]!.priority).toBeUndefined();
  });

  it("varias prioridades: la marcada antes va primero", () => {
    const a = {
      priority: true,
      priorityAt: "2026-08-05T10:30:00.000Z",
      sortOrder: 1,
    };
    const b = {
      priority: true,
      priorityAt: "2026-08-05T10:00:00.000Z",
      sortOrder: 2,
    };
    expect([a, b].sort(compareReceptionQueue)[0]).toBe(b);
  });

  it("camión agrupado es prioridad si alguna de sus OR lo es", () => {
    const orders = [
      makeOrder({
        id: "a",
        numero: "1",
        receptionStatus: RECEPTION_STATUS.EN_FILA,
        receptionGroupId: "or-grp-prio",
      }),
      makeOrder({
        id: "b",
        numero: "2",
        receptionStatus: RECEPTION_STATUS.EN_FILA,
        receptionGroupId: "or-grp-prio",
        receptionPriority: true,
        receptionPriorityAt: "2026-08-05T10:00:00.000Z",
      }),
    ];
    const truck = buildGroupReceptionTruck(orders, null, {
      groupId: "or-grp-prio",
    });
    expect(truck?.priority).toBe(true);
    expect(truck?.priorityAt).toBe("2026-08-05T10:00:00.000Z");
  });
});

describe("reception partial delivery", () => {
  const now1 = "2026-08-05T10:00:00.000Z";
  const now2 = "2026-08-05T15:00:00.000Z";

  it("100 esperados, llegan 80: faltan 20", () => {
    const order = makeOrder({
      id: "p",
      numero: "77",
      expectedBultos: 100,
      receptionStatus: RECEPTION_STATUS.RAMPA_1,
    });
    const { order: next, completed } = applyPartialDeliveryToOrder(
      order,
      80,
      now1,
    );
    expect(completed).toBe(false);
    expect(next.receptionReceivedBultos).toBe(80);
    expect(orderHasOpenPartialDelivery(next)).toBe(true);
    expect(orderPendingBultos(next)).toBe(20);

    const truck = collectionOrderToReceptionTruck({
      ...next,
      receptionStatus: RECEPTION_STATUS.PARCIAL,
    });
    expect(truck?.expectedBultos).toBe(20);
    expect(truck?.receivedBultos).toBe(80);
    expect(truck?.totalBultos).toBe(100);
    expect(truck?.orderLines?.[0]?.bultos).toBe(20);
  });

  it("dos parciales se acumulan y la segunda completa el total", () => {
    const order = makeOrder({
      id: "p",
      expectedBultos: 100,
      receptionStatus: RECEPTION_STATUS.EN_FILA,
    });
    const first = applyPartialDeliveryToOrder(order, 60, now1);
    expect(first.completed).toBe(false);
    expect(orderPendingBultos(first.order)).toBe(40);

    const second = applyPartialDeliveryToOrder(first.order, 25, now2);
    expect(second.completed).toBe(false);
    expect(second.order.receptionReceivedBultos).toBe(85);
    expect(orderPendingBultos(second.order)).toBe(15);
    expect(second.order.receptionPartialHistory).toEqual([
      { at: now1, bultos: 60 },
      { at: now2, bultos: 25 },
    ]);

    const third = applyPartialDeliveryToOrder(second.order, 50, now2);
    expect(third.completed).toBe(true);
    expect(third.order.receptionReceivedBultos).toBe(100);
    expect(orderHasOpenPartialDelivery(third.order)).toBe(false);
  });

  it("rechaza cantidades inválidas", () => {
    const order = makeOrder({ id: "p", expectedBultos: 10 });
    expect(() => applyPartialDeliveryToOrder(order, 0, now1)).toThrow();
    expect(() =>
      applyPartialDeliveryToOrder(
        makeOrder({ id: "z", lines: [] }),
        5,
        now1,
      ),
    ).toThrow();
  });

  it("al marcar Listo se cierra la parcial y la tarjeta vuelve al total", () => {
    const order = makeOrder({
      id: "p",
      expectedBultos: 100,
      receptionStatus: RECEPTION_STATUS.EN_FILA,
    });
    const partial = applyPartialDeliveryToOrder(order, 80, now1).order;
    const closed = closePartialDelivery({
      ...partial,
      receptionStatus: RECEPTION_STATUS.COMPLETADO,
    });
    expect(closed.receptionReceivedBultos).toBe(100);
    expect(orderHasOpenPartialDelivery(closed)).toBe(false);

    const truck = collectionOrderToReceptionTruck(closed);
    expect(truck?.expectedBultos).toBe(100);
    expect(truck?.receivedBultos).toBeUndefined();
    expect(truck?.totalBultos).toBeUndefined();
  });

  it("en grupo, la tarjeta suma recibido/total solo si hay parcial abierta", () => {
    const orders = [
      makeOrder({
        id: "a",
        numero: "1",
        expectedBultos: 50,
        receptionStatus: RECEPTION_STATUS.EN_FILA,
        receptionGroupId: "or-grp-part",
        receptionReceivedBultos: 30,
      }),
      makeOrder({
        id: "b",
        numero: "2",
        expectedBultos: 20,
        receptionStatus: RECEPTION_STATUS.EN_FILA,
        receptionGroupId: "or-grp-part",
      }),
    ];
    const truck = buildGroupReceptionTruck(orders, null, {
      groupId: "or-grp-part",
    });
    expect(truck?.expectedBultos).toBe(40);
    expect(truck?.receivedBultos).toBe(30);
    expect(truck?.totalBultos).toBe(70);
  });
});
