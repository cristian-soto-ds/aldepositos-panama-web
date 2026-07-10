import { describe, expect, it } from "vitest";
import {
  isAllowedInventoryOperator,
  resolveAllowedInventoryOperator,
  resolveLiveInventoryOperator,
} from "@/lib/inventoryOperatorsAllowlist";
import {
  applyInventoryAttribution,
  inventoryCompletedByLabel,
} from "@/lib/taskContributors";
import type { Task } from "@/lib/types/task";

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "1",
    ra: "63168",
    status: "completed",
    expectedBultos: 12,
    ...overrides,
  };
}

describe("isAllowedInventoryOperator", () => {
  it("acepta Jahir, Claudio y Raul por nombre", () => {
    expect(isAllowedInventoryOperator(null, "Jahir")).toBe(true);
    expect(isAllowedInventoryOperator(null, "Jahir Jimenez")).toBe(true);
    expect(isAllowedInventoryOperator(null, "Claudio")).toBe(true);
    expect(isAllowedInventoryOperator(null, "Claudio Guitierrez")).toBe(true);
    expect(isAllowedInventoryOperator(null, "Raul Lezcano")).toBe(true);
    expect(isAllowedInventoryOperator(null, "Raúl Lezcano")).toBe(true);
  });

  it("rechaza Cristian Soto y otros", () => {
    expect(isAllowedInventoryOperator("cristian@example.com", "Cristian Soto")).toBe(
      false,
    );
    expect(isAllowedInventoryOperator(null, "Operador X")).toBe(false);
  });
});

describe("resolveLiveInventoryOperator", () => {
  it("resuelve inventariador en presencia en vivo", () => {
    const resolved = resolveLiveInventoryOperator([
      { userKey: "jahir@example.com", name: "Jahir" },
    ]);
    expect(resolved?.displayName).toBe("Jahir Jimenez");
  });

  it("ignora supervisores u otros operadores en presencia", () => {
    expect(
      resolveLiveInventoryOperator([
        { userKey: "cristian@example.com", name: "Cristian Soto" },
      ]),
    ).toBeNull();
  });
});

describe("resolveAllowedInventoryOperator", () => {
  it("prefiere contributor permitido si inventoryCompletedBy es supervisor", () => {
    const task = baseTask({
      inventoryCompletedBy: {
        email: "cristian@example.com",
        displayName: "Cristian Soto",
        at: "2026-01-01T00:00:00Z",
      },
      contributors: [
        {
          email: "jahir@example.com",
          displayName: "Jahir",
          at: "2026-01-01T01:00:00Z",
        },
      ],
    });
    const resolved = resolveAllowedInventoryOperator(task);
    expect(resolved?.displayName).toBe("Jahir Jimenez");
  });

  it("devuelve null si solo intervino un usuario no permitido", () => {
    const task = baseTask({
      inventoryCompletedBy: {
        email: "cristian@example.com",
        displayName: "Cristian Soto",
        at: "2026-01-01T00:00:00Z",
      },
      contributors: [
        {
          email: "cristian@example.com",
          displayName: "Cristian Soto",
          at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    expect(resolveAllowedInventoryOperator(task)).toBeNull();
    expect(inventoryCompletedByLabel(task)).toBeNull();
  });
});

describe("applyInventoryAttribution", () => {
  it("registra contributors para inventariador permitido", () => {
    const task = baseTask({ status: "in_progress" });
    const next = applyInventoryAttribution(task, {
      userKey: "jahir@example.com",
      userLabel: "Jahir",
      hasCapture: true,
      isCompleted: false,
    });
    expect(next.contributors).toHaveLength(1);
    expect(next.contributors?.[0]?.displayName).toBe("Jahir");
  });

  it("no muta contributors si el usuario no está en la allowlist", () => {
    const task = baseTask({
      contributors: [
        {
          email: "jahir@example.com",
          displayName: "Jahir",
          at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    const next = applyInventoryAttribution(task, {
      userKey: "cristian@example.com",
      userLabel: "Cristian Soto",
      hasCapture: true,
      isCompleted: true,
    });
    expect(next.contributors).toHaveLength(1);
    expect(next.contributors?.[0]?.displayName).toBe("Jahir");
    expect(next.inventoryCompletedBy).toBeUndefined();
  });
});
