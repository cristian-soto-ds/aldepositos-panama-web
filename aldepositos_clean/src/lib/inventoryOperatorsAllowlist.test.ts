import { describe, expect, it } from "vitest";
import {
  canManageInventoryPause,
  isAllowedInventoryOperator,
  resolveActiveInventoryOperatorLabel,
  resolveAllowedInventoryOperator,
  resolveLatestAllowedContributor,
  resolveLiveInventoryOperator,
  resolvePausedInventoryOperatorLabel,
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
    mainClient: "",
    provider: "",
    subClient: "",
    brand: "",
    expectedBultos: 12,
    originalExpectedBultos: 12,
    expectedCbm: 0,
    expectedWeight: 0,
    notes: "",
    currentBultos: 0,
    status: "completed",
    measureData: [],
    weightMode: "per_bulto",
    manualTotalWeight: 0,
    ...overrides,
  };
}

describe("canManageInventoryPause", () => {
  it("permite solo a Jahir, Claudio y Raul", () => {
    expect(canManageInventoryPause(null, "Jahir Jimenez")).toBe(true);
    expect(canManageInventoryPause(null, "Claudio Guitierrez")).toBe(true);
    expect(canManageInventoryPause(null, "Raul Lezcano")).toBe(true);
  });

  it("bloquea a monitores como Cristian Soto", () => {
    expect(canManageInventoryPause("cristian@example.com", "Cristian Soto")).toBe(
      false,
    );
    expect(canManageInventoryPause(null, "Operador X")).toBe(false);
  });
});

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

describe("resolveLatestAllowedContributor", () => {
  it("elige el inventariador con at más reciente aunque no sea el último del array", () => {
    const resolved = resolveLatestAllowedContributor(
      baseTask({
        contributors: [
          {
            email: "claudio@example.com",
            displayName: "Claudio",
            at: "2026-07-12T14:00:00Z",
          },
          {
            email: "jahir@example.com",
            displayName: "Jahir",
            at: "2026-07-12T10:00:00Z",
          },
        ],
      }),
    );
    expect(resolved?.displayName).toBe("Claudio Guitierrez");
  });
});

