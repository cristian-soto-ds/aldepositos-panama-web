import { describe, expect, it } from "vitest";
import {
  assignBultosForSharedCtns,
  collectionLineDedupeKey,
  consolidateTerraLinesByReferencia,
  finalizeAldeGptTerraLines,
  inheritAdjacentSharedCtns,
  isNonProductTerraRow,
  joinBashArticuloReferencia,
  normalizeJeansDescripcion,
  parseCtnsRangeToBultos,
  parseDozenLooseNotation,
  postProcessAldeGptTerraLines,
  rejectTejidoInferredFromProduct,
  resolveBashPackingBultos,
  sanitizeMagayaOptionalText,
  toRefsBultosOnlyTerraLines,
} from "@/lib/aldeGptTerraDocumentExtract";

describe("parseDozenLooseNotation", () => {
  it("4 DOC / 4doc → 48 piezas de línea", () => {
    expect(parseDozenLooseNotation("4 DOC")).toEqual({
      dozenPcs: 48,
      totalPcs: 48,
    });
    expect(parseDozenLooseNotation("4doc")).toEqual({
      dozenPcs: 48,
      totalPcs: 48,
    });
    expect(parseDozenLooseNotation("4 DOZ")).toEqual({
      dozenPcs: 48,
      totalPcs: 48,
    });
  });

  it("4.4 / 4/4 / 4(4) → 48 docenas-equiv + tot 52", () => {
    expect(parseDozenLooseNotation("4.4")).toEqual({
      dozenPcs: 48,
      totalPcs: 52,
    });
    expect(parseDozenLooseNotation("4/4")).toEqual({
      dozenPcs: 48,
      totalPcs: 52,
    });
    expect(parseDozenLooseNotation("4(4)")).toEqual({
      dozenPcs: 48,
      totalPcs: 52,
    });
    expect(parseDozenLooseNotation("4 / 4 DOC")).toEqual({
      dozenPcs: 48,
      totalPcs: 52,
    });
  });

  it("6.06 DOC → 72 + 6 = 78 (sueltas = dígitos del decimal)", () => {
    expect(parseDozenLooseNotation("6.06 DOC")).toEqual({
      dozenPcs: 72,
      totalPcs: 78,
    });
    expect(parseDozenLooseNotation("6.06")).toEqual({
      dozenPcs: 72,
      totalPcs: 78,
    });
  });

  it("8.00 DOC → 96", () => {
    expect(parseDozenLooseNotation("8.00 DOC")).toEqual({
      dozenPcs: 96,
      totalPcs: 96,
    });
  });

  it("1/0 DOC → 12", () => {
    expect(parseDozenLooseNotation("1/0 DOC")).toEqual({
      dozenPcs: 12,
      totalPcs: 12,
    });
    expect(parseDozenLooseNotation("1 / 0 DOC")).toEqual({
      dozenPcs: 12,
      totalPcs: 12,
    });
  });

  it("no trata 48.11 suelto como 48 docenas", () => {
    expect(parseDozenLooseNotation("48.11")).toBeNull();
  });
});

describe("normalizeJeansDescripcion", () => {
  it("reduce jeans a PANTALON JEANS sin estilos", () => {
    expect(normalizeJeansDescripcion("PANTALON JEANS SKINNY PREMIUM")).toBe(
      "PANTALON JEANS",
    );
    expect(normalizeJeansDescripcion("PANTALON JEANS WIDE LEG")).toBe(
      "PANTALON JEANS",
    );
    expect(normalizeJeansDescripcion("PANTALON JEANS PALAZZO")).toBe(
      "PANTALON JEANS",
    );
    expect(normalizeJeansDescripcion("JEANS STRAIGHT")).toBe("PANTALON JEANS");
  });

  it("bermuda jeans → BERMUDA", () => {
    expect(normalizeJeansDescripcion("JEANS BERMUDA AZUL")).toBe("BERMUDA");
  });
});

describe("sanitizeMagayaOptionalText tejido", () => {
  it("quita prefijo TEJIDO", () => {
    expect(sanitizeMagayaOptionalText("TEJIDO PLANO", "tejido")).toBe("PLANO");
    expect(sanitizeMagayaOptionalText("tejido: denim", "tejido")).toBe("DENIM");
    expect(sanitizeMagayaOptionalText("PLANO", "tejido")).toBe("PLANO");
  });
});

