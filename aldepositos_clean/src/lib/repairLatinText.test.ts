import { describe, expect, it } from "vitest";
import {
  pickBestDecodedText,
  repairLatinText,
} from "@/lib/repairLatinText";

describe("repairLatinText", () => {
  it("deja intacto texto correcto con ñ", () => {
    expect(repairLatinText("FADI NIÑOS")).toBe("FADI NIÑOS");
    expect(repairLatinText("INTRATEX S.A")).toBe("INTRATEX S.A");
  });

  it("corrige mojibake UTF-8 leído como Latin-1 (NIÃ±OS)", () => {
    expect(repairLatinText("FADI NIÃ±OS")).toBe("FADI NIÑOS");
    expect(repairLatinText("NIÃ‘OS")).toBe("NIÑOS");
  });

  it("corrige U+FFFD en NIÑOS (caso tarjeta RA)", () => {
    expect(repairLatinText("INTRATEX S.A — FADI NI\uFFFDOS")).toBe(
      "INTRATEX S.A — FADI NIÑOS",
    );
    expect(repairLatinText("FADI NI\uFFFDOS")).toBe("FADI NIÑOS");
  });

  it("corrige pares mojibake de acentos", () => {
    expect(repairLatinText("JosÃ©")).toBe("José");
    expect(repairLatinText("compaÃ±Ã­a")).toBe("compañía");
  });

  it("pickBestDecodedText prefiere la variante con ñ real", () => {
    const broken = "FADI NI\uFFFDOS";
    const good = "FADI NIÑOS";
    expect(pickBestDecodedText([broken, good])).toBe(good);
  });
});
