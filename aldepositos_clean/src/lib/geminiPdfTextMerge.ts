import { extractProductCodesInOrder } from "@/lib/geminiChunkCoverage";
import {
  countPdfPagesInText,
  detectPdfTotalPagesFromFooter,
} from "@/lib/geminiPdfPageText";

export type PdfTextPickSource = "client" | "server" | "none";

export type PdfTextPickResult = {
  text: string | null;
  source: PdfTextPickSource;
};

function scorePdfText(text: string): {
  codes: number;
  pages: number;
  footerPages: number;
  length: number;
} {
  const t = String(text ?? "").trim();
  return {
    codes: extractProductCodesInOrder(t).length,
    pages: countPdfPagesInText(t),
    footerPages: detectPdfTotalPagesFromFooter(t),
    length: t.length,
  };
}

/**
 * Elige el texto PDF más completo para extracción/reconciliación.
 * Prioriza: más códigos → más páginas → mejor cobertura del pie Págs: N/M → más largo.
 */
export function pickBestPdfTextForExtraction(
  clientText?: string | null,
  serverText?: string | null,
): PdfTextPickResult {
  const client = String(clientText ?? "").trim();
  const server = String(serverText ?? "").trim();

  if (!client && !server) return { text: null, source: "none" };
  if (client && !server) return { text: client, source: "client" };
  if (!client && server) return { text: server, source: "server" };

  const a = scorePdfText(client);
  const b = scorePdfText(server);

  const clientBetter =
    a.codes > b.codes ||
    (a.codes === b.codes && a.pages > b.pages) ||
    (a.codes === b.codes &&
      a.pages === b.pages &&
      a.footerPages >= b.footerPages &&
      a.pages >= a.footerPages &&
      b.pages < b.footerPages) ||
    (a.codes === b.codes &&
      a.pages === b.pages &&
      a.footerPages === b.footerPages &&
      a.length > b.length);

  if (clientBetter) return { text: client, source: "client" };
  return { text: server, source: "server" };
}