describe("rejectTejidoInferredFromProduct", () => {
  it("no usa palabras de la descripción como tejido", () => {
    expect(
      rejectTejidoInferredFromProduct("CANVAS", "BOLSO BACCI CANVAS", ""),
    ).toBe("");
    expect(
      rejectTejidoInferredFromProduct(
        "DENIM CANVAS",
        "BOLSO CAMBRIDGE DENIM CANVAS",
        "100% POLIESTER",
      ),
    ).toBe("");
    expect(
      rejectTejidoInferredFromProduct(
        "YUTE",
        "BOLSO CAMBRIDGE YUTE",
        "100% YUTE",
      ),
    ).toBe("");
  });

  it("conserva tejido real (PLANO) que no está en la descripción", () => {
    expect(
      rejectTejidoInferredFromProduct("PLANO", "PANTALON JEANS", ""),
    ).toBe("PLANO");
  });
});

describe("postProcessAldeGptTerraLines docenas und/tot", () => {
  it("4.4 con 2 bultos → tot 52 und 26 (cantidad = total de línea)", () => {
    const lines = postProcessAldeGptTerraLines([
      {
        referencia: "A 04051 A",
        descripcion: "PANTALONES",
        bultos: "2",
        unidadesTotales: "4.4",
      },
    ]);
    expect(lines[0]!.unidadesPorBulto).toBe("26");
    expect(lines[0]!.unidadesTotales).toBe("52");
  });

  it("8 DOC con 2 bultos → und 48 tot 96", () => {
    const lines = postProcessAldeGptTerraLines([
      {
        referencia: "A 04051 A",
        descripcion: "PANTALONES",
        bultos: "2",
        unidadesTotales: "8 DOC",
      },
    ]);
    expect(lines[0]!.unidadesPorBulto).toBe("48");
    expect(lines[0]!.unidadesTotales).toBe("96");
  });

  it("6.06 DOC con 2 bultos → und 39 tot 78", () => {
    const lines = postProcessAldeGptTerraLines([
      {
        referencia: "A 04092 A",
        descripcion: "SHORT",
        bultos: "2",
        unidadesTotales: "6.06 DOC",
      },
    ]);
    expect(lines[0]!.unidadesPorBulto).toBe("39");
    expect(lines[0]!.unidadesTotales).toBe("78");
  });

  it("4 DOC con 2 bultos → und 24 tot 48", () => {
    const lines = postProcessAldeGptTerraLines([
      {
        referencia: "A 04052",
        descripcion: "SHORT",
        bultos: "2",
        unidadesTotales: "4 DOC",
      },
    ]);
    expect(lines[0]!.unidadesPorBulto).toBe("24");
    expect(lines[0]!.unidadesTotales).toBe("48");
  });

  it("11 (8) con 1 bulto → und 140 tot 140", () => {
    const lines = postProcessAldeGptTerraLines([
      {
        referencia: "X1",
        bultos: "1",
        unidadesTotales: "11 (8)",
      },
    ]);
    expect(lines[0]!.unidadesPorBulto).toBe("140");
    expect(lines[0]!.unidadesTotales).toBe("140");
  });

  it("corrige modelo que puso und=tot DOC y no divide por bultos", () => {
    const lines = postProcessAldeGptTerraLines([
      {
        referencia: "A 04051 A",
        bultos: "2",
        unidadesPorBulto: "96",
        unidadesTotales: "8.00 DOC",
      },
    ]);
    expect(lines[0]!.unidadesPorBulto).toBe("48");
    expect(lines[0]!.unidadesTotales).toBe("96");
  });

  it("packing list: misma ref con bultos + reempaque → consolida piezas", () => {
    const lines = postProcessAldeGptTerraLines([
      {
        referencia: "11-G331",
        descripcion: "PANTALON P/SRA",
        bultos: "2",
        unidadesTotales: "9 DOC",
      },
      {
        referencia: "11-G331",
        descripcion: "PANTALON P/SRA",
        bultos: "",
        unidadesTotales: "6",
        reempaque: true,
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.reempaque).toBe(false);
    expect(lines[0]!.bultos).toBe("2");
    expect(lines[0]!.unidadesTotales).toBe("114");
    expect(lines[0]!.unidadesPorBulto).toBe("57");
  });

  it("Tango: reempaque con peso 0.73 y cantidad 0(1) se detecta", () => {
    const lines = postProcessAldeGptTerraLines([
      {
        referencia: "DD32520/6",
        descripcion: "Jeans p/Dama Straight Fit",
        bultos: "",
        cantidadFactura: "0 (1)",
        pesoTotalKg: "0.73",
        reempaque: true,
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.reempaque).toBe(true);
    expect(lines[0]!.bultos).toBe("0");
    expect(lines[0]!.unidadesTotales).toBe("1");
    expect(lines[0]!.pesoTotalKg).toBe("0.73");
  });

  it("Tango: DD32520/6 bultos + reempaque → suma bultos, peso y piezas", () => {
    const lines = postProcessAldeGptTerraLines([
      {
        referencia: "DD32520/6",
        descripcion: "Jeans p/Dama Straight Fit",
        bultos: "7",
        cantidadFactura: "28 (11)",
        pesoTotalKg: "253.02",
        reempaque: false,
      },
      {
        referencia: "DD32520/6",
        descripcion: "Jeans p/Dama Straight Fit",
        bultos: "",
        cantidadFactura: "0 (1)",
        pesoTotalKg: "0.73",
        reempaque: true,
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.reempaque).toBe(false);
    expect(lines[0]!.bultos).toBe("7");
    expect(lines[0]!.unidadesTotales).toBe("348");
    expect(lines[0]!.pesoTotalKg).toBe("253.75");
  });

  it("Tango: DD32520/6 con 3 pesos (factura completa) → 255.94 exacto", () => {
    const lines = postProcessAldeGptTerraLines([
      {
        referencia: "DD32520/6",
        bultos: "7",
        cantidadFactura: "28 (11)",
        pesoTotalKg: "253.02",
        reempaque: false,
      },
      {
        referencia: "DD32520/6",
        bultos: "",
        cantidadFactura: "0 (3)",
        pesoTotalKg: "2.19",
        reempaque: true,
      },
      {
        referencia: "DD32520/6",
        bultos: "",
        cantidadFactura: "0 (1)",
        pesoTotalKg: "0.73",
        reempaque: true,
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.bultos).toBe("7");
    expect(lines[0]!.unidadesTotales).toBe("351");
    expect(lines[0]!.pesoTotalKg).toBe("255.94");
    expect(lines[0]!.reempaque).toBe(false);
  });

  it("reempaques sin pareja de bultos quedan como reempaque", () => {
    const lines = postProcessAldeGptTerraLines([
      {
        referencia: "DD32527/10",
        bultos: "",
        cantidadFactura: "0 (2)",
        pesoTotalKg: "1.67",
        reempaque: true,
      },
      {
        referencia: "DD32527/11",
        bultos: "",
        cantidadFactura: "0 (2)",
        pesoTotalKg: "1.66",
        reempaque: true,
      },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.reempaque).toBe(true);
    expect(lines[1]!.reempaque).toBe(true);
    expect(lines[0]!.bultos).toBe("0");
    expect(lines[0]!.unidadesTotales).toBe("2");
  });

  it("311 piezas / 6 bultos (no entero) → und 48 tot 311", () => {
    const lines = postProcessAldeGptTerraLines([
      {
        referencia: "A 49313",
        descripcion: "PANTALONES",
        bultos: "6",
        unidadesTotales: "311",
      },
    ]);
    expect(lines[0]!.unidadesPorBulto).toBe("48");
    expect(lines[0]!.unidadesTotales).toBe("311");
  });

  it("459 piezas / 10 bultos (no entero) → und 48 tot 459", () => {
    const lines = postProcessAldeGptTerraLines([
      {
        referencia: "A 49326",
        descripcion: "PANTALONES",
        bultos: "10",
        unidadesTotales: "459",
      },
    ]);
    expect(lines[0]!.unidadesPorBulto).toBe("48");
    expect(lines[0]!.unidadesTotales).toBe("459");
  });
});

describe("postProcessAldeGptTerraLines reempaque con docenas", () => {
  it("conserva 12 piezas en reempaque con 1/0 DOC y limpia tejido inventado", () => {
    const lines = postProcessAldeGptTerraLines([
      {
        referencia: "GREY-BAG-BACCI",
        descripcion: "BOLSO BACCI CANVAS",
        bultos: "1",
        unidadesTotales: "1 / 0 DOC",
        pesoPorBulto: "21.25",
        tejido: "CANVAS",
      },
      {
        referencia: "BOLSA-CAMBRIDG",
        descripcion: "BOLSO CAMBRIDGE DENIM CANVAS",
        bultos: "0",
        unidadesTotales: "1 / 0 DOC",
        tejido: "DENIM CANVAS",
        composicion: "100% POLIESTER",
      },
      {
        referencia: "LINO-BAG-CAMBR",
        descripcion: "BOLSO CAMBRIDGE YUTE",
        bultos: "0",
        unidadesTotales: "1 / 0 DOC",
        tejido: "YUTE",
        composicion: "100% YUTE",
      },
    ]);
    expect(lines[0]!.reempaque).toBe(false);
    expect(lines[0]!.unidadesPorBulto).toBe("12");
    expect(lines[0]!.tejido).toBe("");

    expect(lines[1]!.reempaque).toBe(true);
    expect(lines[1]!.bultos).toBe("0");
    expect(lines[1]!.unidadesPorBulto).toBe("12");
    expect(lines[1]!.unidadesTotales).toBe("12");
    expect(lines[1]!.tejido).toBe("");

    expect(lines[2]!.reempaque).toBe(true);
    expect(lines[2]!.unidadesPorBulto).toBe("12");
    expect(lines[2]!.tejido).toBe("");
  });

  it("distingue dos reempaques con la misma ref truncada Magaya", () => {
    const lines = postProcessAldeGptTerraLines([
      {
        referencia: "BOLSO-CAMBRID",
        descripcion: "BOLSO CAMBRIDGE DENIM CANVAS",
        bultos: "0",
        unidadesTotales: "1 / 0 DOC",
      },
      {
        referencia: "BOLSO-CAMBRID",
        descripcion: "BOLSO CAMBRIDGE YUTE",
        bultos: "0",
        unidadesTotales: "1 / 0 DOC",
      },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.referencia).toMatch(/DENIM/i);
    expect(lines[1]!.referencia).toMatch(/YUTE/i);
    expect(lines[0]!.referencia).not.toBe(lines[1]!.referencia);
    expect(lines[0]!.reempaque).toBe(true);
    expect(lines[1]!.reempaque).toBe(true);
  });

  it("conserva peso total y bultos exactos de la factura", () => {
    const lines = postProcessAldeGptTerraLines([
      {
        referencia: "A 49345",
        descripcion: "PANTALONES",
        bultos: "12",
        peso: "538.08",
        unidadesTotales: "4 DOC",
      },
      {
        referencia: "A 49346",
        descripcion: "PANTALONES",
        bultos: "12",
        peso: "487.73",
        unidadesTotales: "4/0 DOC",
      },
    ]);
    expect(lines[0]!.bultos).toBe("12");
    expect(lines[0]!.pesoTotalKg).toBe("538.08");
    expect(lines[0]!.unidadesPorBulto).toBe("4");
    expect(lines[0]!.unidadesTotales).toBe("48");
    expect(lines[1]!.bultos).toBe("12");
    expect(lines[1]!.pesoTotalKg).toBe("487.73");
    expect(lines[1]!.unidadesPorBulto).toBe("4");
    expect(lines[1]!.unidadesTotales).toBe("48");
    // peso/b preciso: al × bultos recupera el total (no 487.80 por round-up)
    const pb = parseFloat(String(lines[1]!.pesoPorBulto));
    expect(Math.round(pb * 12 * 100) / 100).toBe(487.73);
  });
});

describe("collectionLineDedupeKey", () => {
  it("separa mismas refs truncadas con distinta descripción", () => {
    const a = collectionLineDedupeKey(
      "BOLSO-CAMBRID",
      "BOLSO CAMBRIDGE DENIM CANVAS",
    );
    const b = collectionLineDedupeKey(
      "BOLSO-CAMBRID",
      "BOLSO CAMBRIDGE YUTE",
    );
    expect(a).not.toBe(b);
  });
});

describe("consolidateTerraLinesByReferencia", () => {
  it("suma varias páginas con la misma ref a 255.94 (no 255.99)", () => {
    const lines = consolidateTerraLinesByReferencia([
      {
        referencia: "DD32520/6",
        bultos: "7",
        unidadesTotales: "347",
        pesoTotalKg: "253.02",
        reempaque: false,
      },
      {
        referencia: "DD32520/6",
        bultos: "0",
        unidadesTotales: "3",
        pesoTotalKg: "2.19",
        reempaque: true,
      },
      {
        referencia: "DD32520/6",
        bultos: "0",
        unidadesTotales: "1",
        pesoTotalKg: "0.73",
        reempaque: true,
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.bultos).toBe("7");
    expect(lines[0]!.unidadesTotales).toBe("351");
    expect(lines[0]!.pesoTotalKg).toBe("255.94");
    expect(lines[0]!.reempaque).toBe(false);
  });
});

describe("factura NASA Zona Libre", () => {
  it("usa Cartons MTR como bultos y no Cant. (piezas)", () => {
    const lines = postProcessAldeGptTerraLines([
      {
        referencia: "36587",
        descripcion: "X-SHOT EXCEL 20PK",
        // Modelo confundió Cant. con bultos:
        bultos: "72",
        cartonsMtr: "2",
        uxe: "36",
        cant: "72",
        reempaque: false,
      },
      {
        nasaReferencia: "DIS-1025-01",
        descripcion: "STITCH PUPPETRONIC",
        cartonsMtr: "12",
        UxE: "1",
        Cant: "12",
      },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.referencia).toBe("36587");
    expect(lines[0]!.bultos).toBe("2");
    expect(lines[0]!.reempaque).toBe(false);
    expect(lines[1]!.referencia).toBe("DIS-1025-01");
    expect(lines[1]!.bultos).toBe("12");
  });

  it("ignora TRASPASO / TRANSPORTE / SUBTOTAL / pie de totales", () => {
    const lines = postProcessAldeGptTerraLines([
      { referencia: "9541", bultos: "1", cartonsMtr: "1" },
      { referencia: "TRASPASO", descripcion: "TRASPASO", bultos: "1", unid: "SERV" },
      {
        referencia: "",
        descripcion: "TRANSPORTE ZL",
        bultos: "1",
        unid: "SERV",
      },
      { referencia: "", descripcion: "SUBTOTAL", bultos: "0" },
      {
        referencia: "",
        descripcion: "Bultos totales 187",
        bultos: "187",
      },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.referencia).toBe("9541");
    expect(lines[0]!.bultos).toBe("1");
  });

  it("isNonProductTerraRow detecta pie y servicios", () => {
    expect(isNonProductTerraRow("TRASPASO", "", "SERV")).toBe(true);
    expect(isNonProductTerraRow("", "Bultos totales", "")).toBe(true);
    expect(isNonProductTerraRow("36587", "X-SHOT", "PZ")).toBe(false);
  });
});

describe("packing KING CARGO CTNS #", () => {
  it("parseCtnsRangeToBultos: 1-23→23, 24-73→50, 164→1", () => {
    expect(parseCtnsRangeToBultos("1-23")).toBe(23);
    expect(parseCtnsRangeToBultos("24-73")).toBe(50);
    expect(parseCtnsRangeToBultos("74-88")).toBe(15);
    expect(parseCtnsRangeToBultos("164")).toBe(1);
    expect(parseCtnsRangeToBultos("")).toBeNull();
  });

  it("convierte rango metido en bultos (parseFloat 1-23 → 1 estaría mal)", () => {
    const lines = postProcessAldeGptTerraLines([
      { referencia: "KFC-1666S", bultos: "1-23", qty: "138" },
      { referencia: "KFC-W3010M", bultos: "24-73", qty: "50" },
    ]);
    expect(lines.find((l) => l.referencia === "KFC-1666S")?.bultos).toBe("23");
    expect(lines.find((l) => l.referencia === "KFC-W3010M")?.bultos).toBe("50");
  });

  it("mismo CTNS compartido: solo la 1ª ref lleva bultos (evita 168 vs 166)", () => {
    const lines = postProcessAldeGptTerraLines([
      { referencia: "KW-M180BT", ctns: "164", bultos: "1" },
      { referencia: "DMH-Z5150BT", ctns: "164", bultos: "1" },
      { referencia: "MVH-S325BT", ctns: "165", bultos: "1" },
      { referencia: "MVH-S235BT", ctns: "165", bultos: "1" },
    ]);
    expect(lines.find((l) => l.referencia === "KW-M180BT")?.bultos).toBe("1");
    expect(lines.find((l) => l.referencia === "DMH-Z5150BT")?.bultos).toBe("0");
    expect(lines.find((l) => l.referencia === "DMH-Z5150BT")?.reempaque).toBe(
      true,
    );
    // Sin rangos previos: primera de cada CTNS gana
    expect(lines.find((l) => l.referencia === "MVH-S325BT")?.bultos).toBe("1");
    expect(lines.find((l) => l.referencia === "MVH-S235BT")?.bultos).toBe("0");
    const sum = lines.reduce(
      (a, l) => a + (parseInt(String(l.bultos ?? "0"), 10) || 0),
      0,
    );
    expect(sum).toBe(2);
  });

  it("OR5085-like: suma de bultos = 166 tras rangos + CTNS compartidos", () => {
    const raw = [
      { codigoOem: "KFC-1666S", ctns: "1-23", qty: "138" },
      { codigoOem: "KFC-W3010M", ctns: "24-73", qty: "50" },
      { codigoOem: "CLUB6520", ctns: "74-88", qty: "60" },
      { codigoOem: "KFC-PS1097", ctns: "89-91", qty: "18" },
      { codigoOem: "KFC-1066S", ctns: "92-93", qty: "24" },
      { codigoOem: "KFC-1366S", ctns: "94-96", qty: "18" },
      { codigoOem: "KFC-PS1397", ctns: "97-99", qty: "18" },
      { codigoOem: "MVH-S325BT", ctns: "100-103", qty: "32" },
      { codigoOem: "KFC-PS6997", ctns: "104-111", qty: "32" },
      { codigoOem: "MVH-S235BT", ctns: "112-115", qty: "32" },
      { codigoOem: "KFC-PS1697", ctns: "116-120", qty: "30" },
      { codigoOem: "DMH-AP6650BT", ctns: "121-131", qty: "88" },
      { codigoOem: "CS-DF620", ctns: "132-148", qty: "102" },
      { codigoOem: "BASSPRONANO", ctns: "149-153", qty: "20" },
      { codigoOem: "STAGE265CF", ctns: "154-163", qty: "40" },
      { codigoOem: "KW-M180BT", ctns: "164", qty: "1" },
      { codigoOem: "DMH-Z5150BT", ctns: "164", qty: "5" },
      { codigoOem: "MVH-S325BT", ctns: "165", qty: "4" },
      { codigoOem: "MVH-S235BT", ctns: "165", qty: "4" },
      { codigoOem: "DMH-AP6650BT", ctns: "166", qty: "6" },
    ];
    const lines = postProcessAldeGptTerraLines(raw);
    const sum = lines.reduce(
      (a, l) => a + (parseInt(String(l.bultos ?? "0"), 10) || 0),
      0,
    );
    expect(sum).toBe(166);
    expect(lines.find((l) => l.referencia === "KFC-1666S")?.bultos).toBe("23");
    expect(lines.find((l) => l.referencia === "KFC-W3010M")?.bultos).toBe("50");
    // 121-131 = 11 + CTNS 166 = 1 → 12
    expect(lines.find((l) => l.referencia === "DMH-AP6650BT")?.bultos).toBe(
      "12",
    );
    // 100-103 = 4; en CTNS 165 ambas ya tenían rango → gana MVH-S235BT
    expect(lines.find((l) => l.referencia === "MVH-S325BT")?.bultos).toBe("4");
    expect(lines.find((l) => l.referencia === "MVH-S235BT")?.bultos).toBe("5");
    expect(lines.find((l) => l.referencia === "KW-M180BT")?.bultos).toBe("1");
    expect(lines.find((l) => l.referencia === "DMH-Z5150BT")?.bultos).toBe("0");
    expect(lines.find((l) => l.referencia === "DMH-Z5150BT")?.reempaque).toBe(
      true,
    );
  });

  it("assignBultosForSharedCtns: sin prior gana la 1ª; con prior gana la última", () => {
    const outFirst = assignBultosForSharedCtns([
      {
        line: { referencia: "KW-M180BT", bultos: "1", reempaque: false },
        ctnsKey: "164",
        ctnsBultos: 1,
      },
      {
        line: { referencia: "DMH-Z5150BT", bultos: "1", reempaque: false },
        ctnsKey: "164",
        ctnsBultos: 1,
      },
    ]);
    expect(outFirst[0]!.bultos).toBe("1");
    expect(outFirst[1]!.bultos).toBe("0");
    expect(outFirst[1]!.reempaque).toBe(true);

    const outLast = assignBultosForSharedCtns([
      {
        line: { referencia: "MVH-S325BT", bultos: "4", reempaque: false },
        ctnsKey: "100-103",
        ctnsBultos: 4,
      },
      {
        line: { referencia: "MVH-S235BT", bultos: "4", reempaque: false },
        ctnsKey: "112-115",
        ctnsBultos: 4,
      },
      {
        line: { referencia: "MVH-S325BT", bultos: "4", reempaque: false },
        ctnsKey: "165",
        ctnsBultos: 1,
      },
      {
        line: { referencia: "MVH-S235BT", bultos: "4", reempaque: false },
        ctnsKey: "165",
        ctnsBultos: 1,
      },
    ]);
    expect(outLast[0]!.bultos).toBe("4");
    expect(outLast[1]!.bultos).toBe("4");
    expect(outLast[2]!.bultos).toBe("0");
    expect(outLast[2]!.reempaque).toBe(true);
    expect(outLast[3]!.bultos).toBe("1");
    expect(outLast[3]!.reempaque).toBe(false);
  });

  it("2ª fila sin ctns hereda el cartón compartido (evita 5+5 en MVH)", () => {
    const staged = [
      {
        line: { referencia: "MVH-S325BT", bultos: "4" },
        ctnsKey: "100-103",
        ctnsBultos: 4,
      },
      {
        line: { referencia: "MVH-S235BT", bultos: "4" },
        ctnsKey: "112-115",
        ctnsBultos: 4,
      },
      {
        line: { referencia: "MVH-S325BT", bultos: "4" },
        ctnsKey: "165",
        ctnsBultos: 1,
      },
      {
        line: { referencia: "MVH-S235BT", bultos: "4" }, // QTY, sin ctns
        ctnsKey: null,
        ctnsBultos: null,
      },
    ];
    inheritAdjacentSharedCtns(staged);
    expect(staged[3]!.ctnsKey).toBe("165");
    expect(staged[3]!.ctnsBultos).toBe(1);
    const lines = consolidateTerraLinesByReferencia(
      assignBultosForSharedCtns(staged),
    );
    expect(lines.find((l) => l.referencia === "MVH-S325BT")?.bultos).toBe("4");
    expect(lines.find((l) => l.referencia === "MVH-S235BT")?.bultos).toBe("5");
  });

  it("continuaciones: defer + finalize una sola vez → suma 166", () => {
    const pass1 = postProcessAldeGptTerraLines(
      [
        { codigoOem: "KFC-1666S", ctns: "1-23", qty: "138" },
        { codigoOem: "KFC-W3010M", ctns: "24-73", qty: "50" },
        { codigoOem: "CLUB6520", ctns: "74-88", qty: "60" },
        { codigoOem: "KFC-PS1097", ctns: "89-91", qty: "18" },
        { codigoOem: "KFC-1066S", ctns: "92-93", qty: "24" },
        { codigoOem: "KFC-1366S", ctns: "94-96", qty: "18" },
        { codigoOem: "KFC-PS1397", ctns: "97-99", qty: "18" },
        { codigoOem: "MVH-S325BT", ctns: "100-103", qty: "32" },
        { codigoOem: "KFC-PS6997", ctns: "104-111", qty: "32" },
        { codigoOem: "MVH-S235BT", ctns: "112-115", qty: "32" },
        { codigoOem: "KFC-PS1697", ctns: "116-120", qty: "30" },
        { codigoOem: "DMH-AP6650BT", ctns: "121-131", qty: "88" },
        { codigoOem: "CS-DF620", ctns: "132-148", qty: "102" },
        { codigoOem: "BASSPRONANO", ctns: "149-153", qty: "20" },
        { codigoOem: "STAGE265CF", ctns: "154-163", qty: "40" },
      ],
      { deferFinalize: true },
    );
    const pass2 = postProcessAldeGptTerraLines(
      [
        { codigoOem: "KW-M180BT", ctns: "164", qty: "1" },
        { codigoOem: "DMH-Z5150BT", qty: "5", bultos: "1" }, // sin ctns
        { codigoOem: "MVH-S325BT", ctns: "165", qty: "4" },
        { codigoOem: "MVH-S235BT", qty: "4", bultos: "4" }, // QTY, sin ctns
        { codigoOem: "DMH-AP6650BT", ctns: "166", qty: "6" },
      ],
      { deferFinalize: true },
    );
    const lines = finalizeAldeGptTerraLines([...pass1, ...pass2]);
    const sum = lines.reduce(
      (a, l) => a + (parseInt(String(l.bultos ?? "0"), 10) || 0),
      0,
    );
    expect(sum).toBe(166);
    expect(lines.find((l) => l.referencia === "MVH-S325BT")?.bultos).toBe("4");
    expect(lines.find((l) => l.referencia === "MVH-S235BT")?.bultos).toBe("5");
    expect(lines.find((l) => l.referencia === "DMH-AP6650BT")?.bultos).toBe(
      "12",
    );
    expect(lines.find((l) => l.referencia === "KW-M180BT")?.bultos).toBe("1");
    expect(lines.find((l) => l.referencia === "DMH-Z5150BT")?.bultos).toBe("0");
  });
});

describe("packing BASH CORP Artículo + Bultos", () => {
  it("joinBashArticuloReferencia une líneas del Artículo", () => {
    expect(joinBashArticuloReferencia("PL-88801-BGE", "MIC")).toBe(
      "PL-88801-BGE MIC",
    );
    expect(joinBashArticuloReferencia("PL-88803-BLK S", "PU")).toBe(
      "PL-88803-BLK S PU",
    );
    expect(joinBashArticuloReferencia("PL-88801-BGE MIC", "MIC")).toBe(
      "PL-88801-BGE MIC",
    );
  });

  it("resolveBashPackingBultos: Empaque/Cantidad → Bultos reales", () => {
    expect(
      resolveBashPackingBultos({
        bultos: "12",
        empaque: "12",
        cantidad: "12.00",
      }),
    ).toBe(1);
    expect(
      resolveBashPackingBultos({
        bultos: "12",
        empaque: "12",
        cantidad: "24.00",
      }),
    ).toBe(2);
    expect(
      resolveBashPackingBultos({
        bultos: "3",
        empaque: "3",
        cantidad: "3.00",
      }),
    ).toBe(1);
    expect(
      resolveBashPackingBultos({
        bultos: "2",
        empaque: "12",
        cantidad: "24.00",
      }),
    ).toBe(2);
    expect(
      resolveBashPackingBultos({
        bultos: "",
        empaque: "24",
        cantidad: "48.00",
      }),
    ).toBe(2);
  });

  it("postProcess: Artículo multilínea + no usa Empaque como bultos", () => {
    const lines = postProcessAldeGptTerraLines([
      {
        articulo: "PL-88801-BGE",
        articuloLine2: "MIC",
        descripcion: "ZAPATO DE TACON P/ DAMA 35-40",
        empaque: "12",
        um: "PAR",
        cantidad: "12.00",
        bultos: "12", // confusión Empaque→Bultos
        peso: "6.80",
      },
      {
        referencia: "PL-37901-BGE S PU",
        empaque: "12",
        um: "PAR",
        cantidad: "24.00",
        bultos: "12",
        peso: "20.40",
      },
      {
        articulo: "MT10713L",
        empaque: "3",
        um: "DOC",
        cantidad: "3.00",
        bultos: "3",
        peso: "15.60",
      },
    ]);
    expect(lines.find((l) => l.referencia === "PL-88801-BGE MIC")?.bultos).toBe(
      "1",
    );
    expect(lines.find((l) => l.referencia === "PL-37901-BGE S PU")?.bultos).toBe(
      "2",
    );
    const mt = lines.find((l) => l.referencia === "MT10713L");
    expect(mt?.bultos).toBe("1");
    expect(mt?.unidadesTotales).toBe("36");
    expect(mt?.reempaque).toBe(false);
  });

  it("OR5092-like: misma ref dos veces suma bultos; total 55", () => {
    const raw = [
      { referencia: "MT10713L", bultos: "1", empaque: "3", cantidad: "3.00", um: "DOC" },
      { referencia: "MT10714L", bultos: "2", empaque: "3", cantidad: "6.00", um: "DOC" },
      { referencia: "MT9412L", bultos: "1", empaque: "3", cantidad: "3.00", um: "PAR" },
      { referencia: "MT9451L", bultos: "1", empaque: "3", cantidad: "3.00", um: "PAR" },
      {
        articulo: "PL-88801-BGE",
        articuloLine2: "MIC",
        bultos: "1",
        empaque: "12",
        cantidad: "12.00",
        um: "PAR",
      },
      { referencia: "PL-88801-BLK MIC", bultos: "1", empaque: "12", cantidad: "12.00", um: "PAR" },
      { referencia: "PL-88801-TAN MIC", bultos: "1", empaque: "12", cantidad: "12.00", um: "PAR" },
      { referencia: "PL-88802-BLK CROCO", bultos: "1", empaque: "12", cantidad: "12.00", um: "PAR" },
      { referencia: "PL-88803-BLK S PU", bultos: "1", empaque: "12", cantidad: "12.00", um: "PAR" },
      { referencia: "PL-88803-OFF WHT S PU", bultos: "1", empaque: "12", cantidad: "12.00", um: "PAR" },
      { referencia: "PL-37901-BGE S PU", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      { referencia: "PL-37901-BLK S PU", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      { referencia: "PL-37901-RED S PU", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      { referencia: "PL-37902-BGE PAT", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      { referencia: "PL-37902-BLK MIC", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      { referencia: "PL-37902-BLK PAT", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      { referencia: "PL-37902-TAN MIC", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      {
        articulo: "PL-88801-BGE",
        articuloLine2: "MIC",
        bultos: "2",
        empaque: "12",
        cantidad: "24.00",
        um: "PAR",
      },
      { referencia: "PL-88801-BLK MIC", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      { referencia: "PL-88801-TAN MIC", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      { referencia: "PL-88802-BLK CROCO", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      { referencia: "PL-88802-TAN CROCO", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      { referencia: "PL-88803-BLK S PU", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      { referencia: "PL-25307-BGD", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      { referencia: "PL-25307-BGE", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      { referencia: "PL-25307-BLK", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      { referencia: "PL-62207-SURT", bultos: "2", empaque: "24", cantidad: "48.00", um: "PAR" },
      { referencia: "PL-31711-BGE", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      { referencia: "PL-31711-BLK", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      { referencia: "PL-31711-COF", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      { referencia: "PL-80227-SURT", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
      { referencia: "PL-84412-SURT", bultos: "2", empaque: "12", cantidad: "24.00", um: "PAR" },
    ];
    const lines = postProcessAldeGptTerraLines(raw);
    const sum = lines.reduce(
      (a, l) => a + (parseInt(String(l.bultos ?? "0"), 10) || 0),
      0,
    );
    expect(sum).toBe(55);
    expect(lines.find((l) => l.referencia === "PL-88801-BGE MIC")?.bultos).toBe(
      "3",
    ); // 1+2 consolidado
    const refsOnly = toRefsBultosOnlyTerraLines(lines);
    expect(
      refsOnly.reduce(
        (a, l) => a + (parseInt(String(l.bultos ?? "0"), 10) || 0),
        0,
      ),
    ).toBe(55);
    expect(refsOnly.every((l) => String(l.referencia ?? "").length > 0)).toBe(
      true,
    );
  });
});
