import { describe, expect, it } from "vitest";
import { splitTextByPdfPages } from "@/lib/geminiPdfPageText";
import { splitTextIntoDocumentChunks } from "@/lib/geminiCollectionOrderChunkedExtract";

describe("splitTextByPdfPages", () => {
  it("parte con un solo pie Págs: 1 / 2", () => {
    const text = `JEANCENTER FACTURA
10133-67606 JEANS 3 432 PZA
Págs: 1 / 2
10869-67084 JEANS 9 432 PZA
10901-67085 JEANS 9 432 PZA
Págs: 2 / 2`;

    const chunks = splitTextByPdfPages(text);
    expect(chunks).not.toBeNull();
    expect(chunks!.length).toBe(2);
    expect(chunks![0]).toMatch(/PÁGINA 1/i);
    expect(chunks![0]).toContain("10133-67606");
    expect(chunks![1]).toMatch(/PÁGINA 2/i);
    expect(chunks![1]).toContain("10901-67085");

    const split = splitTextIntoDocumentChunks(text, 38_000, 2_400);
    expect(split.splitByPages).toBe(true);
    expect(split.chunks).toHaveLength(2);
  });
});
