import { describe, expect, it } from "vitest";
import {
  buildTasksByRa,
  compareContainerLoadWorkOrder,
  describeRaConflicts,
  findRaConflicts,
  inventoryTabForTask,
  raKeysInOpenContainerLoads,
  summarizeContainerLoad,
  taskIsInOpenContainerLoad,
} from "@/lib/containerLoadStatus";
import { parseContainerLoadGrid } from "@/lib/parseContainerLoadExcel";
import { sanitizeContainerLoadItems } from "@/lib/containerLoadItems";
import type { ContainerLoad } from "@/lib/types/containerLoad";
import type { Task } from "@/lib/types/task";

function task(ra: string, status: string, currentBultos = 0): Task {
  return { id: `t-${ra}`, ra, status, currentBultos } as Task;
}

function load(status: "open" | "closed", ras: string[]): ContainerLoad {
  return {
    id: `l-${status}`,
    name: "CONSOLIDADO 86 LG",
    status,
    sourceFileName: null,
    items: ras.map((ra, i) => ({ position: i + 1, ra, bultos: 10, cbm: 1, peso: 5 })),
    sortOrder: 0,
    createdByEmail: null,
    createdAt: "",
    updatedAt: "",
    closedAt: null,
  };
}

describe("summarizeContainerLoad", () => {
  it("calcula estados, siguiente RA y totales en orden de cargue", () => {
    const tasks = [
      task("RA 100", "completed", 10),
      task("101", "pending"),
      task("102", "in_progress", 3),
      task("103", "rectification", 4),
    ];
    const s = summarizeContainerLoad(
      load("open", ["100", "101", "102", "103", "999"]),
      buildTasksByRa(tasks),
    );
    expect(s.rows.map((r) => r.state)).toEqual([
      "completed",
      "pending",
      "in_progress",
      "rectification",
      "missing",
    ]);
    expect(s.nextRa).toBe("101");
    expect(s.rows[1]!.isNext).toBe(true);
    expect(s.rectification).toBe(1);
    expect(s.notInventoried).toBe(4);
    expect(s.totals).toMatchObject({ bultos: 50, cbm: 5, peso: 25, capturedBultos: 17 });
  });

  it("los RA marcados sin inventario cuentan como listos y no son el siguiente", () => {
    const base = load("open", ["66954", "200", "201"]);
    const marked: ContainerLoad = {
      ...base,
      items: base.items.map((it) =>
        it.ra === "66954" || it.ra === "200"
          ? { ...it, noInventoryRequired: true, noInventoryReason: "Solo RA, sin OR" }
          : it,
      ),
    };
    const s = summarizeContainerLoad(
      marked,
      buildTasksByRa([task("200", "pending"), task("201", "pending")]),
    );
    expect(s.rows.map((r) => r.state)).toEqual(["not_required", "not_required", "pending"]);
    expect(s.notRequired).toBe(2);
    expect(s.ready).toBe(2);
    expect(s.notInventoried).toBe(1);
    expect(s.nextRa).toBe("201");
  });
});

describe("sanitizeContainerLoadItems", () => {
  it("conserva la marca sin inventario", () => {
    const [it] = sanitizeContainerLoadItems([
      { ra: "RA 66954", position: 1, noInventoryRequired: true, noInventoryReason: "Sin OR" },
    ]);
    expect(it).toMatchObject({ ra: "66954", noInventoryRequired: true, noInventoryReason: "Sin OR" });
  });
});

describe("flujo Excel → cargue → cierre", () => {
  it("ordena el cargue, marca estados y al cerrar devuelve los RA a las listas", () => {
    const parsed = parseContainerLoadGrid([
      ["", "", "INSTRUCCIÓN CARGUE CONSOLIDADO 86 LG"],
      ["Número", "Nombre Proveedor", "BULTOS", "PESO", "INSTRUCCIÓN"],
      ["67070", "DELTA FASHION", "117", "10", "2"],
      ["67072", "ILUMINACIONES", "14", "5", "1"],
      ["67999", "NO EXISTE", "3", "1", "3"],
      ["", "", "134", "16", ""],
    ]);
    const tasks = [task("67070", "pending"), task("67072", "completed", 14)];
    const open: ContainerLoad = {
      ...load("open", []),
      name: parsed.suggestedName,
      items: parsed.items,
    };
    const s = summarizeContainerLoad(open, buildTasksByRa(tasks));
    expect(s.load.name).toBe("CONSOLIDADO 86 LG");
    expect(s.rows.map((r) => [r.item.ra, r.state])).toEqual([
      ["67072", "completed"],
      ["67070", "pending"],
      ["67999", "missing"],
    ]);
    expect(s.nextRa).toBe("67070");
    expect(s.notInventoried).toBe(2);

    const openKeys = raKeysInOpenContainerLoads([open]);
    expect(taskIsInOpenContainerLoad(tasks[0]!, openKeys)).toBe(true);
    const closedKeys = raKeysInOpenContainerLoads([{ ...open, status: "closed" }]);
    expect(taskIsInOpenContainerLoad(tasks[0]!, closedKeys)).toBe(false);
  });
});

describe("compareContainerLoadWorkOrder", () => {
  it("ordena por sortOrder y desempata por fecha", () => {
    const mk = (id: string, sortOrder: number, createdAt: string) => ({
      ...load("open", []),
      id,
      sortOrder,
      createdAt,
    });
    const sorted = [
      mk("c", 2, "2026-01-01"),
      mk("a", 1, "2026-03-01"),
      mk("b", 2, "2025-12-01"),
    ].sort(compareContainerLoadWorkOrder);
    expect(sorted.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });
});

describe("findRaConflicts", () => {
  it("detecta RA en otro cargue abierto, ignora cerrados y el cargue excluido", () => {
    const a = { ...load("open", ["100", "101"]), id: "a", name: "LG-232" };
    const b = { ...load("closed", ["200"]), id: "b", name: "VIEJO" };
    const c = { ...load("open", ["300"]), id: "c", name: "DO-02" };
    const conflicts = findRaConflicts([a, b, c], ["RA 100", "200", "300", "999"], "c");
    expect([...conflicts]).toEqual([["100", "LG-232"]]);
    expect(describeRaConflicts(conflicts)).toBe("RA 100 (en «LG-232»)");
  });
});

describe("inventoryTabForTask", () => {
  it("un cargue abierto saca el RA de todas las pestañas", () => {
    const keys = raKeysInOpenContainerLoads([load("open", ["1", "2", "3", "4"])]);
    const inLoad = [
      task("1", "completed"),
      task("2", "rectification"),
      { ...task("3", "pending"), containerDraft: true } as Task,
      task("4", "in_progress"),
    ];
    for (const t of inLoad) {
      expect(inventoryTabForTask(t, keys)).toBe("containerLoad");
    }
    const none = new Set<string>();
    expect(inLoad.map((t) => inventoryTabForTask(t, none))).toEqual([
      "completed",
      "rectification",
      "priority",
      "pending",
    ]);
  });
});

describe("raKeysInOpenContainerLoads", () => {
  it("solo cuenta cargues abiertos", () => {
    const keys = raKeysInOpenContainerLoads([
      load("open", ["100"]),
      load("closed", ["200"]),
    ]);
    expect(taskIsInOpenContainerLoad(task("RA-100", "pending"), keys)).toBe(true);
    expect(taskIsInOpenContainerLoad(task("200", "pending"), keys)).toBe(false);
  });
});
