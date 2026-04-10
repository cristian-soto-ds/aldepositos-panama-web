/**
 * CSV delimitado por comas para exportar líneas de inventario por RA.
 * Mismo criterio que Excel al guardar como «CSV (delimitado por comas)» en Windows:
 * separador coma, CRLF, codificación Windows-1252 (ANSI) y sin BOM UTF-8.
 */

export type InventarioCsvModule = "quick" | "airway" | "detailed";

const HEADERS = [
  "Número",
  "Número de Parte",
  "Descripción",
  "Piezas",
  "Cantidad",
  "Longitud (cm)",
  "Altura (cm)",
  "Ancho (cm)",
  "Peso por Piezas (kg)",
  "Peso (kg)",
  "Volumen (m³)",
  "UNIDAD",
  "TIPO DE EMBALAJE",
] as const;

/** Valores fijos por fila para integraciones que exigen unidad y tipo de embalaje. */
const CSV_UNIDAD_FIJA = "PZA";
const CSV_TIPO_EMBALAJE_FIJO = "CARTON";

function parseNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Números para CSV: vacío o inválido → 0 */
export function csvNum(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  if (Number.isInteger(n)) return String(Math.trunc(n));
  const s = n.toFixed(6).replace(/\.?0+$/, "");
  return s === "" || s === "-0" ? "0" : s;
}

export function escapeCsvCell(raw: string): string {
  const s = raw ?? "";
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowHasExportableData(row: Record<string, unknown>): boolean {
  if (String(row.referencia ?? "").trim()) return true;
  if (String(row.descripcion ?? "").trim()) return true;
  if (String(row.referenciaContenedora ?? "").trim()) return true;
  if (row.reempaque === true) return true;
  if (parseNum(row.bultos) > 0) return true;
  if (parseNum(row.l) || parseNum(row.w) || parseNum(row.h)) return true;
  if (parseNum(row.weight) || parseNum(row.pesoPorBulto)) return true;
  if (parseNum(row.unidadesPorBulto) > 0) return true;
  if (parseNum(row.volumenM3) > 0) return true;
  return false;
}

function volumenM3ForRow(
  row: Record<string, unknown>,
  bultos: number,
  l: number,
  w: number,
  h: number,
  isReempaque: boolean,
): number {
  const fromField = parseNum(row.volumenM3);
  if (fromField > 0) return fromField;
  if (isReempaque) return 0;
  if (l > 0 && w > 0 && h > 0 && bultos > 0) {
    return ((l * w * h) / 1_000_000) * bultos;
  }
  return 0;
}

function buildLineCells(
  numero: string,
  row: Record<string, unknown>,
  variant: InventarioCsvModule,
): string[] {
  const reempaque = row.reempaque === true;
  const bultos = parseNum(row.bultos);
  const l = reempaque ? 0 : parseNum(row.l);
  const w = reempaque ? 0 : parseNum(row.w);
  const h = reempaque ? 0 : parseNum(row.h);

  let cantidad = 0;
  let pesoPorPiezas = 0;
  if (variant === "detailed") {
    const undB = parseNum(row.unidadesPorBulto);
    cantidad = bultos * undB;
    pesoPorPiezas = parseNum(row.pesoPorBulto);
  } else {
    const undB = parseNum(row.unidadesPorBulto);
    cantidad = undB > 0 ? bultos * undB : 0;
    pesoPorPiezas = parseNum(row.weight);
  }

  const pesoTotal = bultos * pesoPorPiezas;
  const vol = volumenM3ForRow(row, bultos, l, w, h, reempaque);

  return [
    numero.trim(),
    String(row.referencia ?? "").trim(),
    String(row.descripcion ?? "").trim(),
    csvNum(bultos),
    csvNum(cantidad),
    csvNum(l),
    csvNum(h),
    csvNum(w),
    csvNum(pesoPorPiezas),
    csvNum(pesoTotal),
    csvNum(vol),
    CSV_UNIDAD_FIJA,
    CSV_TIPO_EMBALAJE_FIJO,
  ];
}

export function buildInventarioCsv(
  numeroDocumento: string,
  measureRows: Record<string, unknown>[],
  variant: InventarioCsvModule,
): string {
  const num = numeroDocumento.trim();
  const lines: string[] = [
    HEADERS.map(escapeCsvCell).join(","),
    ...measureRows
      .filter((r) => rowHasExportableData(r))
      .map((row) =>
        buildLineCells(num, row, variant).map(escapeCsvCell).join(","),
      ),
  ];
  return lines.join("\r\n");
}

/** Bytes 0x80–0x9F de Windows-1252 → punto de código Unicode. */
const CP1252_HIGH: Record<number, number> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178,
};

function cp1252ByteToUnicode(b: number): number | null {
  if (b >= 0x00 && b <= 0x7f) return b;
  if (b >= 0xa0 && b <= 0xff) return b;
  return CP1252_HIGH[b] ?? null;
}

const UNICODE_TO_CP1252: Map<number, number> = (() => {
  const m = new Map<number, number>();
  for (let byte = 0; byte < 256; byte++) {
    const u = cp1252ByteToUnicode(byte);
    if (u !== null && !m.has(u)) m.set(u, byte);
  }
  return m;
})();

/** Codifica texto como Windows-1252 (caracteres fuera de tabla → '?'). */
export function encodeCsvWindows1252(csvText: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < csvText.length; ) {
    const cp = csvText.codePointAt(i)!;
    i += cp > 0xffff ? 2 : 1;
    if (cp <= 0x7f) {
      out.push(cp);
      continue;
    }
    if (cp <= 0xffff) {
      const b = UNICODE_TO_CP1252.get(cp);
      if (b !== undefined) {
        out.push(b);
        continue;
      }
    }
    out.push(0x3f);
  }
  return new Uint8Array(out);
}

export function downloadInventarioCsv(params: {
  numeroDocumento: string;
  measureRows: Record<string, unknown>[];
  variant: InventarioCsvModule;
  /** Sin extensión; se añade .csv */
  filenameBase: string;
}): void {
  const body = buildInventarioCsv(
    params.numeroDocumento,
    params.measureRows,
    params.variant,
  );
  const bytes = encodeCsvWindows1252(body);
  const blob = new Blob([bytes as BlobPart], {
    type: "text/csv;charset=windows-1252",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${params.filenameBase.replace(/[/\\?%*:|"<>]/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function countInventarioCsvRows(measureRows: Record<string, unknown>[]): number {
  return measureRows.filter((r) => rowHasExportableData(r)).length;
}
