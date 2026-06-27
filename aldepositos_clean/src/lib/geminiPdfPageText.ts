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

/**
 * Si el texto tiene marcadores de página, devuelve un fragmento por página.
 * Si no, null (usar split por tamaño).
 */
export function splitTextByPdfPages(text: string): string[] | null {
  const t = String(text ?? "");
  if (!t.includes("--- PÁGINA ")) return null;

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

  return chunks.length > 1 ? chunks : chunks.length === 1 ? chunks : null;
}
