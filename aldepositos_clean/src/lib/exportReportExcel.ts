import type ExcelJS from "exceljs";
import type { Task } from "@/lib/types/task";

type ExcelJSNamespace = typeof import("exceljs");

async function loadExcelJS(): Promise<ExcelJSNamespace> {
  const mod = await import("exceljs");
  return ((mod as { default?: ExcelJSNamespace }).default ??
    mod) as ExcelJSNamespace;
}
import logoMark from "@/assets/brand/logo-aldepositos.png";
import {
  computeReportData,
  reportLineTotalCbm,
  reportModuleLabel,
  reportPalletWeight,
  reportRowPallet,
} from "@/lib/reportTotals";
import { buildReportDownloadFilename } from "@/lib/reportDownloadFilename";
import { cubicajeM3FromDims, roundUpMeasure } from "@/lib/measureDecimals";

const BRAND = "FF16263F";
const BRAND_LIGHT = "FF1E3A5F";
const WHITE = "FFFFFFFF";
const TEXT = "FF1E293B";
const MUTED = "FF94A3B8";
const MUTED_ON_DARK = "FFB8C4D4";
const BORDER = "FFE2E8F0";
const ROW_ALT = "FFF8FAFC";
const KPI_BG = "FFF1F5F9";
const ACCENT = "FF3B82F6";
const CBM_TEXT = "FF1D4ED8";

const FONT = "Calibri";

export type ReportSheetExportMeta = {
  repeatTitleStartRow: number;
  repeatTitleEndRow: number;
  dataStartRow: number;
  dataEndRow: number;
  tailStartRow: number;
  lastRow: number;
  colCount: number;
  isDetailed: boolean;
};

export type ReportWorkbookResult = {
  workbook: ExcelJS.Workbook;
  logoDataUrl: string | null;
};

type WorksheetWithMeta = ExcelJS.Worksheet & {
  reportExportMeta?: ReportSheetExportMeta;
};

function thinBorder(color = BORDER): Partial<ExcelJS.Borders> {
  const edge = { style: "thin" as const, color: { argb: color } };
  return { top: edge, left: edge, bottom: edge, right: edge };
}

export function buildReportExcelFilename(
  tasks: Parameters<typeof buildReportDownloadFilename>[0],
): string {
  return buildReportDownloadFilename(tasks);
}

function safeSheetName(ra: string): string {
  const base = `RA-${String(ra).trim()}`.replace(/[\\/*?:[\]]/g, "-");
  return base.slice(0, 31) || "Reporte";
}

async function loadLogoBuffer(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(logoMark.src);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

async function loadLogoDataUrl(): Promise<string | null> {
  const buf = await loadLogoBuffer();
  if (!buf) return null;
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

function colLetter(col: number): string {
  let n = col;
  let s = "";
  while (n > 0) {
    const mod = (n - 1) % 26;
    s = String.fromCharCode(65 + mod) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || "A";
}

/**
 * A4, área de impresión exacta y ajuste a página para que Excel imprima completo y legible.
 */
function applySheetPrintSetup(
  ws: ExcelJS.Worksheet,
  lastRow: number,
  colCount: number,
  measureRowCount: number,
  isDetailed: boolean,
  repeatTitleStartRow: number,
  repeatTitleEndRow: number,
): void {
  const lastCol = colLetter(colCount);
  const compactReport = lastRow <= 48 && measureRowCount <= 24;

  ws.pageSetup = {
    paperSize: 9,
    orientation: isDetailed ? "landscape" : "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: compactReport ? 1 : 0,
    scale: 100,
    horizontalCentered: true,
    verticalCentered: false,
    showGridLines: false,
    showRowColHeaders: false,
    printArea: `A1:${lastCol}${lastRow}`,
    printTitlesRow: `${repeatTitleStartRow}:${repeatTitleEndRow}`,
    margins: {
      left: 0.35,
      right: 0.35,
      top: 0.45,
      bottom: 0.45,
      header: 0.15,
      footer: 0.15,
    },
  };
}

function paintCanvas(ws: ExcelJS.Worksheet, rows: number, cols: number) {
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const cell = ws.getCell(r, c);
      if (!cell.fill) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: WHITE },
        };
      }
    }
  }
}

function safeMergeCells(
  ws: ExcelJS.Worksheet,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): void {
  const top = Math.min(r1, r2);
  const left = Math.min(c1, c2);
  const bottom = Math.max(r1, r2);
  const right = Math.max(c1, c2);
  if (top > bottom || left > right) return;
  ws.mergeCells(top, left, bottom, right);
}

