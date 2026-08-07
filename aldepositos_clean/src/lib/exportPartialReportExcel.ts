import type { Task } from "@/lib/types/task";
import {
  buildNamedReportWorkbook,
  buildReportExcelFilename,
} from "@/lib/exportReportExcel";
import {
  sanitizeWarehouseBultosMap,
  splitInventoryPartial,
} from "@/lib/inventoryPartialSplit";

function safePartialSheetName(raw: string, fallback: string): string {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/[\\/*?:[\]]/g, "-")
    .slice(0, 31);
  return cleaned || fallback;
}

export function buildPartialReportExcelFilename(
  task: Task,
  containerName: string,
): string {
  const base = buildReportExcelFilename([task]);
  const cont = safePartialSheetName(containerName, "CONT").replace(/\s+/g, "_");
  return `${base}_parcial_${cont}`;
}

/**
 * Excel de 3 hojas: RA completo · contenedor (cargado) · EN ALMACEN.
 */
export async function downloadPartialReportExcel(params: {
  task: Task;
  containerName: string;
  warehouseBultosByRowId: Record<string, number>;
}): Promise<void> {
  const { task, containerName } = params;
  const map = sanitizeWarehouseBultosMap(task, params.warehouseBultosByRowId);
  const split = splitInventoryPartial(task, map);

  const raSheet = safePartialSheetName(
    `RA-${String(task.ra ?? "").trim() || "S-N"}`,
    "RA",
  );
  const containerSheet = safePartialSheetName(containerName, "CONTENEDOR");
  const warehouseSheet = "EN ALMACEN";

  const { workbook } = await buildNamedReportWorkbook({
    sheets: [
      { task: split.fullTask, sheetName: raSheet },
      { task: split.loadedTask, sheetName: containerSheet },
      { task: split.warehouseTask, sheetName: warehouseSheet },
    ],
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${buildPartialReportExcelFilename(task, containerName)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
