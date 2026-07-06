import { describe, expect, it } from "vitest";
import {
  finalizeDocumentGeminiLines,
  shouldUseChunkedPdfExtraction,
} from "@/lib/geminiDocumentExtract";
import { formatPdfPageBlock, joinPdfPageBlocks } from "@/lib/geminiPdfPageText";

const SAMPLE_CODES = [
  "10133-67606",
  "10136-54133-BLK",
  "10901-67085",
].join("\n");

const TWO_PAGES = joinPdfPageBlocks([
  formatPdfPageBlock(1, "10133-67606 3 bultos\n10136-54133-BLK 10"),
  formatPdfPageBlock(2, "10901-67085 9 bultos"),
]);

describe("shouldUseChunkedPdfExtraction", () => {
  it("fragmenta PDF multipágina aunque el texto sea corto", () => {
    expect(shouldUseChunkedPdfExtraction(TWO_PAGES, 14_000)).toBe(true);
  });

  it("fragmenta PDF con varios códigos de producto", () => {
    expect(shouldUseChunkedPdfExtraction(SAMPLE_CODES, 14_000)).toBe(true);
  });
});

describe("finalizeDocumentGeminiLines", () => {
  it("modo completo: conserva campos Gemini y completa refs faltantes del PDF", () => {
    const gemini = [
      {
        referencia: "10133-67606",
        bultos: "3",
        descripcion: "JEANS SKINNY",
        unidadesPorBulto: "46",
      },
    ];
    const out = finalizeDocumentGeminiLines(gemini, {
      pdfText: TWO_PAGES,
      extractMode: "full",
    });
    expect(out.lines.length).toBe(3);
    expect(out.lines[0]?.descripcion).toBe("JEANS SKINNY");
    expect(out.lines.map((l) => l.referencia?.toUpperCase())).toContain("10901-67085");
  });

  it("modo refs-only: no altera salida solo refs+bultos", () => {
    const gemini = [
      {
        referencia: "10133-67606",
        bultos: "3",
        descripcion: "JEANS",
      },
    ];
    const out = finalizeDocumentGeminiLines(gemini, {
      pdfText: TWO_PAGES,
      extractMode: "refsBultosOnly",
    });
    expect(out.lines.every((l) => !l.descripcion)).toBe(true);
    expect(out.lines.length).toBe(3);
  });
});
