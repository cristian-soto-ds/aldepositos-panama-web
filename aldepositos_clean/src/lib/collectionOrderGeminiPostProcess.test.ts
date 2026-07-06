import { describe, expect, it } from "vitest";
import {
  postProcessGeminiExtractedLines,
  remapWeightMisfiledAsWidth,
} from "@/lib/collectionOrderGeminiPostProcess";

describe("remapWeightMisfiledAsWidth", () => {
  it("mueve peso mal ubicado en w a pesoPorBulto", () => {
    const out = remapWeightMisfiledAsWidth({
      referencia: "10133-67606",
      w: "26",
    });
    expect(out.pesoPorBulto).toBe("26");
    expect(out.w).toBe("");
  });

  it("no toca medidas reales con l o h presentes", () => {
    const out = remapWeightMisfiledAsWidth({
      referencia: "X",
      l: "50",
      w: "26",
      h: "30",
    });
    expect(out.pesoPorBulto).toBeUndefined();
    expect(out.w).toBe("26");
  });
});

describe("postProcessGeminiExtractedLines", () => {
  it("corrige peso en w tras post-proceso", () => {
    const out = postProcessGeminiExtractedLines([
      { referencia: "10133-67606", w: "30", bultos: "3" },
    ]);
    expect(out[0]?.pesoPorBulto).toBe("30.00");
    expect(out[0]?.w).toBe("");
  });
});
