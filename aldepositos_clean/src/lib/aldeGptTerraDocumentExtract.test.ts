import { describe, expect, it } from "vitest";
import {
  collectionLineDedupeKey,
  normalizeJeansDescripcion,
  parseDozenLooseNotation,
  postProcessAldeGptTerraLines,
  rejectTejidoInferredFromProduct,
  sanitizeMagayaOptionalText,
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

  it("packing list: misma ref con bultos vacíos → reempaque y conserva PCS", () => {
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
    expect(lines).toHaveLength(2);
    expect(lines[0]!.reempaque).toBe(false);
    expect(lines[0]!.bultos).toBe("2");
    expect(lines[0]!.unidadesTotales).toBe("108");
    expect(lines[0]!.unidadesPorBulto).toBe("54");
    expect(lines[1]!.reempaque).toBe(true);
    expect(lines[1]!.bultos).toBe("0");
    expect(lines[1]!.unidadesTotales).toBe("6");
    expect(lines[1]!.unidadesPorBulto).toBe("6");
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
