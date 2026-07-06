/** Marcadores de página para fragmentar PDFs multi-página sin cortar filas de tabla. */

export const PDF_PAGE_MARKER_RE = /\n---\s*PÁGINA\s+(\d+)\s*---\n/gi;

export function formatPdfPageBlock(pageNum: number, text: string): string {
  const body = String(text ?? "").trim();
  if (!body) return "";
  return `--- PÁGINA ${pageNum} ---\n${body}`;
}

export function joinPdfPageBlocks(blocks: string[]): string {
  return blocks.filter(Boolean).join("\n\n");
}

export function countPdfPagesInText(text: string): number {
  const matches = String(text ?? "").match(/---\s*PÁGINA\s+\d+\s*---/gi);
  return matches?.length ?? 0;
}

/** Total de páginas según pie «Págs: N / M». */
export function detectPdfTotalPagesFromFooter(text: string): number {
  let max = 0;
  for (const m of String(text ?? "").matchAll(/\bP[aá]gs?\.?\s*:\s*\d+\s*\/\s*(\d+)\b/gi)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/**
 * Si el texto tiene marcadores de página, devuelve un fragmento por página.
 * Si no, intenta partir por pies «Págs: N / M» (facturas JEANCENTER).
 * Si no, null (usar split por tamaño).
 */
export function splitTextByPdfPages(text: string): string[] | null {
  const t = String(text ?? "");
  if (!t.includes("--- PÁGINA ")) {
    return splitTextByPageFooters(t);
  }

  const parts = t.split(/\n?---\s*PÁGINA\s+\d+\s*---\n?/i);
  const chunks: string[] = [];

  const head = parts[0]?.trim();
  if (head) chunks.push(head);

  for (let i = 1; i < parts.length; i++) {
    const body = parts[i]?.trim();
    if (body) {
      const pageNum = i;
      chunks.push(`--- PÁGINA ${pageNum} ---\n${body}`);
    }
  }

  if (chunks.length > 1) return chunks;
  if (chunks.length === 1) return chunks;
  return splitTextByPageFooters(t);
}

/** Parte por pies de página «Págs: 1 / 2» cuando no hay marcadores --- PÁGINA ---. */
function splitTextByPageFooters(text: string): string[] | null {
  const footerRe = /\bP[aá]gs?\.?\s*:\s*(\d+)\s*\/\s*(\d+)\b/gi;
  const matches = [...text.matchAll(footerRe)];
  if (matches.length < 1) return null;

  let totalPages = 0;
  for (const m of matches) {
    const n = Number(m[2] ?? 0);
    if (Number.isFinite(n) && n > totalPages) totalPages = n;
  }
  if (totalPages < 2) return null;

  const splitAt = matches[0]!.index! + matches[0]![0].length;
  const page1Body = text.slice(0, splitAt).trim();
  const restBody = text.slice(splitAt).trim();
  if (!page1Body || !restBody) return null;

  const chunks: string[] = [`--- PÁGINA 1 ---\n${page1Body}`];

  if (totalPages === 2) {
    chunks.push(`--- PÁGINA 2 ---\n${restBody}`);
    return chunks;
  }

  // 3+ páginas sin marcadores: reparte el resto en bloques (mejor que una sola pasada).
  const restChunks = splitTextIntoRoughPages(restBody, totalPages - 1);
  for (let i = 0; i < restChunks.length; i++) {
    chunks.push(`--- PÁGINA ${i + 2} ---\n${restChunks[i]}`);
  }
  return chunks.length > 1 ? chunks : null;
}

/** Divide texto en N partes aproximadas por líneas (pies de página repetidos, etc.). */
function splitTextIntoRoughPages(text: string, pageCount: number): string[] {
  const t = String(text ?? "").trim();
  if (!t || pageCount < 1) return [];
  if (pageCount === 1) return [t];

  const footerRe = /\bP[aá]gs?\.?\s*:\s*(\d+)\s*\/\s*(\d+)\b/gi;
  const footerHits = [...t.matchAll(footerRe)];
  if (footerHits.length >= pageCount - 1) {
    const parts: string[] = [];
    let start = 0;
    for (let i = 0; i < pageCount - 1 && i < footerHits.length; i++) {
      const end = footerHits[i]!.index! + footerHits[i]![0].length;
      parts.push(t.slice(start, end).trim());
      start = end;
    }
    parts.push(t.slice(start).trim());
    return parts.filter(Boolean);
  }

  const lines = t.split("\n");
  const perPage = Math.max(1, Math.ceil(lines.length / pageCount));
  const out: string[] = [];
  for (let p = 0; p < pageCount; p++) {
    const slice = lines.slice(p * perPage, (p + 1) * perPage).join("\n").trim();
    if (slice) out.push(slice);
  }
  return out;
}
