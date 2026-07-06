/**
 * Genera el PDF del reporte a partir del mismo workbook Excel (misma fuente que .xlsx).
 */

import type ExcelJS from "exceljs";
import type { Task } from "@/lib/types/task";
import {
  buildReportWorkbook,
  type ReportSheetExportMeta,
} from "@/lib/exportReportExcel";
import { buildReportDownloadFilename } from "@/lib/reportDownloadFilename";
import { supabase } from "@/lib/supabase";
import {
  exportReportPdfFromExportRoot,
  PDF_EXPORT_WIDTH_PX,
  waitForReportDomReady,
} from "@/components/control-panel/reportsPdfExport";

const PX_PER_COL = 7.5;
const PX_PER_POINT = 1.38;
const ROW_HEIGHT_BUFFER = 1.12;
const LETTER_HEIGHT_PX = 1056;
const PDF_CONTENT_PAD_X = 8;

type MergeMaster = { colspan: number; rowspan: number };
type MergeMaps = {
  masters: Map<string, MergeMaster>;
  covered: Set<string>;
};

function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

function decodeA1(a1: string): { row: number; col: number } {
  const m = /^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(a1.trim());
  if (!m) return { row: 1, col: 1 };
  const letters = m[2]!.toUpperCase();
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return { row: parseInt(m[4]!, 10), col };
}

function argbToCss(argb?: string): string | undefined {
  if (!argb) return undefined;
  const hex = argb.replace(/^#/, "").toUpperCase();
  if (hex.length === 8) return `#${hex.slice(2)}`;
  if (hex.length === 6) return `#${hex}`;
  return undefined;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function collectMerges(ws: ExcelJS.Worksheet): MergeMaps {
  const masters = new Map<string, MergeMaster>();
  const covered = new Set<string>();
  const model = ws as unknown as { model?: { merges?: string[] } };
  const merges = model.model?.merges ?? [];

  for (const range of merges) {
    const parts = range.split(":");
    if (parts.length !== 2) continue;
    const start = decodeA1(parts[0]!);
    const end = decodeA1(parts[1]!);
    const colspan = end.col - start.col + 1;
    const rowspan = end.row - start.row + 1;
    masters.set(cellKey(start.row, start.col), { colspan, rowspan });
    for (let r = start.row; r <= end.row; r++) {
      for (let c = start.col; c <= end.col; c++) {
        if (r !== start.row || c !== start.col) {
          covered.add(cellKey(r, c));
        }
      }
    }
  }
  return { masters, covered };
}

function cellPlainValue(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "object" && "richText" in v && Array.isArray(v.richText)) {
    return v.richText.map((seg) => seg.text ?? "").join("");
  }
  if (typeof v === "object" && "text" in v && typeof v.text === "string") {
    return v.text;
  }
  if (typeof v === "object" && "result" in v) {
    return v.result != null ? String(v.result) : "";
  }
  return String(v);
}

function cellInnerHtml(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v && typeof v === "object" && "richText" in v && Array.isArray(v.richText)) {
    return v.richText
      .map((seg) => {
        const f = seg.font ?? {};
        const styles = [
          f.bold ? "font-weight:700" : "",
          f.size ? `font-size:${f.size}px` : "",
          f.size ? `line-height:1.45` : "",
          f.color?.argb ? `color:${argbToCss(f.color.argb)}` : "",
          f.italic ? "font-style:italic" : "",
        ]
          .filter(Boolean)
          .join(";");
        return `<span style="${styles}">${escapeHtml(seg.text ?? "")}</span>`;
      })
      .join("");
  }
  return escapeHtml(cellPlainValue(cell));
}

function borderCss(
  borders: Partial<ExcelJS.Borders> | undefined,
  side: keyof ExcelJS.Borders,
): string {
  const edge = borders?.[side];
  if (!edge || edge.style === undefined) return "1px solid transparent";
  const color = argbToCss(edge.color?.argb) ?? "#e2e8f0";
  const w = edge.style === "medium" ? "2px" : "1px";
  return `${w} solid ${color}`;
}

