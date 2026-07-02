import ExcelJS from "exceljs";
import {
  formatMinutesLabel,
  formatReportDateLabel,
  type DailyReceptionReportRow,
  type DailyReceptionReportSummary,
} from "@/lib/receptionLogistics/buildDailyReceptionReport";

const HEADER_BLUE = "FF16263F";
const HEADER_TEXT = "FFFFFFFF";
const TITLE_COLOR = "FF16263F";
const ROW_ALT = "FFF1F5F9";
const ACCENT_GREEN = "FFD1FAE5";
const ACCENT_AMBER = "FFFEF3C7";

export type ReceptionGeminiSummary = {
  titulo?: string;
  resumen?: string;
  hallazgos?: string[];
  recomendaciones?: string[];
  metricasDestacadas?: { label: string; valor: string }[];
};

const COLUMNS = [
  { key: "queuePosition", header: "# Fila", width: 8 },
  { key: "orNumero", header: "OR #", width: 10 },
  { key: "cliente", header: "Cliente", width: 28 },
  { key: "proveedor", header: "Proveedor", width: 22 },
  { key: "expedidor", header: "Expedidor", width: 20 },
  { key: "bultos", header: "Bultos", width: 9 },
  { key: "horaLlegada", header: "Hora llegada", width: 14 },
  { key: "minutosEnFila", header: "Espera en fila", width: 14 },
  { key: "horaRampa", header: "Hora rampa", width: 14 },
  { key: "rampa", header: "Rampa", width: 11 },
  { key: "minutosDescarga", header: "Tiempo descarga", width: 15 },
  { key: "horaCompletado", header: "Hora completado", width: 15 },
  { key: "minutosTotal", header: "Tiempo total", width: 13 },
  { key: "estado", header: "Estado", width: 13 },
  { key: "reciboAlmacen", header: "Recibo almacén", width: 22 },
  { key: "notas", header: "Notas", width: 24 },
] as const;

function thinBorder(): Partial<ExcelJS.Borders> {
  const edge = { style: "thin" as const, color: { argb: "FF94A3B8" } };
  return { top: edge, left: edge, bottom: edge, right: edge };
}

function cellValue(row: DailyReceptionReportRow, key: (typeof COLUMNS)[number]["key"]) {
  if (key === "queuePosition") {
    return row.queuePosition ?? "—";
  }
  if (key === "minutosEnFila" || key === "minutosDescarga" || key === "minutosTotal") {
    return formatMinutesLabel(row[key]);
  }
  return row[key as keyof DailyReceptionReportRow] ?? "";
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = {
      name: "Calibri",
      bold: true,
      size: 11,
      color: { argb: HEADER_TEXT },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_BLUE },
    };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = thinBorder();
  });
}

function addKpiRow(
  ws: ExcelJS.Worksheet,
  rowNum: number,
  label: string,
  value: string | number,
  fillArgb: string,
) {
  ws.mergeCells(rowNum, 1, rowNum, 4);
  ws.mergeCells(rowNum, 5, rowNum, 8);
  const labelCell = ws.getCell(rowNum, 1);
  labelCell.value = label;
  labelCell.font = { name: "Calibri", bold: true, size: 11, color: { argb: TITLE_COLOR } };
  labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
  labelCell.alignment = { vertical: "middle", horizontal: "left" };
  labelCell.border = thinBorder();

  const valueCell = ws.getCell(rowNum, 5);
  valueCell.value = value;
  valueCell.font = { name: "Calibri", bold: true, size: 12, color: { argb: TITLE_COLOR } };
  valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
  valueCell.alignment = { vertical: "middle", horizontal: "left" };
  valueCell.border = thinBorder();
}

function addGeminiSheet(
  wb: ExcelJS.Workbook,
  gemini: ReceptionGeminiSummary,
  dateLabel: string,
) {
  const ws = wb.addWorksheet("Resumen Alde.IA", {
    properties: { defaultRowHeight: 18 },
    views: [{ showGridLines: false }],
  });
  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 90;

  ws.mergeCells(1, 1, 1, 2);
  const title = ws.getCell(1, 1);
  title.value = gemini.titulo ?? `Análisis del día — ${dateLabel}`;
  title.font = { name: "Calibri", bold: true, size: 16, color: { argb: TITLE_COLOR } };
  title.alignment = { vertical: "middle", horizontal: "left" };

  let row = 3;
  if (gemini.resumen) {
    ws.getCell(row, 1).value = "Resumen ejecutivo";
    ws.getCell(row, 1).font = { bold: true, size: 12, color: { argb: TITLE_COLOR } };
    row += 1;
    ws.mergeCells(row, 1, row + 3, 2);
    ws.getCell(row, 1).value = gemini.resumen;
    ws.getCell(row, 1).alignment = { wrapText: true, vertical: "top" };
    ws.getCell(row, 1).font = { name: "Calibri", size: 11 };
    row += 5;
  }

  const writeList = (heading: string, items: string[] | undefined) => {
    if (!items?.length) return;
    ws.getCell(row, 1).value = heading;
    ws.getCell(row, 1).font = { bold: true, size: 12, color: { argb: TITLE_COLOR } };
    row += 1;
    for (const item of items) {
      ws.mergeCells(row, 1, row, 2);
      ws.getCell(row, 1).value = `• ${item}`;
      ws.getCell(row, 1).alignment = { wrapText: true, vertical: "top" };
      ws.getCell(row, 1).font = { name: "Calibri", size: 11 };
      row += 1;
    }
    row += 1;
  };

  writeList("Hallazgos", gemini.hallazgos);
  writeList("Recomendaciones", gemini.recomendaciones);

  if (gemini.metricasDestacadas?.length) {
    ws.getCell(row, 1).value = "Métricas destacadas";
    ws.getCell(row, 1).font = { bold: true, size: 12, color: { argb: TITLE_COLOR } };
    row += 1;
    for (const m of gemini.metricasDestacadas) {
      ws.getCell(row, 1).value = m.label;
      ws.getCell(row, 1).font = { bold: true, size: 11 };
      ws.getCell(row, 2).value = m.valor;
      ws.getCell(row, 2).font = { size: 11 };
      row += 1;
    }
  }
}