function setSectionTitle(cell: ExcelJS.Cell, text: string) {
  cell.value = text;
  cell.font = { name: FONT, size: 9, bold: true, color: { argb: BRAND } };
  cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
}

function buildQuickHeaders(
  showReference: boolean,
  showWeight: boolean,
): string[] {
  const headers = ["#"];
  if (showReference) headers.push("Referencia");
  headers.push("Bultos");
  if (showWeight) headers.push("Peso/B (kg)", "P. Total (kg)");
  headers.push("L", "W", "H", "Reempaque", "CBM/B", "Total CBM");
  return headers;
}

function buildPalletizedHeaders(): string[] {
  return ["#", "Bultos", "L", "W", "H", "Reempaque", "Total CBM"];
}

function buildPalletizedRow(
  row: Record<string, unknown>,
  lineNum: number,
): (string | number)[] {
  const l = parseFloat(String(row.l ?? 0)) || 0;
  const w = parseFloat(String(row.w ?? 0)) || 0;
  const h = parseFloat(String(row.h ?? 0)) || 0;
  const b = parseFloat(String(row.bultos ?? 0)) || 0;
  const isReempaque = row.reempaque === true;
  const rowCbm = reportLineTotalCbm(row);
  return [
    lineNum,
    isReempaque ? "—" : b,
    isReempaque ? "—" : l,
    isReempaque ? "—" : w,
    isReempaque ? "—" : h,
    isReempaque ? "SI" : "-",
    isReempaque ? "—" : rowCbm,
  ];
}

function buildDetailedHeaders(): string[] {
  return [
    "#",
    "Ref.",
    "Descripción",
    "Bult.",
    "Und/B",
    "Tot. U",
    "P/B (kg)",
    "P. Total (kg)",
    "Reemp.",
    "L",
    "W",
    "H",
    "CBM/B",
    "Tot. CBM",
  ];
}

function buildQuickRow(
  row: Record<string, unknown>,
  idx: number,
  showReference: boolean,
  showWeight: boolean,
): (string | number)[] {
  const l = parseFloat(String(row.l ?? 0)) || 0;
  const w = parseFloat(String(row.w ?? 0)) || 0;
  const h = parseFloat(String(row.h ?? 0)) || 0;
  const b = parseFloat(String(row.bultos ?? 0)) || 0;
  const isReempaque = row.reempaque === true;
  const rowCbm = reportLineTotalCbm(row);
  const cbmPorBulto = cubicajeM3FromDims(l, w, h, 1, isReempaque);
  const rowWeight = parseFloat(String(row.weight ?? 0)) || 0;
  const pesoTotal = roundUpMeasure(b * rowWeight);

  const values: (string | number)[] = [idx + 1];
  if (showReference) values.push(String(row.referencia || "-"));
  values.push(b);
  if (showWeight) {
    values.push(
      row.weight != null ? parseFloat(String(row.weight)) || 0 : "-",
    );
    values.push(isReempaque || pesoTotal <= 0 ? "-" : pesoTotal);
  }
  values.push(l, w, h, row.reempaque ? "SI" : "-", isReempaque ? "-" : cbmPorBulto);
  values.push(rowCbm);
  return values;
}

function buildDetailedRow(
  row: Record<string, unknown>,
  idx: number,
): (string | number)[] {
  const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
  const undPerBulto = parseFloat(String(row.unidadesPorBulto ?? 0)) || 0;
  const pesoPorBulto = parseFloat(String(row.pesoPorBulto ?? 0)) || 0;
  const l = parseFloat(String(row.l ?? 0)) || 0;
  const w = parseFloat(String(row.w ?? 0)) || 0;
  const h = parseFloat(String(row.h ?? 0)) || 0;
  const isReempaque = row.reempaque === true;
  const cbmPorBulto = cubicajeM3FromDims(l, w, h, 1, isReempaque);
  const cubicajeTotal = reportLineTotalCbm(row);

  return [
    idx + 1,
    String(row.referencia || "-"),
    String(row.descripcion || "-"),
    bultos,
    undPerBulto,
    bultos * undPerBulto,
    Number(pesoPorBulto.toFixed(2)),
    Number((bultos * pesoPorBulto).toFixed(2)),
    row.reempaque ? "SI" : "-",
    l,
    w,
    h,
    cbmPorBulto,
    cubicajeTotal,
  ];
}

