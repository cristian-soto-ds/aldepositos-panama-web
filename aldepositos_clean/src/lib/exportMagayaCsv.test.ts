import { describe, expect, it } from "vitest";
import {
  buildMagayaRowValues,
  tallaParaCsvMagaya,
  toMagayaExportUpper,
} from "@/lib/exportMagayaCsv";

describe("tallaParaCsvMagaya", () => {
  it("deja solo primera y última talla del rango", () => {
    expect(tallaParaCsvMagaya("3-5-7-9-11-13-15.")).toBe("3-15.");
    expect(tallaParaCsvMagaya("3-5-7-9-11-13.")).toBe("3-13.");
    expect(tallaParaCsvMagaya("3-5-7-9-11-13-15")).toBe("3-15.");
  });

  it("conserva rango de dos tallas y agrega punto", () => {
    expect(tallaParaCsvMagaya("12-18")).toBe("12-18.");
  });

  it("conserva talla única con punto", () => {
    expect(tallaParaCsvMagaya("32")).toBe("32.");
  });
});

describe("buildMagayaRowValues mayúsculas", () => {
  it("exporta textos en mayúsculas cerradas", () => {
    const row = buildMagayaRowValues({
      referencia: "dd32517/6",
      descripcion: "Pantalon Jeans",
      magayaModelo: "VOG Premium",
      paisOrigen: "China",
      tejido: "Plano",
      talla: "3-5-7-9-11-13-15.",
      genero: "dama",
      bultos: 1,
      unidadesPorBulto: 48,
    });

    expect(row[0]).toBe("DD32517/6");
    expect(row[1]).toBe("PANTALON JEANS");
    expect(row[2]).toBe("VOG PREMIUM");
    expect(row[3]).toBe("Cartón");
    expect(row[5]).toBe("PZA");
    expect(row[7]).toBe("CHINA");
    expect(row[9]).toBe("PLANO");
    expect(row[10]).toBe("3-15.");
    expect(row[12]).toBe("DAMA");
  });

  it("exporta CABALLERO como HOMBRE", () => {
    const row = buildMagayaRowValues({
      referencia: "X1",
      descripcion: "Pantalon",
      genero: "caballero",
      bultos: 1,
      unidadesPorBulto: 48,
    });
    expect(row[12]).toBe("HOMBRE");
  });

  it("toMagayaExportUpper usa locale es", () => {
    expect(toMagayaExportUpper("Cartón")).toBe("CARTÓN");
  });
});
