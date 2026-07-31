import { describe, expect, it } from "vitest";
import { shouldAttemptRaInventorySnapshot } from "@/lib/raInventorySnapshots";

describe("shouldAttemptRaInventorySnapshot", () => {
  it("guarda al pasar a completed desde trabajo", () => {
    expect(shouldAttemptRaInventorySnapshot("in_progress", "completed")).toBe(
      true,
    );
    expect(shouldAttemptRaInventorySnapshot("pending", "completed")).toBe(true);
    expect(shouldAttemptRaInventorySnapshot("paused", "completed")).toBe(true);
  });

  it("guarda al completar desde rectificación", () => {
    expect(
      shouldAttemptRaInventorySnapshot("rectification", "completed"),
    ).toBe(true);
  });

  it("no guarda si el siguiente status no es completed", () => {
    expect(shouldAttemptRaInventorySnapshot("pending", "in_progress")).toBe(
      false,
    );
    expect(
      shouldAttemptRaInventorySnapshot("rectification", "rectification"),
    ).toBe(false);
  });
});