function cellStyleAttr(
  cell: ExcelJS.Cell,
  opts?: { minHeightPx?: number },
): string {
  const fill = cell.fill as ExcelJS.FillPattern | undefined;
  const bg =
    fill?.type === "pattern" && fill.fgColor?.argb
      ? argbToCss(fill.fgColor.argb)
      : "#ffffff";
  const font = cell.font ?? {};
  const color = argbToCss(font.color?.argb) ?? "#1e293b";
  const align = cell.alignment ?? {};
  const borders = cell.border;
  const fontSize = font.size ?? 10;

  const styles = [
    `background-color:${bg}`,
    `color:${color}`,
    `font-family:${font.name ?? "Calibri"},Arial,sans-serif`,
    `font-size:${fontSize}px`,
    `line-height:1.45`,
    font.bold ? "font-weight:700" : "font-weight:400",
    font.italic ? "font-style:italic" : "",
    `text-align:${align.horizontal ?? "left"}`,
    `vertical-align:${align.vertical ?? "middle"}`,
    align.wrapText
      ? "white-space:normal;word-break:break-word;overflow-wrap:anywhere"
      : "white-space:normal",
    `border-top:${borderCss(borders, "top")}`,
    `border-right:${borderCss(borders, "right")}`,
    `border-bottom:${borderCss(borders, "bottom")}`,
    `border-left:${borderCss(borders, "left")}`,
    align.indent ? `padding-left:${(align.indent ?? 0) * 6 + 6}px` : "padding-left:6px",
    "padding-right:6px",
    "padding-top:5px",
    "padding-bottom:5px",
    "box-sizing:border-box",
    "overflow:visible",
    opts?.minHeightPx ? `min-height:${opts.minHeightPx}px` : "",
    opts?.minHeightPx ? `height:${opts.minHeightPx}px` : "",
  ]
    .filter(Boolean)
    .join(";");

  return styles;
}

function columnWidthPx(ws: ExcelJS.Worksheet, col: number): number {
  const w = ws.getColumn(col).width ?? 10;
  return Math.max(24, Math.round(w * PX_PER_COL));
}

function rowHeightPx(ws: ExcelJS.Worksheet, row: number): number {
  const h = ws.getRow(row).height;
  const base = h && h > 0 ? h * PX_PER_POINT : 20 * PX_PER_POINT;
  return Math.ceil(base * ROW_HEIGHT_BUFFER);
}

function spanHeightPx(
  ws: ExcelJS.Worksheet,
  startRow: number,
  rowspan: number,
): number {
  let total = 0;
  for (let r = startRow; r < startRow + rowspan; r++) {
    total += rowHeightPx(ws, r);
  }
  return total;
}

function estimateCellMinHeight(cell: ExcelJS.Cell, widthPx: number): number {
  const font = cell.font ?? {};
  const fontSize = font.size ?? 10;
  const align = cell.alignment ?? {};
  const text = cellPlainValue(cell);
  const lines = align.wrapText
    ? Math.max(1, Math.ceil(text.length / Math.max(8, Math.floor(widthPx / (fontSize * 0.55)))))
    : 1;
  return Math.ceil(fontSize * 1.55 * lines + 14);
}

function cellContentHtml(
  cell: ExcelJS.Cell,
  rowNum: number,
  colNum: number,
  master: MergeMaster | undefined,
  logoDataUrl: string | null,
): string {
  const isLogoSlot =
    logoDataUrl &&
    rowNum === 1 &&
    colNum === 1 &&
    (master?.rowspan ?? 1) >= 2;
  if (isLogoSlot) {
    return `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:6px 4px"><img src="${logoDataUrl}" alt="ALDEPOSITOS" style="width:68px;height:68px;object-fit:contain;display:block" /></div>`;
  }
  return cellInnerHtml(cell);
}