describe("resolveActiveInventoryOperatorLabel", () => {
  it("usa presencia en vivo si hay inventariador en el RA", () => {
    const label = resolveActiveInventoryOperatorLabel(baseTask({ status: "pending" }), [
      { userKey: "jahir@example.com", name: "Jahir", rawLabel: "Jahir Jimenez" },
    ]);
    expect(label).toBe("Jahir Jimenez");
  });

  it("sin presencia muestra En curso por el contributor más reciente", () => {
    const label = resolveActiveInventoryOperatorLabel(
      baseTask({
        status: "in_progress",
        contributors: [
          {
            email: "claudio@example.com",
            displayName: "Claudio",
            at: "2026-01-01T00:00:00Z",
          },
        ],
      }),
      [],
    );
    expect(label).toBe("Claudio Guitierrez");
  });

  it("presencia en vivo gana sobre contributor más viejo", () => {
    const label = resolveActiveInventoryOperatorLabel(
      baseTask({
        status: "in_progress",
        contributors: [
          {
            email: "claudio@example.com",
            displayName: "Claudio",
            at: "2026-01-01T00:00:00Z",
          },
        ],
      }),
      [{ userKey: "jahir@example.com", name: "Jahir", rawLabel: "Jahir Jimenez" }],
    );
    expect(label).toBe("Jahir Jimenez");
  });

  it("Cristian Soto en presencia no muestra En curso; usa contributor", () => {
    const label = resolveActiveInventoryOperatorLabel(
      baseTask({
        status: "in_progress",
        contributors: [
          {
            email: "claudio@example.com",
            displayName: "Claudio",
            at: "2026-01-01T00:00:00Z",
          },
        ],
      }),
      [{ userKey: "cristian@example.com", name: "Cristian Soto" }],
    );
    expect(label).toBe("Claudio Guitierrez");
  });

  it("pending sin presencia no muestra En curso", () => {
    expect(
      resolveActiveInventoryOperatorLabel(
        baseTask({
          status: "pending",
          contributors: [
            {
              email: "claudio@example.com",
              displayName: "Claudio",
              at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
        [],
      ),
    ).toBeNull();
  });
});

describe("resolvePausedInventoryOperatorLabel", () => {
  it("muestra inventariador atribuido en pausa sin presencia", () => {
    const label = resolvePausedInventoryOperatorLabel(
      baseTask({
        status: "paused",
        contributors: [
          {
            email: "jahir@example.com",
            displayName: "Jahir",
            at: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );
    expect(label).toBe("Jahir Jimenez");
  });

  it("elige el at más reciente en pausa", () => {
    const label = resolvePausedInventoryOperatorLabel(
      baseTask({
        status: "paused",
        contributors: [
          {
            email: "jahir@example.com",
            displayName: "Jahir",
            at: "2026-01-01T08:00:00Z",
          },
          {
            email: "raul@example.com",
            displayName: "Raul",
            at: "2026-01-01T12:00:00Z",
          },
        ],
      }),
    );
    expect(label).toBe("Raul Lezcano");
  });

  it("no aplica si el status no es paused", () => {
    expect(
      resolvePausedInventoryOperatorLabel(
        baseTask({
          status: "in_progress",
          contributors: [
            {
              email: "jahir@example.com",
              displayName: "Jahir",
              at: "2026-01-01T00:00:00Z",
            },
          ],
        }),
      ),
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
      status: "in_progress",
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

  it("inventariador B no pisa atribución al corregir RA ya completado por A", () => {
    const task = baseTask({
      status: "completed",
      contributors: [
        {
          email: "raul@example.com",
          displayName: "Raul Lezcano",
          at: "2026-01-01T00:00:00Z",
        },
      ],
      inventoryCompletedBy: {
        email: "raul@example.com",
        displayName: "Raul Lezcano",
        at: "2026-01-01T00:00:00Z",
      },
    });
    const next = applyInventoryAttribution(task, {
      userKey: "jahir@example.com",
      userLabel: "Jahir Jimenez",
      hasCapture: true,
      isCompleted: true,
      priorStatus: "completed",
    });
    expect(next.inventoryCompletedBy?.displayName).toBe("Raul Lezcano");
    expect(next.contributors).toHaveLength(1);
    expect(next.contributors?.[0]?.displayName).toBe("Raul Lezcano");
    expect(inventoryCompletedByLabel(next)).toBe("Raul Lezcano");
  });

  it("supervisor corrige medidas sin alterar atribución (status ya completed en withSession)", () => {
    const task = baseTask({
      status: "completed",
      currentBultos: 30,
      contributors: [
        {
          email: "claudio@example.com",
          displayName: "Claudio Guitierrez",
          at: "2026-01-01T00:00:00Z",
        },
      ],
      inventoryCompletedBy: {
        email: "claudio@example.com",
        displayName: "Claudio Guitierrez",
        at: "2026-01-01T00:00:00Z",
      },
    });
    const next = applyInventoryAttribution(task, {
      userKey: "cristian@example.com",
      userLabel: "Cristian Soto",
      hasCapture: true,
      isCompleted: true,
      priorStatus: "completed",
    });
    expect(next.inventoryCompletedBy?.displayName).toBe("Claudio Guitierrez");
    expect(next.contributors).toHaveLength(1);
    expect(inventoryCompletedByLabel(next)).toBe("Claudio Guitierrez");
  });

  it("aún atribuye al completar por primera vez aunque withSession ya sea completed", () => {
    const task = baseTask({
      status: "completed",
      contributors: undefined,
      inventoryCompletedBy: undefined,
    });
    const next = applyInventoryAttribution(task, {
      userKey: "jahir@example.com",
      userLabel: "Jahir Jimenez",
      hasCapture: true,
      isCompleted: true,
      priorStatus: "in_progress",
    });
    expect(next.inventoryCompletedBy?.displayName).toBe("Jahir Jimenez");
    expect(next.contributors).toHaveLength(1);
  });
});
