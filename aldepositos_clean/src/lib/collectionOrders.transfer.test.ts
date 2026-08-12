import { describe, expect, it } from "vitest";
import {
  clearRaAfterCollectionUnlink,
  collectionOrderTransferBlockedReason,
  findOtherOrderWithNumero,
  findTasksLinkedToCollectionOrder,
  isCollectionOrderInBodega,
  unlinkCollectionOrderFromRas,
} from "@/lib/collectionOrders";
import { RECEPTION_STATUS } from "@/lib/receptionLogistics/config";
import type { CollectionOrder } from "@/lib/types/collectionOrder";
import type { Task } from "@/lib/types/task";

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

function stubTask(partial: Partial<Task> & Pick<Task, "id" | "ra">): Task {
  return {
    mainClient: "",
    provider: "",
    subClient: "",
    brand: "",
    expectedBultos: 0,
    originalExpectedBultos: 0,
    expectedCbm: 0,
    expectedWeight: 0,
    notes: "",
    currentBultos: 10,
    status: "pending",
    measureData: [{ id: "1", referencia: "X" }],
    weightMode: "auto",
    manualTotalWeight: 0,
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

describe("unlinkCollectionOrderFromRas", () => {
  it("limpia el RA y saca el vínculo de la OR", () => {
    const order = stubOrder({
      id: "or1",
      numero: "100",
      linkedRaNumbers: ["64786"],
      receptionStatus: RECEPTION_STATUS.COMPLETADO,
      status: "sent",
    });
    const task = stubTask({
      id: "t1",
      ra: "64786",
      linkedCollectionOrderId: "or1",
      currentBultos: 53,
      rowCount: 2,
      completeRowCount: 1,
      capturedWeight: 12,
    });

    expect(findTasksLinkedToCollectionOrder([task], order)).toHaveLength(1);

    const result = unlinkCollectionOrderFromRas({
      order,
      tasks: [task],
    });

    expect(result.order.linkedRaNumbers).toEqual([]);
    expect(result.blockedCompleted).toEqual([]);
    expect(result.clearedTasks).toHaveLength(1);
    expect(result.clearedTasks[0]!.linkedCollectionOrderId).toBeUndefined();
    expect(result.clearedTasks[0]!.measureData).toEqual([]);
    expect(result.clearedTasks[0]!.currentBultos).toBe(0);
    expect(result.clearedTasks[0]!.rowCount).toBe(0);
    expect(result.clearedTasks[0]!.ra).toBe("64786");
    expect(result.clearedTasks[0]!.provider).toBe("");
    expect(result.clearedTasks[0]!.expectedBultos).toBe(0);
  });

  it("no limpia un RA completado", () => {
    const order = stubOrder({
      id: "or1",
      numero: "100",
      linkedRaNumbers: ["1"],
    });
    const task = stubTask({
      id: "t1",
      ra: "1",
      linkedCollectionOrderId: "or1",
      status: "completed",
    });
    const result = unlinkCollectionOrderFromRas({ order, tasks: [task] });
    expect(result.clearedTasks).toHaveLength(0);
    expect(result.blockedCompleted).toHaveLength(1);
    expect(result.order.linkedRaNumbers).toEqual(["1"]);
  });

  it("clearRaAfterCollectionUnlink deja solo el número de RA", () => {
    const cleared = clearRaAfterCollectionUnlink(
      stubTask({
        id: "t",
        ra: "PRUEBA",
        linkedCollectionOrderId: "or",
        mainClient: "CLI",
        provider: "32",
        brand: "132",
        expectedBultos: 32,
        originalExpectedBultos: 32,
        expectedWeight: 32,
        expectedCbm: 323,
        measureData: [{ id: "a", referencia: "2", bultos: "1" }],
        currentBultos: 4,
        rowCount: 4,
      }),
    );
    expect(cleared.ra).toBe("PRUEBA");
    expect(cleared.id).toBe("t");
    expect(cleared.linkedCollectionOrderId).toBeUndefined();
    expect(cleared.measureData).toEqual([]);
    expect(cleared.provider).toBe("");
    expect(cleared.brand).toBe("");
    expect(cleared.mainClient).toBe("");
    expect(cleared.expectedBultos).toBe(0);
    expect(cleared.expectedWeight).toBe(0);
    expect(cleared.currentBultos).toBe(0);
    expect(cleared.rowCount).toBe(0);
  });
});