export async function downloadDailyReceptionExcel(params: {
  rows: DailyReceptionReportRow[];
  summary: DailyReceptionReportSummary;
  reportDate?: Date;
  exportedByLabel?: string;
  geminiSummary?: ReceptionGeminiSummary | null;
}): Promise<void> {
  const {
    rows,
    summary,
    reportDate = new Date(),
    exportedByLabel = "ALDEPOSITOS",
    geminiSummary,
  } = params;

  const dateLabel = formatReportDateLabel(reportDate);
  const dateStamp = reportDate.toISOString().slice(0, 10);

  const wb = new ExcelJS.Workbook();
  wb.creator = "ALDEPOSITOS";
  wb.created = new Date();

  const ws = wb.addWorksheet("Recepción OR del día", {
    properties: { defaultRowHeight: 18 },
    views: [{ state: "frozen", ySplit: 6, showGridLines: false }],
  });

  COLUMNS.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width;
  });

  ws.mergeCells(1, 1, 1, COLUMNS.length);
  const h1 = ws.getCell(1, 1);
  h1.value = "ALDEPÓSITOS — Reporte diario de recepción (OR)";
  h1.font = { name: "Calibri", bold: true, size: 18, color: { argb: TITLE_COLOR } };
  h1.alignment = { vertical: "middle", horizontal: "center" };

  ws.mergeCells(2, 1, 2, COLUMNS.length);
  const h2 = ws.getCell(2, 1);
  h2.value = dateLabel;
  h2.font = { name: "Calibri", bold: true, size: 12, color: { argb: "FF475569" } };
  h2.alignment = { vertical: "middle", horizontal: "center" };

  ws.mergeCells(3, 1, 3, COLUMNS.length);
  ws.getCell(3, 1).value = `Generado: ${new Date().toLocaleString("es-PA")} · ${exportedByLabel}`;
  ws.getCell(3, 1).font = { name: "Calibri", size: 10, color: { argb: "FF64748B" } };
  ws.getCell(3, 1).alignment = { horizontal: "center" };

  addKpiRow(ws, 4, "Total OR del día", summary.totalOr, ACCENT_AMBER);
  addKpiRow(ws, 5, "Total bultos", summary.totalBultos, ACCENT_GREEN);

  const headerRowNum = 6;
  const headerRow = ws.getRow(headerRowNum);
  headerRow.values = COLUMNS.map((c) => c.header);
  styleHeaderRow(headerRow);

  let dataRowNum = headerRowNum + 1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const excelRow = ws.getRow(dataRowNum);
    excelRow.values = COLUMNS.map((col) => cellValue(row, col.key));
    excelRow.height = 20;
    const alt = i % 2 === 1;
    excelRow.eachCell((cell) => {
      cell.font = { name: "Calibri", size: 10 };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      cell.border = thinBorder();
      if (alt) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: ROW_ALT },
        };
      }
      const col = typeof cell.col === "number" ? cell.col : Number(cell.col);
      if (col === 1 || col === 2 || col === 6) {
        cell.alignment = { ...cell.alignment, horizontal: "center" };
        cell.font = { ...cell.font, bold: true };
      }
    });
    dataRowNum += 1;
  }

  const totalsRow = dataRowNum + 1;
  ws.mergeCells(totalsRow, 1, totalsRow, 5);
  ws.getCell(totalsRow, 1).value = "RESUMEN DEL DÍA";
  ws.getCell(totalsRow, 1).font = { bold: true, size: 12, color: { argb: TITLE_COLOR } };

  const summaryLines = [
    `Completadas: ${summary.completadas} · En proceso: ${summary.enProceso}`,
    `Prom. espera en fila: ${formatMinutesLabel(summary.promedioMinFila)}`,
    `Prom. descarga: ${formatMinutesLabel(summary.promedioMinDescarga)}`,
    `Prom. tiempo total: ${formatMinutesLabel(summary.promedioMinTotal)}`,
  ];
  ws.mergeCells(totalsRow + 1, 1, totalsRow + 1, COLUMNS.length);
  ws.getCell(totalsRow + 1, 1).value = summaryLines.join("   |   ");
  ws.getCell(totalsRow + 1, 1).font = { name: "Calibri", size: 10, bold: true };
  ws.getCell(totalsRow + 1, 1).alignment = { wrapText: true };

  if (geminiSummary?.resumen || geminiSummary?.hallazgos?.length) {
    addGeminiSheet(wb, geminiSummary, dateLabel);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const filename = `Recepcion_OR_${dateStamp}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
