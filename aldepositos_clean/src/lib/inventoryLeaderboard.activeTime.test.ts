import { describe, expect, it } from "vitest";
import { computeInventoryLeaderboard } from "@/lib/inventoryLeaderboard";
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

describe("computeInventoryLeaderboard active time KPI", () => {
  const now = new Date("2026-07-12T18:00:00.000-05:00");

  it("ignora completados sin inventoryStartedAt en el promedio", () => {
    const result = computeInventoryLeaderboard(
      [
        task({
          id: "a",
          status: "completed",
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
    const jahir = result.stats.find((s) => s.id === "jahir");
    expect(jahir?.inventarios).toBe(1);
    expect(jahir?.avgActiveMinutes).toBeNull();
    expect(jahir?.timedInventarios).toBe(0);
  });

  it("calcula avgActiveMinutes excluyendo pausas y el sort usa score de esfuerzo", () => {
    const result = computeInventoryLeaderboard(
      [
        task({
          id: "fast",
          currentBultos: 1,
          measureData: [{ referencia: "A", bultos: "1" }],
          inventoryStartedAt: "2026-07-12T10:00:00.000Z",
          inventoryPausedMs: 30 * 60_000,
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
          id: "volume",
          currentBultos: 100,
          measureData: [
            { referencia: "A", bultos: "50" },
            { referencia: "B", bultos: "50" },
          ],
          contributors: [
            {
              email: "claudio@example.com",
              displayName: "Claudio Guitierrez",
              at: "2026-07-12T12:00:00.000Z",
            },
          ],
          inventoryCompletedBy: {
            email: "claudio@example.com",
            displayName: "Claudio Guitierrez",
            at: "2026-07-12T12:00:00.000Z",
          },
        }),
      ],
      "day",
      now,
    );

    // Ambos 1 inventario; Claudio gana por más filas/bultos (mayor score).
    expect(result.stats[0]?.id).toBe("claudio");
    expect(result.stats[1]?.id).toBe("jahir");
    expect(result.stats[0]!.score).toBeGreaterThan(result.stats[1]!.score);

    const jahir = result.stats.find((s) => s.id === "jahir");
    // 10:00 → 12:00 = 120 min wall − 30 min pausa = 90 min
    expect(jahir?.avgActiveMinutes).toBe(90);
    expect(jahir?.timedInventarios).toBe(1);
  });

  it("paused no cuenta como enProceso", () => {
    const result = computeInventoryLeaderboard(
      [
        task({
          id: "p",
          status: "paused",
          contributors: [
            {
              email: "raul@example.com",
              displayName: "Raul Lezcano",
              at: "2026-07-12T12:00:00.000Z",
            },
          ],
        }),
      ],
      "day",
      now,
    );
    const raul = result.stats.find((s) => s.id === "raul");
    expect(raul?.enProceso).toBe(0);
    expect(raul?.inventarios).toBe(0);
  });
});
