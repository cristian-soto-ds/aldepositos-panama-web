import { describe, expect, it } from "vitest";
import {
  mergePdfTextsForExtraction,
  parsePdfPageBlocks,
  pickBestPdfTextForExtraction,
} from "@/lib/geminiPdfTextMerge";
import { formatPdfPageBlock, joinPdfPageBlocks } from "@/lib/geminiPdfPageText";
import { splitTextIntoDocumentChunks } from "@/lib/geminiCollectionOrderChunkedExtract";

const PAGE1_CODES = [
  "10133-67606",
  "10136-54133-BLK",
  "10136-57410-D-BLK",
  "10136-57828-B-BLK",
  "10749-66065",
  "10833-67677",
  "10849-67658",
  "10849-67686",
  "10851-67687",
  "10869-67034",
];
const PAGE1_BULTOS = [3, 10, 10, 10, 3, 7, 9, 9, 6, 9];

const PAGE2_CODES = ["10869-67084", "10901-67035", "10901-67053", "10901-67085"];
const PAGE2_BULTOS = [9, 9, 9, 9];

function jeancenterRow(code: string, bultos: number): string {
  return `${code} JEANS SKINNY DAMA MOST WANTED ${bultos} 432 PZA 26.0000`;
}

function buildJeancenterPage(codes: string[], bultos: number[]): string {
  return codes.map((c, i) => jeancenterRow(c, bultos[i] ?? 1)).join("\n");
}

const CLIENT_PARTIAL = joinPdfPageBlocks([
  formatPdfPageBlock(1, buildJeancenterPage(PAGE1_CODES.slice(0, 9), PAGE1_BULTOS.slice(0, 9))),
]);

const SERVER_FULL = joinPdfPageBlocks([
  formatPdfPageBlock(
    1,
    `${buildJeancenterPage(PAGE1_CODES, PAGE1_BULTOS)}\nPágs: 1 / 2\nNo. de Cartones: 112`,
  ),
  formatPdfPageBlock(2, `${buildJeancenterPage(PAGE2_CODES, PAGE2_BULTOS)}\nPágs: 2 / 2`),
]);

describe("pickBestPdfTextForExtraction", () => {
  it("prefiere texto servidor con más códigos (página 2)", () => {
    const pick = pickBestPdfTextForExtraction(CLIENT_PARTIAL, SERVER_FULL);
    expect(pick.source).toBe("server");
    expect(pick.text).toBe(SERVER_FULL);
  });
});

describe("mergePdfTextsForExtraction", () => {
  it("fusiona página 1 del cliente con página 2 del servidor", () => {
    const merged = mergePdfTextsForExtraction(CLIENT_PARTIAL, SERVER_FULL);
    expect(merged.source).toBe("merged");
    expect(merged.text).toContain("10901-67085");
    expect(merged.text).toContain("10133-67606");

    const pages = parsePdfPageBlocks(merged.text ?? "");
    expect(pages.size).toBe(2);
    expect(pages.get(2)).toContain("10901-67085");
  });

  it("texto fusionado se parte en 2 chunks por página", () => {
    const merged = mergePdfTextsForExtraction(CLIENT_PARTIAL, SERVER_FULL);
    const { chunks, splitByPages } = splitTextIntoDocumentChunks(
      merged.text ?? "",
      38_000,
      2_400,
    );
    expect(splitByPages).toBe(true);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toContain("10901-67085");
  });
});

describe("parsePdfPageBlocks", () => {
  it("lee bloques numerados de ambas páginas", () => {
    const pages = parsePdfPageBlocks(SERVER_FULL);
    expect(pages.get(1)).toContain("10133-67606");
    expect(pages.get(2)).toContain("10901-67085");
  });
});
