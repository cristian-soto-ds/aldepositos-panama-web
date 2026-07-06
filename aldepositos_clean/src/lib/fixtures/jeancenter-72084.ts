import { joinPdfPageBlocks, formatPdfPageBlock } from "@/lib/geminiPdfPageText";

export const JEANCENTER_72084_CODES = [
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
  "10869-67084",
  "10901-67035",
  "10901-67053",
  "10901-67085",
];

export const JEANCENTER_72084_BULTOS = [
  3, 10, 10, 10, 3, 7, 9, 9, 6, 9, 9, 9, 9, 9,
];

function multilineRow(code: string, bultos: number, multilinePeso = false): string {
  if (!multilinePeso) {
    return `${code} JEANS SKINNY DAMA MOST WANTED ${bultos} 432 PZA 26.0000 9.5000`;
  }
  return `${code} JEANS SKINNY DAMA MOST WANTED\nComp.: 98% ALGODON\nPeso B: 26.0000\n${bultos} 432 PZA`;
}

/** Texto aplanado realista factura JEANCENTER 72084 (2 páginas, 14 refs, 112 bultos). */
export function buildJeancenter72084Text(multilinePeso = false): string {
  const page1 = JEANCENTER_72084_CODES.slice(0, 10)
    .map((c, i) => multilineRow(c, JEANCENTER_72084_BULTOS[i]!, multilinePeso))
    .join("\n");
  const page2 = JEANCENTER_72084_CODES.slice(10)
    .map((c, i) => multilineRow(c, JEANCENTER_72084_BULTOS[i + 10]!, multilinePeso))
    .join("\n");
  return joinPdfPageBlocks([
    formatPdfPageBlock(
      1,
      `JEANCENTER CORP FACTURA Codigo Descripcion Bultos Cantidad Peso\n${page1}\nNo. de Cartones: 112 Págs: 1 / 2`,
    ),
    formatPdfPageBlock(2, page2),
  ]);
}

export const JEANCENTER_72084_TEXT = buildJeancenter72084Text(false);
export const JEANCENTER_72084_MULTILINE_TEXT = buildJeancenter72084Text(true);