function renderTableRows(
  ws: ExcelJS.Worksheet,
  rowNumbers: number[],
  colCount: number,
  merges: MergeMaps,
  logoDataUrl: string | null,
): string {
  const colWidths = Array.from({ length: colCount }, (_, i) =>
    columnWidthPx(ws, i + 1),
  );
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
  const targetWidth = PDF_EXPORT_WIDTH_PX - PDF_CONTENT_PAD_X * 2;
  const scale = Math.min(1, targetWidth / totalWidth);

  const scaledWidths = colWidths.map((w) => Math.max(20, Math.round(w * scale)));

  const colgroup = scaledWidths
    .map((w) => `<col style="width:${w}px" />`)
    .join("");

  const body = rowNumbers
    .map((rowNum) => {
      let trMinHeight = rowHeightPx(ws, rowNum);
      const cells: string[] = [];

      for (let col = 1; col <= colCount; col++) {
        const key = cellKey(rowNum, col);
        if (merges.covered.has(key)) continue;

        const cell = ws.getCell(rowNum, col);
        const master = merges.masters.get(key);
        const colspan = master?.colspan ?? 1;
        let cellWidth = 0;
        for (let c = col; c < col + colspan; c++) {
          cellWidth += scaledWidths[c - 1] ?? 0;
        }

        let minHeight = rowHeightPx(ws, rowNum);
        if (master?.rowspan && master.rowspan > 1) {
          minHeight = spanHeightPx(ws, rowNum, master.rowspan);
        }
        minHeight = Math.max(minHeight, estimateCellMinHeight(cell, cellWidth));
        trMinHeight = Math.max(trMinHeight, minHeight);

        const attrs = [
          master ? `colspan="${master.colspan}"` : "",
          master ? `rowspan="${master.rowspan}"` : "",
          `style="${cellStyleAttr(cell, { minHeightPx: minHeight })}"`,
        ]
          .filter(Boolean)
          .join(" ");

        cells.push(
          `<td ${attrs}>${cellContentHtml(cell, rowNum, col, master, logoDataUrl)}</td>`,
        );
      }
      return `<tr style="min-height:${trMinHeight}px;height:${trMinHeight}px">${cells.join("")}</tr>`;
    })
    .join("");

  const tableWidth = scaledWidths.reduce((a, b) => a + b, 0);
  return `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:${tableWidth}px;table-layout:fixed;font-family:Calibri,Arial,sans-serif;line-height:1.45">${colgroup}<tbody>${body}</tbody></table>`;
}

function paginateDataRows(
  meta: ReportSheetExportMeta,
  rowsPerPage: number,
): number[][] {
  const chunks: number[][] = [];
  if (meta.dataEndRow < meta.dataStartRow) {
    chunks.push([]);
    return chunks;
  }
  for (let start = meta.dataStartRow; start <= meta.dataEndRow; start += rowsPerPage) {
    const end = Math.min(meta.dataEndRow, start + rowsPerPage - 1);
    const pageRows: number[] = [];
    for (let r = start; r <= end; r++) pageRows.push(r);
    chunks.push(pageRows);
  }
  if (chunks.length === 0) chunks.push([]);
  return chunks;
}

function headerRows(meta: ReportSheetExportMeta, pageIndex: number): number[] {
  if (pageIndex === 0) {
    const rows: number[] = [];
    for (let r = 1; r <= meta.repeatTitleEndRow; r++) rows.push(r);
    return rows;
  }
  const rows: number[] = [];
  for (let r = meta.repeatTitleStartRow; r <= meta.repeatTitleEndRow; r++) {
    rows.push(r);
  }
  return rows;
}

function tailRows(meta: ReportSheetExportMeta): number[] {
  if (meta.tailStartRow > meta.lastRow) return [];
  const rows: number[] = [];
  for (let r = meta.tailStartRow; r <= meta.lastRow; r++) rows.push(r);
  return rows;
}

