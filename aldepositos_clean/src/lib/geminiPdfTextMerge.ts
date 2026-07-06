import { extractProductCodesInOrder } from "@/lib/geminiChunkCoverage";
import {
  countPdfPagesInText,
  detectPdfTotalPagesFromFooter,
  formatPdfPageBlock,
  joinPdfPageBlocks,
} from "@/lib/geminiPdfPageText";

export type PdfTextPickSource = "client" | "server" | "merged" | "none";

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

function scorePageBody(body: string): number {
  const t = String(body ?? "").trim();
  if (!t) return 0;
  return extractProductCodesInOrder(t).length * 10_000 + t.length;
}

/** Extrae bloques por número de página desde marcadores --- PÁGINA N ---. */
export function parsePdfPageBlocks(text: string): Map<number, string> {
  const map = new Map<number, string>();
  const t = String(text ?? "");
  const re = /---\s*PÁGINA\s+(\d+)\s*---\n([\s\S]*?)(?=\n---\s*PÁGINA\s+\d+\s*---|$)/gi;
  for (const m of t.matchAll(re)) {
    const num = Number(m[1]);
    const body = String(m[2] ?? "").trim();
    if (Number.isFinite(num) && num > 0 && body) {
      const prev = map.get(num);
      if (!prev || scorePageBody(body) > scorePageBody(prev)) {
        map.set(num, body);
      }
    }
  }
  return map;
}

/**
 * Fusiona texto PDF cliente + servidor: por cada página conserva el bloque más rico
 * (más códigos de producto). Evita perder página 2 cuando el navegador solo extrajo página 1.
 */
export function mergePdfTextsForExtraction(
  clientText?: string | null,
  serverText?: string | null,
): PdfTextPickResult {
  const client = String(clientText ?? "").trim();
  const server = String(serverText ?? "").trim();

  if (!client && !server) return { text: null, source: "none" };
  if (!client) return { text: server, source: "server" };
  if (!server) return { text: client, source: "client" };

  const clientPages = parsePdfPageBlocks(client);
  const serverPages = parsePdfPageBlocks(server);

  if (clientPages.size === 0 && serverPages.size === 0) {
    return pickBestPdfTextForExtraction(client, server);
  }

  const pageNums = [
    ...new Set([...clientPages.keys(), ...serverPages.keys()]),
  ].sort((a, b) => a - b);

  const mergedBlocks: string[] = [];
  for (const num of pageNums) {
    const c = clientPages.get(num) ?? "";
    const s = serverPages.get(num) ?? "";
    const body = scorePageBody(s) >= scorePageBody(c) ? s : c;
    if (body) mergedBlocks.push(formatPdfPageBlock(num, body));
  }

  const merged = joinPdfPageBlocks(mergedBlocks);
  if (!merged) return pickBestPdfTextForExtraction(client, server);

  const usedBoth = clientPages.size > 0 && serverPages.size > 0;
  return {
    text: merged,
    source: usedBoth ? "merged" : serverPages.size > 0 ? "server" : "client",
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
