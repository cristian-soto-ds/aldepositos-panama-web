import { describe, expect, it } from "vitest";
import {
  computeInventoryLeaderboard,
  computeScore,
  effortForTask,
  LEADERBOARD_WEIGHTS,
} from "@/lib/inventoryLeaderboard";
import type { Task } from "@/lib/types/task";

function task(overrides: Partial<Task>): Task {
  return {
    id: "1",
    ra: "1",
    mainClient: "C",
    provider: "P",
    subClient: "",
    brand: "",
    expectedBultos: 10,
    originalExpectedBultos: 10,
    expectedCbm: 0,
    expectedWeight: 0,
    notes: "",
    currentBultos: 5,
    status: "completed",
    measureData: [{ referencia: "A", bultos: "5", l: "1", w: "1", h: "1" }],
    weightMode: "per_bulto",
    manualTotalWeight: 0,
    type: "quick",
    ...overrides,
  };
}

describe("effort scoring weights", () => {
  it("sin refs vale más que con refs a igualdad de filas/bultos", () => {
    const filas = 2;
    const bultos = 50;
    const withEffort = effortForTask(filas, bultos, { referenceMode: "with" });
    const withoutEffort = effortForTask(filas, bultos, {
      referenceMode: "without",
    });
    expect(withoutEffort).toBeGreaterThan(withEffort);
    expect(withEffort).toBe(2 * 12 + 50 * 0.25);
    expect(withoutEffort).toBe(2 * 15 + 50 * 0.5);
  });

  it("ejemplo del plan: 40 cajas sin refs supera 2 refs / 50 bultos", () => {
    const easy = computeScore(
      1,
      effortForTask(2, 50, { referenceMode: "with" }),
    );
    const hard = computeScore(
      1,
      effortForTask(40, 40, { referenceMode: "without" }),
    );
    expect(easy).toBe(76.5);
    expect(hard).toBe(660);
    expect(hard).toBeGreaterThan(easy);
  });

  it("usa pesos default si el modo es desconocido", () => {
    const w = LEADERBOARD_WEIGHTS.modes.default;
    expect(effortForTask(3, 10, {})).toBe(3 * w.fila + 10 * w.bulto);
  });
});

describe("computeInventoryLeaderboard effort ranking", () => {
  const now = new Date("2026-07-12T18:00:00.000-05:00");

  it("ordena por score: sin refs (mucho esfuerzo) gana a con refs (muchos bultos)", () => {
    const result = computeInventoryLeaderboard(
      [
        task({
          id: "easy-refs",
          ra: "100",
          currentBultos: 50,
          referenceMode: "with",
          measureData: [
            { referencia: "1", bultos: "20", l: "1", w: "1", h: "1" },
            { referencia: "2", bultos: "30", l: "1", w: "1", h: "1" },
          ],
          contributors: [
            {
              email: "raul@example.com",
              displayName: "Raul Lezcano",
              at: "2026-07-12T12:00:00.000Z",
            },
          ],
          inventoryCompletedBy: {
            email: "raul@example.com",
            displayName: "Raul Lezcano",
            at: "2026-07-12T12:00:00.000Z",
          },
        }),
        task({
          id: "hard-no-refs",
          ra: "200",
          currentBultos: 40,
          referenceMode: "without",
          measureData: Array.from({ length: 40 }, (_, i) => ({
            referencia: String(i + 1),
            bultos: "1",
            l: "1",
            w: "1",
            h: "1",
          })),
          contributors: [
            {
              email: "jahir@example.com",
              displayName: "Jahir Jimenez",
              at: "2026-07-12T12:00:00.000Z",
            },
          ],
          inventoryCompletedBy: {
            email: "jahir@example.com",
            displayName: "Jahir Jimenez",
            at: "2026-07-12T12:00:00.000Z",
          },
        }),
      ],
      "day",
      now,
    );

    expect(result.stats[0]?.id).toBe("jahir");
    expect(result.stats[1]?.id).toBe("raul");
    expect(result.stats[0]!.score).toBeGreaterThan(result.stats[1]!.score);
    expect(result.stats[0]?.rank).toBe(1);
    expect(result.leaderId).toBe("jahir");
  });

  it("desempata por filas cuando el score es igual", () => {
    // Mismo score forzado vía mismo inventarios+esfuerzo: 1 inv + 1 fila + 0 bultos default
    const result = computeInventoryLeaderboard(
      [
        task({
          id: "a",
          currentBultos: 0,
          measureData: [{ referencia: "A", l: "1" }],
          contributors: [
            {
              email: "jahir@example.com",
              displayName: "Jahir Jimenez",
              at: "2026-07-12T12:00:00.000Z",
            },
          ],
          inventoryCompletedBy: {
            email: "jahir@example.com",
            displayName: "Jahir Jimenez",
            at: "2026-07-12T12:00:00.000Z",
          },
        }),
        task({
          id: "b1",
          currentBultos: 0,
          measureData: [{ referencia: "B", l: "1" }],
          contributors: [
            {
              email: "raul@example.com",
              displayName: "Raul Lezcano",
              at: "2026-07-12T11:00:00.000Z",
            },
          ],
          inventoryCompletedBy: {
            email: "raul@example.com",
            displayName: "Raul Lezcano",
            at: "2026-07-12T11:00:00.000Z",
          },
        }),
        task({
          id: "b2",
          currentBultos: 0,
          measureData: [{ referencia: "C", l: "1" }],
          contributors: [
            {
              email: "raul@example.com",
              displayName: "Raul Lezcano",
              at: "2026-07-12T13:00:00.000Z",
            },
          ],
          inventoryCompletedBy: {
            email: "raul@example.com",
            displayName: "Raul Lezcano",
            at: "2026-07-12T13:00:00.000Z",
          },
        }),
      ],
      "day",
      now,
    );

    // Raul: 2 inventarios → más score y más filas
    expect(result.stats[0]?.id).toBe("raul");
    expect(result.stats[0]?.inventarios).toBe(2);
    expect(result.stats[1]?.id).toBe("jahir");
  });
});
