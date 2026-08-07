import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/types/task";
import {
  measureRowKey,
  sanitizeWarehouseBultosMap,
  splitInventoryPartial,
} from "@/lib/inventoryPartialSplit";

function baseTask(rows: Record<string, unknown>[]): Task {
  return {
    id: "t1",
    ra: "64671",
    mainClient: "LOGI",
    provider: "JEANCENTER",
    subClient: "",
    brand: "EDDY",
    expectedBultos: 18,
    originalExpectedBultos: 18,
    expectedCbm: 1.89,
    expectedWeight: 600.5,
    notes: "",
    currentBultos: 18,
    status: "completed",
    measureData: rows,
    weightMode: "per_bundle",
    manualTotalWeight: 0,
    type: "quick",
    referenceMode: "with",
  };
}

describe("inventoryPartialSplit", () => {
  it("parte bultos: almacén + cargado = original", () => {
    const task = baseTask([
      { id: "a", referencia: "05135-67851", bultos: 2, l: 40, w: 30, h: 20, weight: 10 },
      { id: "b", referencia: "05133-07951", bultos: 1, l: 40, w: 30, h: 20, weight: 12 },
    ]);
    const map = sanitizeWarehouseBultosMap(task, { a: 1, b: 1 });
    const split = splitInventoryPartial(task, map);

    expect(split.warehouseTotals.bultos).toBe(2);
    expect(split.loadedTotals.bultos).toBe(1);
    expect(split.fullTotals.bultos).toBe(3);
    expect(split.warehouseRows).toHaveLength(2);
    expect(split.loadedRows).toHaveLength(1);
    expect(split.loadedRows[0]?.id).toBe("a");
    expect(Number(split.loadedRows[0]?.bultos)).toBe(1);
  });

  it("si no marca almacén, todo va al contenedor", () => {
    const task = baseTask([
      { id: "a", referencia: "X", bultos: 5, weight: 8 },
    ]);
    const split = splitInventoryPartial(task, {});
    expect(split.warehouseTotals.bultos).toBe(0);
    expect(split.loadedTotals.bultos).toBe(5);
  });

  it("measureRowKey usa id o índice", () => {
    expect(measureRowKey({ id: "r1" }, 0)).toBe("r1");
    expect(measureRowKey({}, 3)).toBe("idx:3");
  });
});
