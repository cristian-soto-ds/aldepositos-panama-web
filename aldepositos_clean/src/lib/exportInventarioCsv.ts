/**
 * CSV delimitado por comas para exportar líneas de inventario por RA.
 * Mismo criterio que Excel al guardar como «CSV (delimitado por comas)» en Windows:
 * separador coma, CRLF, codificación Windows-1252 (ANSI) y sin BOM UTF-8.
 * Primera línea `sep=,` para que Excel abra por columnas aunque el sistema regional use `;`.
 */

import {
  cubicajeM3FromDims,
  csvMeasureNum,
  roundMeasureNearest,
  roundUpMeasure,
} from "@/lib/measureDecimals";

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
const CSV_TIPO_EMBALAJE_FIJO = "Cartón";

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

/**
 * Fuerza a Excel el separador por comas al abrir el archivo (lista regional / decimal en español).
 * La línea aparece en la primera fila; así las columnas A, B, C… cuadran con los encabezados.
 */
export function withExcelSeparatorHint(csvWithoutHint: string): string {
  return `sep=,\r\n${csvWithoutHint}`;
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
  if (parseNum(row.unidadesTotales) > 0) return true;
  if (parseNum(row.volumenM3) > 0) return true;
  return false;
}

/**
 * Piezas totales para la columna «Cantidad» del CSV inventario.
 * Prioriza `unidadesTotales` (UND captura / extracción IA); si no, bultos × und/bulto.
 */
export function cantidadPiezasTotalesForCsv(
  row: Record<string, unknown>,
  bultos: number,
): number {
  const tot = parseNum(row.unidadesTotales);
  if (tot > 0) {
    const r = Math.round(tot);
    return Math.abs(tot - r) < 1e-3 ? r : tot;
  }
  const undB = parseNum(row.unidadesPorBulto);
  if (bultos <= 0 || undB <= 0) return 0;
  const product = bultos * undB;
  const r = Math.round(product);
  return Math.abs(product - r) < 1e-3 ? r : product;
}

function volumenM3ForRow(
  row: Record<string, unknown>,
  bultos: number,
  l: number,
  w: number,
  h: number,
  isReempaque: boolean,
): number {
  // Fórmula canónica: dimensiones primero (igual que la captura y el reporte),
  // y solo se usa el campo `volumenM3` como total de línea si no hay medidas.
  if (isReempaque) return 0;
  if (l > 0 && w > 0 && h > 0 && bultos > 0) {
    return cubicajeM3FromDims(l, w, h, bultos, isReempaque);
  }
  return roundMeasureNearest(parseNum(row.volumenM3));
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
    cantidad = cantidadPiezasTotalesForCsv(row, bultos);
    pesoPorPiezas = parseNum(row.pesoPorBulto);
  } else {
    cantidad = cantidadPiezasTotalesForCsv(row, bultos);
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
    csvMeasureNum(l),
    csvMeasureNum(h),
    csvMeasureNum(w),
    csvMeasureNum(pesoPorPiezas),
    csvMeasureNum(pesoTotal),
    csvMeasureNum(vol),
    CSV_UNIDAD_FIJA,
    CSV_TIPO_EMBALAJE_FIJO,
  ];
}

/**
 * Mismos datos que el CSV pero con tipos numéricos para Excel (evita «número almacenado como texto»).
 */
export function buildInventarioExcelRowValues(
  numeroDocumento: string,
  row: Record<string, unknown>,
  variant: InventarioCsvModule,
): (string | number)[] {
  const numero = numeroDocumento.trim();
  const reempaque = row.reempaque === true;
  const bultos = parseNum(row.bultos);
  const l = reempaque ? 0 : parseNum(row.l);
  const w = reempaque ? 0 : parseNum(row.w);
  const h = reempaque ? 0 : parseNum(row.h);

  let cantidad = 0;
  let pesoPorPiezas = 0;
  if (variant === "detailed") {
    cantidad = cantidadPiezasTotalesForCsv(row, bultos);
    pesoPorPiezas = parseNum(row.pesoPorBulto);
  } else {
    cantidad = cantidadPiezasTotalesForCsv(row, bultos);
    pesoPorPiezas = parseNum(row.weight);
  }

  const pesoTotal = roundUpMeasure(bultos * pesoPorPiezas);
  const vol = volumenM3ForRow(row, bultos, l, w, h, reempaque);

  const numeroCell: string | number = (() => {
    if (numero === "") return "";
    const normalized = numero.replace(",", ".");
    if (/^-?\d+(\.\d+)?$/.test(normalized)) {
      const n = Number(normalized);
      return Number.isFinite(n) ? n : numero;
    }
    return numero;
  })();

  return [
    numeroCell,
    String(row.referencia ?? "").trim(),
    String(row.descripcion ?? "").trim(),
    bultos,
    cantidad,
    roundUpMeasure(l),
    roundUpMeasure(h),
    roundUpMeasure(w),
    roundUpMeasure(pesoPorPiezas),
    pesoTotal,
    vol,
    CSV_UNIDAD_FIJA,
    CSV_TIPO_EMBALAJE_FIJO,
  ];
}

/** Encabezados de columna del CSV / Excel inventario. */
export function getInventarioCsvHeaderLabels(): string[] {
  return [...HEADERS];
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
  return withExcelSeparatorHint(lines.join("\r\n"));
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

/** Un solo CSV: mismos encabezados; columna «Número» = `numeroDocumento` de cada bloque. */
export function buildInventarioCsvBulk(
  sections: { numeroDocumento: string; measureRows: Record<string, unknown>[] }[],
  variant: InventarioCsvModule,
): string {
  const headerLine = HEADERS.map(escapeCsvCell).join(",");
  const lines: string[] = [headerLine];
  for (const sec of sections) {
    const num = sec.numeroDocumento.trim();
    for (const row of sec.measureRows) {
      if (!rowHasExportableData(row)) continue;
      lines.push(buildLineCells(num, row, variant).map(escapeCsvCell).join(","));
    }
  }
  return withExcelSeparatorHint(lines.join("\r\n"));
}

export function countInventarioCsvRowsBulk(
  sections: { measureRows: Record<string, unknown>[] }[],
): number {
  return sections.reduce((n, s) => n + countInventarioCsvRows(s.measureRows), 0);
}

export function downloadInventarioCsvBulk(params: {
  sections: { numeroDocumento: string; measureRows: Record<string, unknown>[] }[];
  variant: InventarioCsvModule;
  filenameBase: string;
}): void {
  const body = buildInventarioCsvBulk(params.sections, params.variant);
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
