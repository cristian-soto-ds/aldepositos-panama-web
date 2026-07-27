import { describe, expect, it } from "vitest";
import {
  parseMeasureNumber,
  preserveDocumentNumber,
} from "@/lib/measureDecimals";

describe("parseMeasureNumber — miles / decimales", () => {
  it("interpreta 1,320.30 como mil trescientos veinte (no 1.32)", () => {
    expect(parseMeasureNumber("1,320.30")).toBeCloseTo(1320.3, 5);
    expect(parseMeasureNumber("1,320.30 kg")).toBeCloseTo(1320.3, 5);
  });

  it("interpreta formato europeo 1.320,30", () => {
    expect(parseMeasureNumber("1.320,30")).toBeCloseTo(1320.3, 5);
  });

  it("conserva decimales simples", () => {
    expect(parseMeasureNumber("21.25")).toBeCloseTo(21.25, 5);
    expect(parseMeasureNumber("21,25")).toBeCloseTo(21.25, 5);
    expect(parseMeasureNumber("1.936")).toBeCloseTo(1.936, 5);
  });

  it("quita miles solo con coma", () => {
    expect(parseMeasureNumber("1,320")).toBe(1320);
    expect(parseMeasureNumber("12,500")).toBe(12500);
  });
});

describe("preserveDocumentNumber", () => {
  it("no colapsa pesos con miles", () => {
    expect(preserveDocumentNumber("1,320.30")).toBe("1320.30");
    expect(parseMeasureNumber(preserveDocumentNumber("1,320.30"))).toBeCloseTo(
      1320.3,
      5,
    );
  });
});
