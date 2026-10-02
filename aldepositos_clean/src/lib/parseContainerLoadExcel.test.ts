import { describe, expect, it } from "vitest";
import {
  parseContainerLoadGrid,
  suggestContainerLoadName,
} from "@/lib/parseContainerLoadExcel";

const HEADER = [
  "Estado",
  "Número",
  "Fecha",
  "Nombre Proveedor",
  "Nombre Expeditor",
  "Número de seguimiento",
  "BULTOS",
  "CBM FACT",
  "PESO",
  "DIGITADO",
  "Volumen (m³)",
  "PIES FTS",
  "Notas",
  "INSTRUCCIÓN",
];

function row(
  ra: string,
  proveedor: string,
  bultos: string,
  instr: string,
): string[] {
  return [
    "En Almacén",
    ra,
    "29/09/2026",
    proveedor,
    "EXP",
    "TRACK",
    bultos,
    "0.42",
    "104.87",
    "No",
    "0",
    "14.72",
    "ROPA",
    instr,
  ];
}

describe("parseContainerLoadGrid", () => {
  it("detecta encabezado bajo el título, ordena por INSTRUCCIÓN y omite totales", () => {
    const grid = [
      ["", "", "", "INSTRUCCIÓN CARGUE CONSOLIDADO 86 LG"],
      HEADER,
      row("67070", "DELTA FASHION", "117", "2"),
      row("67072", "ILUMINACIONES", "14", "1"),
      row("67080", "DUOMODA", "9", "3"),
      ["", "", "", "", "", "", "795", "72.14", "19649.61", "0", "73.18", "1885.56", "", ""],
    ];
    const out = parseContainerLoadGrid(grid);
    expect(out.headerFound).toBe(true);
    expect(out.suggestedName).toBe("CONSOLIDADO 86 LG");
    expect(out.items.map((i) => i.ra)).toEqual(["67072", "67070", "67080"]);
    expect(out.items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(out.items[0]).toMatchObject({
      proveedor: "ILUMINACIONES",
      bultos: 14,
      cbm: 0.42,
      peso: 104.87,
      notas: "ROPA",
    });
  });

  it("sin INSTRUCCIÓN usa el orden de filas y deduplica RA", () => {
    const grid = [
      ["RA", "Proveedor", "Bultos"],
      ["RA-500", "A", "1"],
      ["501", "B", "2"],
      ["500", "C", "3"],
    ];
    const out = parseContainerLoadGrid(grid);
    expect(out.items.map((i) => i.ra)).toEqual(["500", "501"]);
    expect(out.warnings.some((w) => w.includes("500"))).toBe(true);
  });

  it("sin columnas reconocibles pide Terra", () => {
    const out = parseContainerLoadGrid([
      ["foo", "bar"],
      ["1", "2"],
    ]);
    expect(out.headerFound).toBe(false);
    expect(out.items).toEqual([]);
  });
});

describe("suggestContainerLoadName", () => {
  it("quita el prefijo de instrucción", () => {
    expect(suggestContainerLoadName("Relación de cargue: DO-02 PONCHO")).toBe(
      "DO-02 PONCHO",
    );
  });
});
