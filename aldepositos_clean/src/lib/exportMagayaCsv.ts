/**
 * CSV para importar referencias en Magaya (plantilla 18 columnas, incl. composición).
 * Misma codificación que inventario: coma, CRLF, Windows-1252.
 * Columna PESO = peso de una pieza (kg), según negocio / extracción IA.
 */

import {
  csvNum,
  encodeCsvWindows1252,
  escapeCsvCell,
  rowHasExportableData,
} from "@/lib/exportInventarioCsv";

/** Encabezados exactos requeridos por Magaya (orden fijo). */
const MAGAYA_HEADERS = [
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

const MAGAYA_TIPO_EMBALAJE = "CARTON";
const MAGAYA_UNIDAD = "PZA";
const MAGAYA_UNI = "UNI";
const MAGAYA_FORRO_DEFAULT = "N/A";

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

/** Peso de una pieza (kg) para columna PESO. */
function pesoUnaPiezaKg(row: Record<string, unknown>): number {
  const explicit = parseNum(row.pesoPiezaKg);
  if (explicit > 0) return explicit;
  const und = parseNum(row.unidadesPorBulto);
  const porBulto = parseNum(row.pesoPorBulto);
  if (und > 0 && porBulto > 0) return porBulto / und;
  return porBulto > 0 ? porBulto : 0;
}

function buildMagayaRow(row: Record<string, unknown>): string[] {
  const bultos = parseNum(row.bultos);
  const l = parseNum(row.l);
  const w = parseNum(row.w);
  const h = parseNum(row.h);
  const undBulto = parseNum(row.unidadesPorBulto);
  const pesoPieza = pesoUnaPiezaKg(row);
  const cubicaje = cubicajeTotalM3(row, bultos, l, w, h);

  const modelo = String(row.magayaModelo ?? "").trim();
  const pais = String(row.paisOrigen ?? "").trim();
  const tejido = String(row.tejido ?? "").trim();
  const talla = String(row.talla ?? "").trim();
  const forroRaw = String(row.forro ?? "").trim();
  const forro = forroRaw || MAGAYA_FORRO_DEFAULT;
  const genero = String(row.genero ?? "").trim();
  const composicion = String(row.composicion ?? "").trim();

  return [
    String(row.referencia ?? "").trim(),
    String(row.descripcion ?? "").trim(),
    modelo,
    MAGAYA_TIPO_EMBALAJE,
    MAGAYA_UNI,
    MAGAYA_UNIDAD,
    csvNum(pesoPieza),
    pais,
    csvNum(undBulto),
    tejido,
    talla,
    forro,
    genero,
    csvNum(l),
    csvNum(w),
    csvNum(h),
    csvNum(cubicaje),
    composicion,
  ];
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
  return lines.join("\r\n");
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
