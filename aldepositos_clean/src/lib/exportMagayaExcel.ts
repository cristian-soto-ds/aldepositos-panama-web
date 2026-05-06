/**
 * Excel Magaya: mismos datos que el CSV, con formato de número en Excel.
 * La columna «cantidad por bulto» usa valor numérico completo y formato `0` decimales
 * (se ve 47 y en la barra de fórmulas ~46,666…), igual que al formatear en Excel.
 */

import ExcelJS from "exceljs";

import {
  MAGAYA_HEADERS,
  buildMagayaRowValues,
} from "@/lib/exportMagayaCsv";
import { rowHasExportableData } from "@/lib/exportInventarioCsv";

/** One-based column index: «cantidad por bulto». */
const COL_CANTIDAD_POR_BULTO = 9;

export async function downloadMagayaReferenciasExcel(params: {
  measureRows: Record<string, unknown>[];
  filenameBase: string;
}): Promise<void> {
  const rows = params.measureRows.filter((r) => rowHasExportableData(r));
  if (rows.length === 0) return;

  const wb = new ExcelJS.Workbook();
  wb.creator = "ALDEPOSITOS";
  wb.created = new Date();

  const ws = wb.addWorksheet("Magaya", {
    properties: { defaultRowHeight: 18 },
  });

  ws.addRow([...MAGAYA_HEADERS]);
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, name: "Calibri", size: 11 };
  headerRow.alignment = { vertical: "middle", wrapText: true };

  for (const row of rows) {
    const values = buildMagayaRowValues(row);
    const added = ws.addRow(values);
    const cell = added.getCell(COL_CANTIDAD_POR_BULTO);
    if (typeof cell.value === "number" && Number.isFinite(cell.value)) {
      cell.numFmt = "0";
    }
  }

  for (let c = 1; c <= MAGAYA_HEADERS.length; c++) {
    const col = ws.getColumn(c);
    let max = 12;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      const len =
        v === null || v === undefined
          ? 0
          : typeof v === "number"
            ? String(v).length
            : String(v).length;
      if (len > max) max = Math.min(len, 48);
    });
    col.width = max + 2;
  }

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
