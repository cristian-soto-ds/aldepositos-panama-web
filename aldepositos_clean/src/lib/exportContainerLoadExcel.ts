/**
 * Excel de un cargue de contenedor con el estado de inventario de cada RA.
 */

import type ExcelJS from "exceljs";
import {
  CONTAINER_LOAD_STATE_LABELS,
  type ContainerLoadItemState,
  type ContainerLoadSummary,
} from "@/lib/containerLoadStatus";

type ExcelJSNamespace = typeof import("exceljs");

async function loadExcelJS(): Promise<ExcelJSNamespace> {
  const mod = await import("exceljs");
  return ((mod as { default?: ExcelJSNamespace }).default ??
    mod) as ExcelJSNamespace;
}

const HEADER_BLUE = "FF16263F";
const HEADER_TEXT = "FFFFFFFF";
const ROW_ALT = "FFE8F1FB";

const STATE_FILL: Record<ContainerLoadItemState, string> = {
  completed: "FFD1FAE5",
  in_progress: "FFDBEAFE",
  pending: "FFFEE2E2",
  rectification: "FFFEF3C7",
  not_required: "FFD1FAE5",
  missing: "FFE2E8F0",
};

const HEADERS = [
  "Posición",
  "RA",
  "Estado inventario",
  "Proveedor",
  "Expedidor",
  "Seguimiento",
  "Bultos",
  "Bultos capturados",
  "CBM",
  "Peso",
  "Notas",
];

function styleHeader(row: ExcelJS.Row) {
  for (let c = 1; c <= HEADERS.length; c += 1) {
    const cell = row.getCell(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_BLUE } };
    cell.font = { name: "Calibri", bold: true, color: { argb: HEADER_TEXT }, size: 11 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  }
  row.height = 24;
}

export async function downloadContainerLoadExcel(
  summary: ContainerLoadSummary,
): Promise<void> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = "ALDEPOSITOS";
  wb.created = new Date();
  const ws = wb.addWorksheet("Cargue");

  ws.getCell("A1").value = `CARGUE DE CONTENEDOR · ${summary.load.name}`;
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: HEADER_BLUE } };
  ws.mergeCells(1, 1, 1, HEADERS.length);
  ws.getCell("A2").value =
    `Listos: ${summary.ready}/${summary.total}` +
    (summary.notRequired > 0 ? ` (${summary.notRequired} sin inventario)` : "") +
    `  ·  Sin inventariar: ${summary.notInventoried}` +
    `  ·  Estado del cargue: ${summary.load.status === "open" ? "Abierto" : "Cerrado"}`;
  ws.mergeCells(2, 1, 2, HEADERS.length);

  const headerRowIdx = 4;
  HEADERS.forEach((h, i) => {
    ws.getCell(headerRowIdx, i + 1).value = h;
  });
  styleHeader(ws.getRow(headerRowIdx));
  [10, 12, 22, 28, 28, 22, 10, 12, 10, 12, 30].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  summary.rows.forEach((r, i) => {
    const row = ws.getRow(headerRowIdx + 1 + i);
    row.values = [
      r.item.position,
      r.item.ra,
      CONTAINER_LOAD_STATE_LABELS[r.state],
      r.item.proveedor ?? r.task?.provider ?? "",
      r.item.expedidor ?? "",
      r.item.seguimiento ?? "",
      r.item.bultos ?? r.task?.expectedBultos ?? "",
      r.task?.currentBultos ?? 0,
      r.item.cbm ?? "",
      r.item.peso ?? "",
      [r.item.noInventoryRequired ? r.item.noInventoryReason : "", r.item.notas]
        .filter(Boolean)
        .join(" · "),
    ];
    if (i % 2 === 1) {
      for (let c = 1; c <= HEADERS.length; c += 1) {
        row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROW_ALT } };
      }
    }
    row.getCell(3).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: STATE_FILL[r.state] },
    };
    row.getCell(3).font = { bold: true };
    row.alignment = { vertical: "middle" };
  });

  const totalRow = ws.getRow(headerRowIdx + 1 + summary.rows.length);
  totalRow.getCell(6).value = "TOTALES";
  totalRow.getCell(7).value = summary.totals.bultos;
  totalRow.getCell(8).value = summary.totals.capturedBultos;
  totalRow.getCell(9).value = summary.totals.cbm;
  totalRow.getCell(10).value = summary.totals.peso;
  totalRow.font = { bold: true };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = summary.load.name.replace(/[^\w\-]+/g, "_").slice(0, 50) || "cargue";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `cargue-${safeName}-${stamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}