/** Reparte columnas: más espacio a expedidor/cliente, menos a marca. */
function buildFieldSpans(colCount: number): [number, number][] {
  const b1 = Math.max(2, Math.round(colCount * 0.28));
  const b2 = Math.max(b1 + 1, Math.round(colCount * 0.58));
  const b3 = Math.max(b2 + 1, Math.round(colCount * 0.8));
  return [
    [1, b1],
    [b1 + 1, b2],
    [b2 + 1, b3],
    [b3 + 1, colCount],
  ];
}

function mergedColumnsWidth(
  ws: ExcelJS.Worksheet,
  c1: number,
  c2: number,
): number {
  let total = 0;
  for (let c = c1; c <= c2; c++) {
    total += ws.getColumn(c).width ?? 10;
  }
  return total;
}

/** Estima líneas con ajuste de texto según ancho de columnas fusionadas. */
function estimateWrappedLines(text: string, widthUnits: number): number {
  const charsPerLine = Math.max(6, Math.floor(widthUnits * 0.82));
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;

  let lines = 1;
  let currentLen = 0;
  for (const word of words) {
    if (currentLen === 0) {
      currentLen = word.length;
      continue;
    }
    if (currentLen + 1 + word.length <= charsPerLine) {
      currentLen += 1 + word.length;
    } else {
      lines += 1;
      currentLen = word.length;
    }
  }
  return lines;
}

function valueRowHeightForText(
  text: string,
  widthUnits: number,
  fontSize: number,
): number {
  const lines = estimateWrappedLines(text, widthUnits);
  const pt = lines * (fontSize * 1.5) + 12;
  return Math.min(120, Math.max(36, Math.ceil(pt)));
}

/** Etiqueta pequeña sobre valor en bloque compacto de 2 filas */
function writeFieldBlock(
  ws: ExcelJS.Worksheet,
  labelRow: number,
  valueRow: number,
  c1: number,
  c2: number,
  label: string,
  value: string,
  opts?: { hero?: boolean },
) {
  safeMergeCells(ws, labelRow, c1, labelRow, c2);
  safeMergeCells(ws, valueRow, c1, valueRow, c2);

  const labelCell = ws.getCell(labelRow, c1);
  labelCell.value = label;
  labelCell.font = { name: FONT, size: 8, bold: true, color: { argb: MUTED } };
  labelCell.alignment = { vertical: "bottom", horizontal: "left", indent: 1 };
  labelCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: KPI_BG },
  };
  labelCell.border = {
    top: { style: "thin", color: { argb: BORDER } },
    left: { style: "thin", color: { argb: BORDER } },
    right: { style: "thin", color: { argb: BORDER } },
  };

  const valueCell = ws.getCell(valueRow, c1);
  valueCell.value = value;
  valueCell.font = {
    name: FONT,
    size: opts?.hero ? 12 : 10,
    bold: true,
    color: { argb: TEXT },
  };
  valueCell.alignment = {
    vertical: "middle",
    horizontal: "left",
    indent: 1,
    wrapText: true,
  };
  valueCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: WHITE },
  };
  valueCell.border = {
    left: { style: "thin", color: { argb: BORDER } },
    right: { style: "thin", color: { argb: BORDER } },
    bottom: { style: "thin", color: { argb: BORDER } },
  };
}

