import { describe, expect, it } from "vitest";
import {
  applyPesoTotalToLine,
  applyUnidadesTotalesToLine,
  pesoTotalFromLine,
  unidadesTotalesFromLine,
} from "@/lib/collectionLineUtils";
import type { CollectionOrderLine } from "@/lib/types/collectionOrder";

const base = (patch: Partial<CollectionOrderLine>): CollectionOrderLine => ({
  id: "1",
  ...patch,
});

describe("unidadesTotalesFromLine", () => {
  it("prioriza tot de factura sobre bultos×und (48 decorativo)", () => {
    expect(
      unidadesTotalesFromLine(
        base({ bultos: "6", unidadesPorBulto: "48", unidadesTotales: "311" }),
      ),
    ).toBe(311);
    expect(
      unidadesTotalesFromLine(
        base({ bultos: "10", unidadesPorBulto: "48", unidadesTotales: "459" }),
      ),
    ).toBe(459);
  });

  it("si no hay tot guardado, usa bultos×und", () => {
    expect(
      unidadesTotalesFromLine(base({ bultos: "2", unidadesPorBulto: "39" })),
    ).toBe(78);
  });
});

describe("applyUnidadesTotalesToLine", () => {
  it("311 / 6 → und 48 y conserva tot 311", () => {
    const next = applyUnidadesTotalesToLine(
      base({ bultos: "6", unidadesPorBulto: "" }),
      "311",
    );
    expect(next.unidadesPorBulto).toBe("48");
    expect(next.unidadesTotales).toBe("311");
    expect(unidadesTotalesFromLine(next)).toBe(311);
  });

  it("459 / 10 → und 48 y tot 459", () => {
    const next = applyUnidadesTotalesToLine(base({ bultos: "10" }), "459");
    expect(next.unidadesPorBulto).toBe("48");
    expect(next.unidadesTotales).toBe("459");
  });
});

describe("pesoTotalFromLine", () => {
  it("prioriza peso total de factura sobre bultos×peso/b", () => {
    expect(
      pesoTotalFromLine(
        base({
          bultos: "10",
          pesoPorBulto: "40.92",
          pesoTotalKg: "409.15",
        }),
      ),
    ).toBe(409.15);
  });
});

describe("applyPesoTotalToLine", () => {
  it("guarda tot de factura y deriva peso/b sin alterar el total", () => {
    const next = applyPesoTotalToLine(
      base({ bultos: "10", pesoPorBulto: "" }),
      "409.15",
    );
    expect(next.pesoTotalKg).toBe("409.15");
    expect(pesoTotalFromLine(next)).toBe(409.15);
    expect(parseFloat(String(next.pesoPorBulto))).toBeCloseTo(40.915, 5);
  });
});
