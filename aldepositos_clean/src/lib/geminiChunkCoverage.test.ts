import { describe, expect, it } from "vitest";
import {
  estimateProductCodesInChunk,
  extractBultosNearCode,
  extractProductCodesInOrder,
  isChunkLikelyIncomplete,
  reconcileGeminiLinesWithPdfText,
} from "@/lib/geminiChunkCoverage";
import {
  mergeGeminiLinesInOrder,
  splitTextIntoDocumentChunks,
} from "@/lib/geminiCollectionOrderChunkedExtract";
import { formatPdfPageBlock, joinPdfPageBlocks } from "@/lib/geminiPdfPageText";

const JEANCENTER_PAGE1 = [
  "10133-67606 JEANS SKINNY ROTOS 3",
  "10136-54133-BLK JEANS SKINNY 10",
  "10136-57410-D-BLK JEANS SKINNY 10",
  "10136-57828-B-BLK JEANS SKINNY 10",
  "10749-66065 JEANS SKINNY 3",
  "10833-67677 JEANS SKINNY 7",
  "10849-67658 JEANS SKINNY 9",
  "10849-67686 JEANS SKINNY 9",
  "10851-67687 JEANS SKINNY 6",
  "10869-67034 JEANS SKINNY DAMA 9",
].join("\n");

const JEANCENTER_PAGE2 = [
  "10869-67084 JEANS SKINNY DAMA 9",
  "10901-67035 JEANS SKINNY DAMA 9",
  "10901-67053 JEANS SKINNY DAMA 9",
  "10901-67085 JEANS SKINNY DAMA 9",
].join("\n");

const JEANCENTER_TWO_PAGES = joinPdfPageBlocks([
  formatPdfPageBlock(1, JEANCENTER_PAGE1),
  formatPdfPageBlock(2, JEANCENTER_PAGE2),
]);

describe("splitTextIntoDocumentChunks", () => {
  it("divide factura JEANCENTER de 2 páginas por marcadores de página", () => {
    const { chunks, splitByPages } = splitTextIntoDocumentChunks(
      JEANCENTER_TWO_PAGES,
      38_000,
      2_400,
    );
    expect(splitByPages).toBe(true);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatch(/PÁGINA 1/i);
    expect(chunks[1]).toMatch(/PÁGINA 2/i);
    expect(chunks[0]).toContain("10133-67606");
    expect(chunks[1]).toContain("10901-67085");
  });
});

describe("mergeGeminiLinesInOrder", () => {
  it("preserva el orden sin deduplicar", () => {
    const merged = mergeGeminiLinesInOrder([
      { referencia: "10133-67606", bultos: "3" },
      { referencia: "10901-67085", bultos: "9" },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.referencia).toBe("10133-67606");
    expect(merged[1]?.referencia).toBe("10901-67085");
  });
});

describe("geminiChunkCoverage", () => {
  it("cuenta 14 códigos JEANCENTER en muestra de 2 páginas", () => {
    expect(estimateProductCodesInChunk(JEANCENTER_TWO_PAGES)).toBe(14);
    expect(estimateProductCodesInChunk(JEANCENTER_PAGE2)).toBe(4);
  });

  it("detecta fragmento incompleto cuando faltan filas", () => {
    const chunk = formatPdfPageBlock(2, JEANCENTER_PAGE2);
    expect(
      isChunkLikelyIncomplete(chunk, [{ referencia: "10869-67084", bultos: "9" }]),
    ).toBe(true);
    expect(
      isChunkLikelyIncomplete(chunk, [
        { referencia: "10869-67084", bultos: "9" },
        { referencia: "10901-67035", bultos: "9" },
        { referencia: "10901-67053", bultos: "9" },
      ]),
    ).toBe(true);
    expect(
      isChunkLikelyIncomplete(chunk, [
        { referencia: "10869-67084", bultos: "9" },
        { referencia: "10901-67035", bultos: "9" },
        { referencia: "10901-67053", bultos: "9" },
        { referencia: "10901-67085", bultos: "9" },
      ]),
    ).toBe(false);
  });

  it("reconcileGeminiLinesWithPdfText añade referencias faltantes del texto", () => {
    const partial = [
      { referencia: "10133-67606", bultos: "3", descripcion: "JEANS" },
      { referencia: "10869-67034", bultos: "9", descripcion: "JEANS" },
    ];
    const merged = reconcileGeminiLinesWithPdfText(JEANCENTER_TWO_PAGES, partial, {
      fillRefsBultosFromPdf: true,
    });
    expect(merged.length).toBe(14);
    expect(merged.map((l) => l.referencia?.toUpperCase())).toContain("10901-67085");
    expect(merged[0]?.referencia).toBe("10133-67606");
    expect(merged[merged.length - 1]?.referencia?.toUpperCase()).toBe("10901-67085");
  });

  it("extractBultosNearCode lee bultos junto al código", () => {
    const snippet = "10901-67035 JEANS SKINNY DAMA MOST WANTED 9 432 PZA";
    expect(extractBultosNearCode(snippet, "10901-67035")).toBe("9");
  });
});
