/**
 * Excel con el mismo contenido que el CSV inventario (detallado u otro variant),
 * con franjas de color suaves por bloque de orden. Los .csv no admiten color de celda.
 */

import ExcelJS from "exceljs";

import {
  buildInventarioExcelRowValues,
  getInventarioCsvHeaderLabels,
  rowHasExportableData,
  type InventarioCsvModule,
} from "@/lib/exportInventarioCsv";

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9EAD3" },
};

const ORDER_BAND_FILLS: ExcelJS.Fill[] = [
  { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5E6D3" } },
  { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6E3F8" } },
];

export type InventarioExcelSection = {
  numeroDocumento: string;
  measureRows: Record<string, unknown>[];
};

function applyColumnWidths(ws: ExcelJS.Worksheet, colCount: number): void {
  for (let c = 1; c <= colCount; c++) {
    const col = ws.getColumn(c);
    let max = 10;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      const len =
        v === null || v === undefined
          ? 0
          : typeof v === "number"
            ? String(v).length
            : String(v).length;
      if (len > max) max = Math.min(len, 42);
    });
    col.width = max + 2;
  }
}

/**
 * Varias órdenes: una hoja, mismas columnas que el CSV; encabezado verdoso y franjas alternas
 * si hay más de un bloque con filas.
 */
export async function downloadInventarioExcelFromSections(params: {
  sections: InventarioExcelSection[];
  variant: InventarioCsvModule;
  filenameBase: string;
  sheetName?: string;
}): Promise<void> {
  const blocks = params.sections
    .map((s) => ({
      num: s.numeroDocumento.trim(),
      rows: s.measureRows.filter((r) => rowHasExportableData(r)),
    }))
    .filter((b) => b.rows.length > 0);
  if (blocks.length === 0) return;

  const headers = getInventarioCsvHeaderLabels();
  const wb = new ExcelJS.Workbook();
  wb.creator = "ALDEPOSITOS";
  wb.created = new Date();

  const ws = wb.addWorksheet(params.sheetName ?? "Inventario", {
    properties: { defaultRowHeight: 18 },
  });

  ws.addRow(headers);
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, name: "Calibri", size: 11 };
  headerRow.alignment = { vertical: "middle", wrapText: true };
  headerRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = HEADER_FILL;
  });

  const useBandColors = blocks.length > 1;
  const variant = params.variant;

  for (let bi = 0; bi < blocks.length; bi++) {
    const bandFill = useBandColors ? ORDER_BAND_FILLS[bi % ORDER_BAND_FILLS.length] : undefined;
    for (const row of blocks[bi].rows) {
      const cells = buildInventarioExcelRowValues(blocks[bi].num, row, variant);
      const added = ws.addRow(cells);
      if (bandFill) {
        added.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = bandFill;
        });
      }
    }
  }

  applyColumnWidths(ws, headers.length);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${params.filenameBase.replace(/[/\\?%*:|"<>]/g, "-")}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
