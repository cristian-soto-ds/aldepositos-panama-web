import type ExcelJS from "exceljs";
import { normalizeContainerLoadRa } from "@/lib/containerLoadItems";
import type { ContainerLoadItem } from "@/lib/types/containerLoad";

type Field =
  | "ra"
  | "proveedor"
  | "expedidor"
  | "seguimiento"
  | "bultos"
  | "cbm"
  | "volumen"
  | "peso"
  | "notas"
  | "instruccion";

const HEADER_MAP: Record<string, Field> = {
  numero: "ra",
  ra: "ra",
  numerora: "ra",
  nora: "ra",
  nombreproveedor: "proveedor",
  proveedor: "proveedor",
  nombreexpeditor: "expedidor",
  nombreexpedidor: "expedidor",
  expedidor: "expedidor",
  expeditor: "expedidor",
  numerodeseguimiento: "seguimiento",
  numeroseguimiento: "seguimiento",
  seguimiento: "seguimiento",
  tracking: "seguimiento",
  bultos: "bultos",
  bulto: "bultos",
  cbmfact: "cbm",
  cbm: "cbm",
  volumenm3: "volumen",
  volumen: "volumen",
  peso: "peso",
  pesokg: "peso",
  notas: "notas",
  nota: "notas",
  instruccion: "instruccion",
  orden: "instruccion",
  ordencargue: "instruccion",
  ordendecargue: "instruccion",
};

export type ParsedContainerLoad = {
  items: ContainerLoadItem[];
  suggestedName: string;
  /** false → no se reconocieron columnas: usar Terra. */
  headerFound: boolean;
  warnings: string[];
};

export function normalizeContainerLoadHeader(h: string): string {
  return String(h ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]/g, "");
}

