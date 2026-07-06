import { describe, expect, it } from "vitest";
import { parseTabularRowsFromPdfText } from "@/lib/geminiTabularInvoiceParse";
import { formatPdfPageBlock, joinPdfPageBlocks } from "@/lib/geminiPdfPageText";

const PUNTOMODA_TEXT = joinPdfPageBlocks([
  formatPdfPageBlock(
    1,
    `Referencia Descripcion Bultos Cantidad Peso
B-21496XM SUETER DAMA 2 4.0000 DOZ 18.5
B-21497XL BLUSA DAMA 1 2.0000 DOZ 12.0`,
  ),
]);

describe("geminiTabularInvoiceParse", () => {
  it("extrae filas puntomoda con bultos y unidades", () => {
    const rows = parseTabularRowsFromPdfText(PUNTOMODA_TEXT);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.referencia).toBe("B-21496XM");
    expect(rows[0]?.bultos).toBe("2");
    expect(rows[0]?.unidadesTotales).toBe("48");
  });
});
