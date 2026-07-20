import { describe, expect, it } from "vitest";
import type { Task } from "@/lib/types/task";
import {
  activeInventoryMs,
  activeInventoryMinutes,
  applyInventorySessionOnSave,
  ensureInventoryStarted,
  pauseInventory,
  releaseInventoryPause,
  resumeInventory,
} from "@/lib/inventorySessionTiming";

function baseTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    ra: "63589",
    mainClient: "C",
    provider: "P",
    subClient: "",
    brand: "",
    expectedBultos: 10,
    originalExpectedBultos: 10,
    expectedCbm: 0,
    expectedWeight: 0,
    notes: "",
    currentBultos: 0,
    status: "pending",
    measureData: [],
    weightMode: "per_bulto",
    manualTotalWeight: 0,
    type: "quick",
    ...overrides,
  };
}

describe("inventorySessionTiming", () => {
  it("ensureInventoryStarted solo setea una vez", () => {
    const t0 = baseTask();
    const t1 = ensureInventoryStarted(t0, "2026-07-10T10:00:00.000Z");
    expect(t1.inventoryStartedAt).toBe("2026-07-10T10:00:00.000Z");
    const t2 = ensureInventoryStarted(t1, "2026-07-10T12:00:00.000Z");
    expect(t2.inventoryStartedAt).toBe("2026-07-10T10:00:00.000Z");
  });

  it("pauseInventory marca paused y pausedAt", () => {
    const started = ensureInventoryStarted(
      baseTask({ status: "in_progress" }),
      "2026-07-10T10:00:00.000Z",
    );
    const paused = pauseInventory(started, "2026-07-10T11:00:00.000Z");
    expect(paused.status).toBe("paused");
    expect(paused.inventoryPausedAt).toBe("2026-07-10T11:00:00.000Z");
    expect(paused.inventoryStartedAt).toBe("2026-07-10T10:00:00.000Z");
  });

  it("pauseInventory idempotente no reinicia reloj de pausa", () => {
    const paused = pauseInventory(
      baseTask({
        status: "paused",
        inventoryStartedAt: "2026-07-10T10:00:00.000Z",
        inventoryPausedAt: "2026-07-10T11:00:00.000Z",
      }),
      "2026-07-10T12:00:00.000Z",
    );
    expect(paused.inventoryPausedAt).toBe("2026-07-10T11:00:00.000Z");
  });

  it("resumeInventory acumula pausedMs y vuelve a in_progress", () => {
    const paused = baseTask({
      status: "paused",
      inventoryStartedAt: "2026-07-10T10:00:00.000Z",
      inventoryPausedAt: "2026-07-10T11:00:00.000Z",
      inventoryPausedMs: 60_000,
    });
    const resumed = resumeInventory(
      paused,
      "in_progress",
      "2026-07-10T12:00:00.000Z",
    );
    expect(resumed.status).toBe("in_progress");
    expect(resumed.inventoryPausedAt).toBeUndefined();
    // 1h previa acumulada + 1h abierta = 2h
    expect(resumed.inventoryPausedMs).toBe(60_000 + 3_600_000);
  });

  it("releaseInventoryPause cierra pausa y deja pending (sin En curso)", () => {
    const paused = baseTask({
      status: "paused",
      inventoryStartedAt: "2026-07-10T10:00:00.000Z",
      inventoryPausedAt: "2026-07-10T11:00:00.000Z",
      inventoryPausedMs: 60_000,
    });
    const released = releaseInventoryPause(
      paused,
      "2026-07-10T12:00:00.000Z",
    );
    expect(released.status).toBe("pending");
    expect(released.inventoryPausedAt).toBeUndefined();
    expect(released.inventoryPausedMs).toBe(60_000 + 3_600_000);
  });

  it("activeInventoryMs excluye pausas cerradas y abiertas", () => {
    const task = baseTask({
      status: "paused",
      inventoryStartedAt: "2026-07-10T10:00:00.000Z",
      inventoryPausedMs: 30 * 60_000,
      inventoryPausedAt: "2026-07-10T12:00:00.000Z",
    });
    // start 10:00, end 13:00 = 3h wall; paused closed 30m + open 1h = 1.5h → active 1.5h
    const ms = activeInventoryMs(
      task,
      "2026-07-10T13:00:00.000Z",
      Date.parse("2026-07-10T13:00:00.000Z"),
    );
    expect(ms).toBe(90 * 60_000);
  });

  it("activeInventoryMs retorna null sin startedAt", () => {
    expect(activeInventoryMs(baseTask({ status: "completed" }))).toBeNull();
    expect(activeInventoryMinutes(baseTask({ status: "completed" }))).toBeNull();
  });

  it("applyInventorySessionOnSave preserva paused sin forceResume", () => {
    const paused = baseTask({
      status: "paused",
      inventoryStartedAt: "2026-07-10T10:00:00.000Z",
      inventoryPausedAt: "2026-07-10T11:00:00.000Z",
    });
    const next = applyInventorySessionOnSave({
      task: paused,
      hasCapture: true,
      isCompleted: false,
      workStatusWhenActive: "in_progress",
      forceResume: false,
    });
    expect(next.status).toBe("paused");
  });

  it("applyInventorySessionOnSave reanuda con forceResume", () => {
    const paused = baseTask({
      status: "paused",
      inventoryStartedAt: "2026-07-10T10:00:00.000Z",
      inventoryPausedAt: "2026-07-10T11:00:00.000Z",
    });
    const next = applyInventorySessionOnSave({
      task: paused,
      hasCapture: true,
      isCompleted: false,
      workStatusWhenActive: "in_progress",
      forceResume: true,
      at: "2026-07-10T12:00:00.000Z",
    });
    expect(next.status).toBe("in_progress");
    expect(next.inventoryPausedAt).toBeUndefined();
  });

  it("applyInventorySessionOnSave cierra pausa al completar", () => {
    const paused = baseTask({
      status: "paused",
      inventoryStartedAt: "2026-07-10T10:00:00.000Z",
      inventoryPausedAt: "2026-07-10T11:00:00.000Z",
    });
    const next = applyInventorySessionOnSave({
      task: paused,
      hasCapture: true,
      isCompleted: true,
      workStatusWhenActive: "in_progress",
      at: "2026-07-10T12:00:00.000Z",
    });
    expect(next.status).toBe("completed");
    expect(next.inventoryPausedAt).toBeUndefined();
    expect(next.inventoryPausedMs).toBe(3_600_000);
  });
});