function worksheetToPageElements(
  ws: ExcelJS.Worksheet,
  logoDataUrl: string | null,
): HTMLDivElement[] {
  const meta = (ws as ExcelJS.Worksheet & { reportExportMeta?: ReportSheetExportMeta })
    .reportExportMeta;
  if (!meta) return [];

  const merges = collectMerges(ws);
  const rowsPerPage = meta.isDetailed ? 14 : 18;
  const dataChunks = paginateDataRows(meta, rowsPerPage);
  const pages: HTMLDivElement[] = [];

  dataChunks.forEach((dataRows, pageIndex) => {
    const rowNums = [
      ...headerRows(meta, pageIndex),
      ...dataRows,
      ...(pageIndex === dataChunks.length - 1 ? tailRows(meta) : []),
    ];

    const page = document.createElement("div");
    page.setAttribute("data-report-export-page", "true");
    page.style.width = `${PDF_EXPORT_WIDTH_PX}px`;
    page.style.minHeight = `${LETTER_HEIGHT_PX}px`;
    page.style.boxSizing = "border-box";
    page.style.backgroundColor = "#ffffff";
    page.style.padding = `8px ${PDF_CONTENT_PAD_X}px`;
    page.style.position = "relative";
    page.style.overflow = "visible";

    const tableWrap = document.createElement("div");
    tableWrap.style.position = "relative";
    tableWrap.style.width = "100%";
    tableWrap.innerHTML = renderTableRows(
      ws,
      rowNums,
      meta.colCount,
      merges,
      pageIndex === 0 ? logoDataUrl : null,
    );
    page.appendChild(tableWrap);

    pages.push(page);
  });

  return pages;
}

export function buildReportPdfFilename(
  tasks: Parameters<typeof buildReportDownloadFilename>[0],
): string {
  return `${buildReportDownloadFilename(tasks)}.pdf`;
}

async function waitForImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          const done = () => resolve();
          const timer = window.setTimeout(done, 8000);
          img.addEventListener("load", () => {
            window.clearTimeout(timer);
            done();
          }, { once: true });
          img.addEventListener("error", () => {
            window.clearTimeout(timer);
            done();
          }, { once: true });
        }),
    ),
  );
}

async function downloadPdfViaNativeExcelConversion(
  workbook: Awaited<ReturnType<typeof buildReportWorkbook>>["workbook"],
  filename: string,
): Promise<boolean> {
  try {
    const buffer = await workbook.xlsx.writeBuffer();
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    const res = await fetch("/api/reports/excel-to-pdf", {
      method: "POST",
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: buffer,
    });

    if (!res.ok) {
      console.warn("[Reports PDF] Conversión nativa no disponible:", res.status);
      return false;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch (e) {
    console.warn("[Reports PDF] Conversión nativa falló:", e);
    return false;
  }
}

async function downloadPdfViaHtmlFallback(
  workbook: Awaited<ReturnType<typeof buildReportWorkbook>>["workbook"],
  logoDataUrl: string | null,
  filename: string,
): Promise<void> {
  const container = document.createElement("div");
  container.id = "report-pdf-from-excel-root";
  container.style.position = "fixed";
  container.style.left = "-14000px";
  container.style.top = "0";
  container.style.zIndex = "-1";
  container.style.pointerEvents = "none";
  container.style.width = `${PDF_EXPORT_WIDTH_PX}px`;
  container.style.backgroundColor = "#ffffff";

  for (const ws of workbook.worksheets) {
    for (const page of worksheetToPageElements(ws, logoDataUrl)) {
      container.appendChild(page);
    }
  }

  document.body.appendChild(container);
  try {
    await waitForImages(container);
    await waitForReportDomReady();
    await exportReportPdfFromExportRoot(container, filename);
  } finally {
    document.body.removeChild(container);
  }
}

export async function downloadReportPdfFromExcel(params: {
  tasks: Task[];
  currentDate?: string;
}): Promise<void> {
  const { tasks } = params;
  if (tasks.length === 0) return;

  const { workbook, logoDataUrl } = await buildReportWorkbook(params);
  const filename = buildReportPdfFilename(tasks);

  const converted = await downloadPdfViaNativeExcelConversion(workbook, filename);
  if (converted) return;

  await downloadPdfViaHtmlFallback(workbook, logoDataUrl, filename);
}