function parseNum(raw: string): number | undefined {
  const s = String(raw ?? "").trim().replace(/\s+/g, "");
  if (!s) return undefined;
  // "1,834.3" → 1834.3 ; "1834,3" → 1834.3
  const normalized =
    s.includes(",") && s.includes(".")
      ? s.replace(/,/g, "")
      : s.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

function looksLikeRa(raw: string): boolean {
  const key = normalizeContainerLoadRa(raw);
  return /\d{3,}/.test(key) && key.length <= 20;
}

/** "INSTRUCCIÓN CARGUE CONSOLIDADO 86 LG" → "CONSOLIDADO 86 LG". */
export function suggestContainerLoadName(title: string): string {
  const t = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const stripped = t
    .replace(
      /^(instrucci[oó]n(es)?\s+(de\s+)?cargue|relaci[oó]n\s+(de\s+)?cargue|cargue)\s*[:\-–]?\s*/i,
      "",
    )
    .trim();
  return (stripped || t).slice(0, 200);
}

/**
 * Interpreta una grilla de celdas (ya en texto) de una relación de cargue.
 * Separado de exceljs para poder testearlo.
 */
export function parseContainerLoadGrid(grid: string[][]): ParsedContainerLoad {
  const warnings: string[] = [];
  let headerIdx = -1;
  let colMap = new Map<number, Field>();

  const scanLimit = Math.min(grid.length, 40);
  for (let r = 0; r < scanLimit; r++) {
    const row = grid[r] ?? [];
    const map = new Map<number, Field>();
    const seen = new Set<Field>();
    row.forEach((cell, c) => {
      const field = HEADER_MAP[normalizeContainerLoadHeader(cell)];
      if (field && !seen.has(field)) {
        map.set(c, field);
        seen.add(field);
      }
    });
    if (seen.has("ra") && seen.size >= 3) {
      headerIdx = r;
      colMap = map;
      break;
    }
  }

  let title = "";
  const titleRows = headerIdx >= 0 ? headerIdx : Math.min(grid.length, 5);
  for (let r = 0; r < titleRows; r++) {
    for (const cell of grid[r] ?? []) {
      const s = String(cell ?? "").trim();
      if (s.length > title.length && /[a-z]/i.test(s)) title = s;
    }
  }
  const suggestedName = suggestContainerLoadName(title);

  if (headerIdx < 0) {
    return { items: [], suggestedName, headerFound: false, warnings };
  }

  const colOf = (f: Field) => {
    for (const [c, field] of colMap) if (field === f) return c;
    return -1;
  };
  const raCol = colOf("ra");
  const get = (row: string[], f: Field) => {
    const c = colOf(f);
    return c >= 0 ? String(row[c] ?? "").trim() : "";
  };

  type Draft = ContainerLoadItem & { _row: number; _instr?: number };
  const drafts: Draft[] = [];
  const seenRa = new Set<string>();

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const raRaw = String(row[raCol] ?? "").trim();
    if (!raRaw || !looksLikeRa(raRaw)) continue;
    const ra = normalizeContainerLoadRa(raRaw);
    if (seenRa.has(ra)) {
      warnings.push(`RA ${ra} aparece repetido; se usa la primera fila.`);
      continue;
    }
    seenRa.add(ra);
    drafts.push({
      _row: r,
      _instr: parseNum(get(row, "instruccion")),
      position: 0,
      ra,
      proveedor: get(row, "proveedor") || undefined,
      expedidor: get(row, "expedidor") || undefined,
      seguimiento: get(row, "seguimiento") || undefined,
      bultos: parseNum(get(row, "bultos")),
      cbm: parseNum(get(row, "cbm")) ?? parseNum(get(row, "volumen")),
      peso: parseNum(get(row, "peso")),
      notas: get(row, "notas") || undefined,
    });
  }

  drafts.sort((a, b) => {
    const ia = a._instr ?? Number.POSITIVE_INFINITY;
    const ib = b._instr ?? Number.POSITIVE_INFINITY;
    if (ia !== ib) return ia - ib;
    return a._row - b._row;
  });

  const items: ContainerLoadItem[] = drafts.map(
    ({ _row: _r, _instr: _i, ...item }, idx) => ({ ...item, position: idx + 1 }),
  );

  if (items.length === 0) {
    warnings.push("No se encontraron filas con número de RA.");
  }

  return { items, suggestedName, headerFound: true, warnings };
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown;
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      return (o.richText as { text?: string }[])
        .map((p) => p.text ?? "")
        .join("")
        .trim();
    }
    if (typeof o.text === "string") return o.text.trim();
    if ("result" in o) return String(o.result ?? "").trim();
    return "";
  }
  return String(v).trim();
}

function parseCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === sep && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Lee el archivo (xlsx o csv) a una grilla de texto. */
export async function readContainerLoadFileGrid(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const sep = (lines[0] ?? "").split(";").length > (lines[0] ?? "").split(",").length
      ? ";"
      : ",";
    return lines.map((l) => parseCsvLine(l, sep));
  }
  const mod = await import("exceljs");
  const ExcelJSMod = ((mod as { default?: typeof import("exceljs") }).default ??
    mod) as typeof import("exceljs");
  const wb = new ExcelJSMod.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0) ?? wb.worksheets[0];
  if (!ws) throw new Error("El Excel no tiene hojas.");
  const grid: string[][] = [];
  const colCount = Math.max(ws.columnCount, 1);
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let c = 1; c <= colCount; c++) cells.push(cellText(row.getCell(c)));
    grid[rowNumber - 1] = cells;
  });
  return Array.from(grid, (r) => r ?? []);
}

/** Grilla → texto tabulado para que Terra la interprete (formato desconocido). */
export function containerLoadGridToText(grid: string[][], maxRows = 400): string {
  return grid
    .slice(0, maxRows)
    .map((r) => r.map((c) => String(c ?? "").replace(/\s+/g, " ").trim()).join("\t"))
    .filter((l) => l.replace(/\t/g, "").trim())
    .join("\n");
}

export async function parseContainerLoadExcel(
  file: File,
): Promise<ParsedContainerLoad & { grid: string[][] }> {
  const grid = await readContainerLoadFileGrid(file);
  return { ...parseContainerLoadGrid(grid), grid };
}
