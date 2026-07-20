import { describe, expect, it } from "vitest";
import { resolveInventariadorId } from "@/lib/inventariadoresRoster";
import {
  defaultInventoryControlSettings,
  operatorAllowsKeyboardMeasures,
} from "@/lib/inventoryControlSettings";

describe("resolveInventariadorId", () => {
  it("resuelve nombre corto Claudio / Jahir / Raul", () => {
    expect(resolveInventariadorId("Claudio")).toBe("claudio");
    expect(resolveInventariadorId("Jahir")).toBe("jahir");
    expect(resolveInventariadorId("Raul")).toBe("raul");
  });

  it("resuelve variantes de apellido y email local", () => {
    expect(resolveInventariadorId("Claudio Gutierrez")).toBe("claudio");
    expect(resolveInventariadorId("Claudio Gutiérrez")).toBe("claudio");
    expect(resolveInventariadorId(null, "claudio@aldepositos.com")).toBe(
      "claudio",
    );
  });
});

describe("operatorAllowsKeyboardMeasures", () => {
  it("habilita teclado para Claudio con solo nombre corto", () => {
    const settings = {
      ...defaultInventoryControlSettings(),
      keyboardOperatorIds: ["claudio"],
      updatedAt: new Date().toISOString(),
    };
    expect(
      operatorAllowsKeyboardMeasures(settings, "claudio@x.com", "Claudio"),
    ).toBe(true);
    expect(
      operatorAllowsKeyboardMeasures(settings, "otro@x.com", "Jahir"),
    ).toBe(false);
  });
});
