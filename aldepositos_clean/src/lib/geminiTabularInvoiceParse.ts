import type { CollectionGeminiLine } from "@/lib/collectionOrderGeminiSchema";

const PUNTOMODA_CODE_RE = /\b([BJ]-\d{4,}[\w-]*)\b/gi;
const JN_CODE_RE = /\b(JN-\d{3,}[\w-]*)\b/gi;

const CODE_PATTERNS = [PUNTOMODA_CODE_RE, JN_CODE_RE];

export type TabularInvoiceRow = {
  referencia: string;
  bultos: string;
  descripcion?: string;
  unidadesTotales?: string;
  pesoPorBulto?: string;
  genero?: string;
};

function normalizeRef(ref: string): string {
  return ref.trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeDecimal(raw: string): string {
  const n = parseFloat(String(raw ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(n);
}

const GENERO_RE = /\b(DAMA|CABALLERO|NIÑ[OA]|MAMA|BEB[EÉ])\b/i;

function parseTabularRowSlice(ref: string, slice: string): TabularInvoiceRow {
  const row: TabularInvoiceRow = { referencia: ref, bultos: "" };
  const upper = slice.toUpperCase();
  const refUpper = ref.toUpperCase();
  const refIdx = upper.indexOf(refUpper);
  const tail = refIdx >= 0 ? slice.slice(refIdx + ref.length) : slice;

  const bultoMatch =
    /\b(?:No\.?\s*)?Bultos?\s*:?\s*(\d{1,4})\b/i.exec(slice) ??
    /\b(\d{1,4})\s+(?:bultos?|ctns?|cartons?)\b/i.exec(tail);
  if (bultoMatch?.[1]) row.bultos = bultoMatch[1].trim();

  const dozMatch = /\b([\d.,]+)\s+DOZ\.?\b/i.exec(tail);
  if (dozMatch?.[1]) {
    const dz = parseFloat(dozMatch[1].replace(/,/g, ""));
    if (Number.isFinite(dz) && dz > 0) {
      row.unidadesTotales = String(Math.round(dz * 12));
    }
  }

  const pcsMatch =
    /\b(\d{2,6})\s+(?:PZA|PCS|PIEZAS?|UNITS?)\b/i.exec(tail) ??
    /\b(?:Cantidad|Pcs)\s*:?\s*(\d{2,6})\b/i.exec(slice);
  if (!row.unidadesTotales && pcsMatch?.[1]) {
    row.unidadesTotales = pcsMatch[1].trim();
  }

  const pesoMatch =
    /\b(?:Peso|Peso\s*B\.?|Weight)\s*:?\s*([\d.,]+)/i.exec(slice) ??
    /\b([\d.,]+)\s*KG\b/i.exec(tail);
  if (pesoMatch?.[1]) row.pesoPorBulto = normalizeDecimal(pesoMatch[1]);

  const generoMatch = GENERO_RE.exec(slice);
  if (generoMatch?.[1]) row.genero = generoMatch[1].toUpperCase();

  const descEnd = tail.search(
    /\b(?:No\.?\s*)?Bultos?\b|\b[\d.,]+\s+DOZ\b|\b\d+\s+PZA\b|\bPeso\b/i,
  );
  if (descEnd > 2) {
    const descRaw = tail.slice(0, descEnd).replace(/\s+/g, " ").trim();
    if (descRaw.length > 2 && !/^\d+$/.test(descRaw)) {
      row.descripcion = descRaw.replace(GENERO_RE, " ").replace(/\s+/g, " ").trim();
    }
  }

  if (!row.bultos) {
    const firstNum = tail.match(/\b([1-9]\d{0,2})\b/);
    if (firstNum?.[1]) row.bultos = firstNum[1];
  }

  return row;
}

export function countTabularCodes(text: string): number {
  const seen = new Set<string>();
  for (const re of CODE_PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const ref = normalizeRef(m[1] ?? "");
      if (ref) seen.add(ref);
    }
  }
  return seen.size;
}

export function isTabularInvoiceText(text: string): boolean {
  const t = String(text ?? "");
  if (countTabularCodes(t) >= 2) return true;
  if (
    (/\bReferencia\b/i.test(t) || /\bSKU\b/i.test(t)) &&
    countTabularCodes(t) >= 1
  ) {
    return true;
  }
  return false;
}

export function parseTabularRowsFromPdfText(text: string): TabularInvoiceRow[] {
  if (!isTabularInvoiceText(text)) return [];

  const t = String(text ?? "");
  const codeHits: { ref: string; index: number }[] = [];
  const seen = new Set<string>();

  for (const re of CODE_PATTERNS) {
    re.lastIndex = 0;
    for (const m of t.matchAll(re)) {
      const ref = normalizeRef(m[1] ?? "");
      const index = m.index ?? 0;
      if (!ref || seen.has(ref)) continue;
      seen.add(ref);
      codeHits.push({ ref, index });
    }
  }

  codeHits.sort((a, b) => a.index - b.index);

  return codeHits.map(({ ref, index }, i) => {
    const end = i + 1 < codeHits.length ? codeHits[i + 1]!.index : index + 600;
    const slice = t.slice(index, Math.min(end, index + 600));
    return parseTabularRowSlice(ref, slice);
  });
}

export function tabularRowToGeminiLine(row: TabularInvoiceRow): CollectionGeminiLine {
  const line: CollectionGeminiLine = {
    referencia: row.referencia,
    bultos: row.bultos,
  };
  if (row.descripcion) line.descripcion = row.descripcion;
  if (row.unidadesTotales) line.unidadesTotales = row.unidadesTotales;
  if (row.pesoPorBulto) line.pesoPorBulto = row.pesoPorBulto;
  if (row.genero) line.genero = row.genero;
  const b = Number(row.bultos);
  const u = Number(row.unidadesTotales);
  if (b > 0 && u > 0 && !line.unidadesPorBulto) {
    const und = u / b;
    line.unidadesPorBulto =
      Math.abs(und - Math.round(und)) < 1e-3
        ? String(Math.round(und))
        : String(Math.round(und * 100) / 100);
  }
  return line;
}