function addReportSheet(
  wb: ExcelJS.Workbook,
  task: Task,
  currentDate: string,
  logoId: number | null,
): void {
  const {
    measureRows,
    isDetailed,
    isPalletized,
    showWeightColumn,
    showReferenceColumn,
    totals,
  } = computeReportData(task);

  const headers = isDetailed
    ? buildDetailedHeaders()
    : isPalletized
      ? buildPalletizedHeaders()
      : buildQuickHeaders(showReferenceColumn, showWeightColumn);
  const colCount = headers.length;

  const ws = wb.addWorksheet(safeSheetName(task.ra), {
    properties: { defaultRowHeight: 20, defaultColWidth: 10 },
    views: [{ showGridLines: false, zoomScale: 100 }],
  });

  for (let c = 1; c <= colCount; c++) {
    ws.getColumn(c).width =
      c === 1
        ? 4.5
        : isDetailed
          ? c === 3
            ? 24
            : 10
          : showReferenceColumn && c === 2
            ? 18
            : c === colCount
              ? 11
              : 9.5;
  }

  let row = 1;

  // ═══ BARRA CORPORATIVA (fondo marca) — regiones sin solapar merges ═══
  const logoEndCol = Math.min(2, colCount);
  const infoStartCol = Math.min(colCount, Math.max(logoEndCol + 1, colCount - 2));
  const brandEndCol = Math.max(logoEndCol, infoStartCol - 1);

  for (let r = row; r <= row + 2; r++) {
    for (let c = 1; c <= colCount; c++) {
      ws.getCell(r, c).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: BRAND },
      };
    }
  }

  if (logoEndCol >= 1) {
    safeMergeCells(ws, row, 1, row + 2, logoEndCol);
    for (let r = row; r <= row + 2; r++) {
      for (let c = 1; c <= logoEndCol; c++) {
        ws.getCell(r, c).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: WHITE },
        };
      }
    }
    ws.getCell(row, 1).alignment = { vertical: "middle", horizontal: "center" };
  }

  if (logoId != null) {
    ws.addImage(logoId, {
      tl: { col: 0.15, row: 0.1 },
      ext: { width: 76, height: 76 },
    });
  }

  if (brandEndCol > logoEndCol) {
    safeMergeCells(ws, row, logoEndCol + 1, row + 1, brandEndCol);
    const brandCell = ws.getCell(row, logoEndCol + 1);
    brandCell.value = "ALDEPOSITOS";
    brandCell.font = { name: FONT, size: 24, bold: true, color: { argb: WHITE } };
    brandCell.alignment = { vertical: "bottom", horizontal: "left", indent: 1 };

    safeMergeCells(ws, row + 2, logoEndCol + 1, row + 2, brandEndCol);
    const taglineCell = ws.getCell(row + 2, logoEndCol + 1);
    taglineCell.value = "Servicios logísticos integrales";
    taglineCell.font = {
      name: FONT,
      size: 9,
      italic: true,
      color: { argb: MUTED_ON_DARK },
    };
    taglineCell.alignment = { vertical: "top", horizontal: "left", indent: 1 };
  }

  if (infoStartCol <= colCount) {
    safeMergeCells(ws, row, infoStartCol, row + 1, colCount);
    const titleCell = ws.getCell(row, infoStartCol);
    titleCell.value = "REPORTE DE INGRESO";
    titleCell.font = { name: FONT, size: 11, bold: true, color: { argb: WHITE } };
    titleCell.alignment = { vertical: "bottom", horizontal: "right", indent: 1 };

    safeMergeCells(ws, row + 2, infoStartCol, row + 2, colCount);
    const metaRight = ws.getCell(row + 2, infoStartCol);
    metaRight.value = `${reportModuleLabel(task).toUpperCase()}  ·  ${currentDate}`;
    metaRight.font = { name: FONT, size: 9, color: { argb: MUTED_ON_DARK } };
    metaRight.alignment = { vertical: "top", horizontal: "right", indent: 1 };
  }

  ws.getRow(row).height = 32;
  ws.getRow(row + 1).height = 28;
  ws.getRow(row + 2).height = 24;
  row += 3;

  // ═══ BANNER RA ═══
  safeMergeCells(ws, row, 1, row, colCount);
  const raBanner = ws.getCell(row, 1);
  raBanner.value = {
    richText: [
      {
        font: { name: FONT, size: 9, color: { argb: MUTED } },
        text: "RECIBO DE ALMACÉN  ",
      },
      {
        font: { name: FONT, size: 20, bold: true, color: { argb: BRAND } },
        text: `RA-${(task.ra || "—").toUpperCase()}`,
      },
    ],
  };
  raBanner.alignment = { vertical: "middle", horizontal: "center" };
  raBanner.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: KPI_BG },
  };
  raBanner.border = thinBorder();
  ws.getRow(row).height = 40;
  row += 1;

  // ═══ DATOS DEL ENVÍO (4 campos en 2 filas) ═══
  const spans = buildFieldSpans(colCount);
  const valueRow = row + 1;

  const fields = [
    ["CLIENTE", (task.mainClient || "—").toUpperCase(), true],
    ["EXPEDIDOR", (task.subClient || "—").toUpperCase(), false],
    ["PROVEEDOR", (task.provider || "—").toUpperCase(), false],
    ["MARCA", (task.brand || "—").toUpperCase(), false],
  ] as const;

  let maxValueRowHeight = 36;
  fields.forEach(([label, value, hero], i) => {
    const [c1, c2] = spans[i]!;
    writeFieldBlock(ws, row, valueRow, c1, c2, label, value, { hero });
    const fontSize = hero ? 12 : 10;
    const blockHeight = valueRowHeightForText(
      value,
      mergedColumnsWidth(ws, c1, c2),
      fontSize,
    );
    maxValueRowHeight = Math.max(maxValueRowHeight, blockHeight);
  });
  ws.getRow(row).height = 18;
  ws.getRow(valueRow).height = maxValueRowHeight;
  row += 2;

  // ═══ KPIs (bultos, volumen, peso) ═══
  const kpiLabels = isDetailed
    ? ["BULTOS", "UNIDADES", "VOLUMEN (m³)", "PESO (kg)"]
    : ["BULTOS", "VOLUMEN (m³)", "PESO (kg)"];
  const kpiValues = isDetailed
    ? [
        String(totals.bultos),
        String(totals.unidades),
        totals.cbm,
        totals.weight.toFixed(2),
      ]
    : [String(totals.bultos), totals.cbm, totals.weight.toFixed(2)];

  const kpiSpan = Math.floor(colCount / kpiLabels.length);
  for (let i = 0; i < kpiLabels.length; i++) {
    const c1 = i * kpiSpan + 1;
    const c2 = i === kpiLabels.length - 1 ? colCount : (i + 1) * kpiSpan;
    safeMergeCells(ws, row, c1, row, c2);

    const kpiCell = ws.getCell(row, c1);
    kpiCell.value = {
      richText: [
        {
          font: { name: FONT, size: 8, bold: true, color: { argb: MUTED } },
          text: `${kpiLabels[i]}\n`,
        },
        {
          font: { name: FONT, size: 18, bold: true, color: { argb: BRAND } },
          text: kpiValues[i]!,
        },
      ],
    };
    kpiCell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    kpiCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: WHITE },
    };
    kpiCell.border = {
      ...thinBorder(),
      top: { style: "medium", color: { argb: BRAND_LIGHT } },
      bottom: { style: "medium", color: { argb: BRAND_LIGHT } },
    };
  }
  ws.getRow(row).height = 48;
  row += 2;

  // ═══ TABLA DE DIMENSIONES ═══
  safeMergeCells(ws, row, 1, row, colCount);
  setSectionTitle(ws.getCell(row, 1), "DETALLE DE DIMENSIONES");
  const repeatTitleStartRow = row;
  row += 1;

  headers.forEach((label, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = label;
    cell.font = {
      name: FONT,
      size: 9,
      bold: true,
      color: { argb: WHITE },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: i === headers.length - 1 ? ACCENT : BRAND },
    };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thinBorder(BRAND);
  });
  ws.getRow(row).height = 24;
  const repeatTitleEndRow = row;
  row += 1;

  const PALLET_HEADER_BG = "FFEEF2FF";
  const PALLET_HEADER_TEXT = "FF3730A3";
  const REEMPAQUE_BG = "FFF5F3FF";

  let lastPallet: number | null = null;
  let palletLineNum = 0;

  measureRows.forEach((measureRow, idx) => {
    if (isPalletized) {
      const pnum = reportRowPallet(measureRow);
      if (pnum !== lastPallet) {
        lastPallet = pnum;
        palletLineNum = 0;
        const pWeight = reportPalletWeight(measureRows, pnum);
        safeMergeCells(ws, row, 1, row, colCount);
        const pCell = ws.getCell(row, 1);
        pCell.value = {
          richText: [
            {
              font: { name: FONT, size: 10, bold: true, color: { argb: PALLET_HEADER_TEXT } },
              text: `PALETA ${pnum}`,
            },
            {
              font: { name: FONT, size: 9, color: { argb: MUTED } },
              text: `     ·     Peso paleta: `,
            },
            {
              font: { name: FONT, size: 10, bold: true, color: { argb: PALLET_HEADER_TEXT } },
              text: `${pWeight.toFixed(2)} kg`,
            },
          ],
        };
        pCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
        pCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: PALLET_HEADER_BG },
        };
        pCell.border = thinBorder();
        ws.getRow(row).height = 22;
        row += 1;
      }
      palletLineNum += 1;
    }

    const isReempaque = measureRow.reempaque === true;
    const values = isDetailed
      ? buildDetailedRow(measureRow, idx)
      : isPalletized
        ? buildPalletizedRow(measureRow, palletLineNum)
        : buildQuickRow(measureRow, idx, showReferenceColumn, showWeightColumn);

    const rowBg = isReempaque ? REEMPAQUE_BG : idx % 2 === 0 ? WHITE : ROW_ALT;

    values.forEach((val, ci) => {
      const cell = ws.getCell(row, ci + 1);
      cell.value = val;
      const isCbmCol = ci === values.length - 1;
      cell.font = {
        name: FONT,
        size: 10,
        bold: isCbmCol,
        color: { argb: isCbmCol ? CBM_TEXT : TEXT },
      };
      cell.alignment = {
        horizontal:
          ci === 0 || typeof val === "number" ? "center" : "left",
        vertical: "middle",
        indent: ci === 0 || typeof val === "number" ? 0 : 1,
        wrapText: ci === 2,
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: rowBg },
      };
      cell.border = thinBorder();
    });
    ws.getRow(row).height = 22;
    row += 1;
  });

  if (measureRows.length === 0) {
    safeMergeCells(ws, row, 1, row, colCount);
    const emptyCell = ws.getCell(row, 1);
    emptyCell.value = "Sin líneas de medida registradas.";
    emptyCell.font = { name: FONT, size: 10, italic: true, color: { argb: MUTED } };
    emptyCell.alignment = { horizontal: "center", vertical: "middle" };
    emptyCell.border = thinBorder();
    row += 1;
  }

  const dataEndRow = row - 1;
  const tailStartRow = row;

  // ═══ OBSERVACIONES ═══
  if (task.notes?.trim()) {
    row += 1;
    safeMergeCells(ws, row, 1, row, colCount);
    setSectionTitle(ws.getCell(row, 1), "OBSERVACIONES");
    row += 1;

    safeMergeCells(ws, row, 1, row, colCount);
    const notesCell = ws.getCell(row, 1);
    notesCell.value = task.notes.trim();
    notesCell.font = { name: FONT, size: 10, color: { argb: TEXT } };
    notesCell.alignment = {
      vertical: "top",
      horizontal: "left",
      indent: 1,
      wrapText: true,
    };
    notesCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: KPI_BG },
    };
    notesCell.border = thinBorder();
    ws.getRow(row).height = 32;
    row += 1;
  }

  row += 1;
  safeMergeCells(ws, row, 1, row, colCount);
  const footer = ws.getCell(row, 1);
  footer.value = "ALDEPOSITOS  ·  Documento generado automáticamente";
  footer.font = { name: FONT, size: 8, color: { argb: MUTED } };
  footer.alignment = { horizontal: "center", vertical: "middle" };
  footer.border = {
    top: { style: "thin", color: { argb: BORDER } },
  };

  const lastRow = row;
  paintCanvas(ws, lastRow, colCount);
  applySheetPrintSetup(
    ws,
    lastRow,
    colCount,
    measureRows.length,
    isDetailed,
    repeatTitleStartRow,
    repeatTitleEndRow,
  );
  ws.views = [{ showGridLines: false, zoomScale: 100 }];

  (ws as WorksheetWithMeta).reportExportMeta = {
    repeatTitleStartRow,
    repeatTitleEndRow,
    dataStartRow: repeatTitleEndRow + 1,
    dataEndRow,
    tailStartRow,
    lastRow,
    colCount,
    isDetailed,
  };
}

export async function buildReportWorkbook(params: {
  tasks: Task[];
  currentDate?: string;
}): Promise<ReportWorkbookResult> {
  const { tasks } = params;
  if (tasks.length === 0) {
    throw new Error("No hay tareas para exportar.");
  }

  const currentDate =
    params.currentDate ??
    new Date().toLocaleDateString("es-PA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

  const ExcelJSMod = await loadExcelJS();
  const wb = new ExcelJSMod.Workbook();
  wb.creator = "ALDEPOSITOS";
  wb.created = new Date();

  const logoBuffer = await loadLogoBuffer();
  const logoDataUrl = await loadLogoDataUrl();
  const logoId =
    logoBuffer != null
      ? wb.addImage({ buffer: logoBuffer, extension: "png" })
      : null;

  for (const task of tasks) {
    addReportSheet(wb, task, currentDate, logoId);
  }

  return { workbook: wb, logoDataUrl };
}

export async function downloadReportExcel(params: {
  tasks: Task[];
  currentDate?: string;
}): Promise<void> {
  const { tasks } = params;
  if (tasks.length === 0) return;

  const { workbook } = await buildReportWorkbook(params);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${buildReportExcelFilename(tasks)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
