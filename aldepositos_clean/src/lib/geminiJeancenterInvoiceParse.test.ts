import { describe, expect, it } from "vitest";
import {
  isJeancenterInvoiceText,
  parseJeancenterRowsFromPdfText,
} from "@/lib/geminiJeancenterInvoiceParse";
import {
  JEANCENTER_72084_CODES,
  JEANCENTER_72084_MULTILINE_TEXT,
  JEANCENTER_72084_TEXT,
} from "@/lib/fixtures/jeancenter-72084";
import { joinPdfPageBlocks, formatPdfPageBlock } from "@/lib/geminiPdfPageText";
import { sumBultosInLines } from "@/lib/geminiChunkCoverage";
import { reconcileGeminiLinesWithPdfText } from "@/lib/geminiChunkCoverage";
import { finalizeDocumentGeminiLines } from "@/lib/geminiDocumentExtract";

const ALL_BULTOS = [3, 10, 10, 10, 3, 7, 9, 9, 6, 9, 9, 9, 9, 9];

function row(code: string, bultos: number): string {
  return `${code} JEANS SKINNY DAMA MOST WANTED ${bultos} 432 PZA 26.0000 9.5000`;
}

const INVOICE_TEXT = joinPdfPageBlocks([
  formatPdfPageBlock(
    1,
    `JEANCENTER CORP FACTURA Codigo Bultos\n${JEANCENTER_72084_CODES.slice(0, 10)
      .map((c, i) => row(c, ALL_BULTOS[i]!))
      .join("\n")}\nNo. de Cartones: 112 Págs: 1 / 2`,
  ),
  formatPdfPageBlock(
    2,
    JEANCENTER_72084_CODES.slice(10)
      .map((c, i) => row(c, ALL_BULTOS[i + 10]!))
      .join("\n"),
  ),
]);

describe("geminiJeancenterInvoiceParse", () => {
  it("detecta factura JEANCENTER por códigos sin header", () => {
    const codesOnly = JEANCENTER_72084_CODES.join("\n");
    expect(isJeancenterInvoiceText(codesOnly)).toBe(true);
  });

  it("detecta factura JEANCENTER", () => {
    expect(isJeancenterInvoiceText(INVOICE_TEXT)).toBe(true);
  });

  it("extrae 14 referencias y suma 112 bultos", () => {
    const rows = parseJeancenterRowsFromPdfText(INVOICE_TEXT);
    expect(rows).toHaveLength(14);
    expect(rows.map((r) => r.referencia)).toEqual(JEANCENTER_72084_CODES);
    const sum = rows.reduce((a, r) => a + Number(r.bultos), 0);
    expect(sum).toBe(112);
  });

  it("extrae descripción, unidades y peso por fila", () => {
    const rows = parseJeancenterRowsFromPdfText(INVOICE_TEXT);
    expect(rows[0]?.descripcion).toContain("JEANS SKINNY");
    expect(rows[0]?.bultos).toBe("3");
    expect(rows[0]?.unidadesTotales).toBe("432");
    expect(rows[0]?.pesoPorBulto).toBe("26");
    expect(rows[0]?.unidadesPorBulto).toBe("144");
    expect(rows[0]?.modelo).toBe("MOST WANTED");
    expect(rows[0]?.genero).toBe("DAMA");
  });

  it("fixture 72084: 14 refs, 112 bultos, campos completos", () => {
    const rows = parseJeancenterRowsFromPdfText(JEANCENTER_72084_TEXT);
    expect(rows).toHaveLength(14);
    expect(rows.reduce((a, r) => a + Number(r.bultos), 0)).toBe(112);
    for (const r of rows) {
      expect(r.bultos).toBeTruthy();
      expect(r.descripcion).toContain("JEANS");
      expect(r.pesoPorBulto).toBe("26");
      expect(r.unidadesPorBulto).toBeTruthy();
    }
  });

  it("fixture 72084 multilínea Peso B: extrae peso y bultos", () => {
    const rows = parseJeancenterRowsFromPdfText(JEANCENTER_72084_MULTILINE_TEXT);
    expect(rows).toHaveLength(14);
    expect(rows[0]?.pesoPorBulto).toBe("26");
    expect(rows[0]?.bultos).toBe("3");
    expect(rows.reduce((a, r) => a + Number(r.bultos), 0)).toBe(112);
  });

  it("reconcile completa campos faltantes desde PDF", () => {
    const partial = JEANCENTER_72084_CODES.map((c) => ({ referencia: c, w: "26" }));
    const merged = reconcileGeminiLinesWithPdfText(JEANCENTER_72084_TEXT, partial, {
      fillRefsBultosFromPdf: true,
    });
    expect(merged).toHaveLength(14);
    expect(sumBultosInLines(merged)).toBe(112);
    expect(merged[0]?.descripcion).toContain("JEANS SKINNY");
    expect(merged[0]?.bultos).toBe("3");
    expect(merged[0]?.pesoPorBulto).toBe("26");
  });

  it("finalize con Gemini vacío completa desde PDF", () => {
    const out = finalizeDocumentGeminiLines([], {
      pdfText: JEANCENTER_72084_TEXT,
      extractMode: "full",
    });
    expect(out.lines).toHaveLength(14);
    expect(sumBultosInLines(out.lines)).toBe(112);
    expect(out.validation?.extractionIncomplete).toBe(false);
    expect(out.lines[0]?.descripcion).toContain("JEANS");
    expect(out.lines[0]?.bultos).toBe("3");
  });

  it("finalize conserva descripción Gemini si ya es buena", () => {
    const gemini = [
      {
        referencia: "10133-67606",
        descripcion: "JEANS PREMIUM CUSTOM",
        bultos: "3",
      },
    ];
    const out = finalizeDocumentGeminiLines(gemini, {
      pdfText: JEANCENTER_72084_TEXT,
      extractMode: "full",
    });
    expect(out.lines[0]?.descripcion).toBe("JEANS PREMIUM CUSTOM");
    expect(out.lines[0]?.pesoPorBulto).toBe("26.00");
  });

  it("reconcile completa Gemini parcial a 14 filas conservando datos Gemini", () => {
    const partial = JEANCENTER_72084_CODES.slice(0, 9).map((c, i) => ({
      referencia: c,
      bultos: String(ALL_BULTOS[i]),
      descripcion: "JEANS",
    }));
    const merged = reconcileGeminiLinesWithPdfText(INVOICE_TEXT, partial, {
      fillRefsBultosFromPdf: true,
    });
    expect(merged).toHaveLength(14);
    expect(sumBultosInLines(merged)).toBe(112);
    expect(merged[0]?.descripcion).toBe("JEANS");
    expect(merged[13]?.referencia).toBe("10901-67085");
    expect(merged[13]?.bultos).toBe("9");
    expect(merged[13]?.descripcion).toContain("JEANS SKINNY");
  });
});
