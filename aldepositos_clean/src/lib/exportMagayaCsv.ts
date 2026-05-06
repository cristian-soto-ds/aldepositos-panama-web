/**
 * CSV para importar referencias en Magaya (plantilla 18 columnas).
 * Misma codificación que inventario: coma, CRLF, Windows-1252.
 * Columna PESO = mismo valor que «Peso por Piezas (kg)» del CSV Descargar (detailed): pesoPorBulto.
 * UNI y COMPOSICION se dejan vacías por requisitos de Magaya / Excel (evita fecha en TALLA con punto final).
 * Igual que inventario: primera línea `sep=,` para abrir por columnas en Excel regional ES.
 */

import {
  csvNum,
  encodeCsvWindows1252,
  escapeCsvCell,
  rowHasExportableData,
  withExcelSeparatorHint,
} from "@/lib/exportInventarioCsv";

/** Encabezados exactos requeridos por Magaya (orden fijo). */
export const MAGAYA_HEADERS = [
  "Numero de parte",
  "DESCRIPCION",
  "MODELO",
  "Tipo de Embalaje",
  "UNI",
  "UNIDAD",
  "PESO",
  "Pais de Org.",
  "cantidad por bulto",
  "TEJIDO",
  "TALLA",
  "FORRO",
  "GENERO",
  "LARGO",
  "ANCHO",
  "ALTO",
  "CUBICAJE",
  "COMPOSICION",
] as const;

const MAGAYA_TIPO_EMBALAJE = "Cartón";
const MAGAYA_UNIDAD = "PZA";
const MAGAYA_FORRO_DEFAULT = "N/A";

/** Evita que Excel interprete rangos tipo 1-15 como fecha; punto final solo si hay texto. */
function tallaParaCsvMagaya(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return t.endsWith(".") ? t : `${t}.`;
}

function parseNum(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function cubicajeTotalM3(
  row: Record<string, unknown>,
  bultos: number,
  l: number,
  w: number,
  h: number,
): number {
  const fromField = parseNum(row.volumenM3);
  if (fromField > 0) return fromField;
  if (l > 0 && w > 0 && h > 0 && bultos > 0) {
    return ((l * w * h) / 1_000_000) * bultos;
  }
  return 0;
}

/** Igual que `exportInventarioCsv` variant `detailed`: columna «Peso por Piezas (kg)» (= pesoPorBulto). */
function pesoMagayaIgualCsvInventario(row: Record<string, unknown>): number {
  return parseNum(row.pesoPorBulto);
}

/**
 * Valores de una fila Magaya: números como number (p. ej. und/bulto con decimales) para CSV o Excel.
 * Índice 8 = columna «cantidad por bulto» (uno-based Excel col I).
 */
export function buildMagayaRowValues(
  row: Record<string, unknown>,
): (string | number)[] {
  const bultos = parseNum(row.bultos);
  const l = parseNum(row.l);
  const w = parseNum(row.w);
  const h = parseNum(row.h);
  const undBulto = parseNum(row.unidadesPorBulto);
  const pesoColumn = pesoMagayaIgualCsvInventario(row);
  const cubicaje = cubicajeTotalM3(row, bultos, l, w, h);

  const modelo = String(row.magayaModelo ?? "").trim();
  const pais = String(row.paisOrigen ?? "").trim();
  const tejido = String(row.tejido ?? "").trim();
  const talla = tallaParaCsvMagaya(String(row.talla ?? ""));
  const forroRaw = String(row.forro ?? "").trim();
  const forro = forroRaw || MAGAYA_FORRO_DEFAULT;
  const generoRaw = String(row.genero ?? "").trim();
  const genero = generoRaw ? generoRaw.toLocaleUpperCase("es") : "";

  return [
    String(row.referencia ?? "").trim(),
    String(row.descripcion ?? "").trim(),
    modelo,
    MAGAYA_TIPO_EMBALAJE,
    "",
    MAGAYA_UNIDAD,
    pesoColumn,
    pais,
    undBulto,
    tejido,
    talla,
    forro,
    genero,
    l,
    w,
    h,
    cubicaje,
    "",
  ];
}

function buildMagayaRow(row: Record<string, unknown>): string[] {
  const v = buildMagayaRowValues(row);
  return v.map((cell) =>
    typeof cell === "number" ? csvNum(cell) : cell,
  );
}

export function buildMagayaReferenciasCsv(
  measureRows: Record<string, unknown>[],
): string {
  const lines: string[] = [
    MAGAYA_HEADERS.map(escapeCsvCell).join(","),
    ...measureRows
      .filter((r) => rowHasExportableData(r))
      .map((row) => buildMagayaRow(row).map(escapeCsvCell).join(",")),
  ];
  return withExcelSeparatorHint(lines.join("\r\n"));
}

export function downloadMagayaReferenciasCsv(params: {
  measureRows: Record<string, unknown>[];
  filenameBase: string;
}): void {
  const body = buildMagayaReferenciasCsv(params.measureRows);
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
