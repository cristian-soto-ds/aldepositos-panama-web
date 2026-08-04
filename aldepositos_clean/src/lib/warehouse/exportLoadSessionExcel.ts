/**
 * Excel de sesión de carga/descarga: resumen, detalle de scans y faltantes.
 */

import type ExcelJS from "exceljs";
import type {
  LoadSessionRaProgress,
  WarehouseLoadSession,
  WarehousePackageScan,
} from "@/lib/warehouse/types";

type ExcelJSNamespace = typeof import("exceljs");

async function loadExcelJS(): Promise<ExcelJSNamespace> {
  const mod = await import("exceljs");
  return ((mod as { default?: ExcelJSNamespace }).default ??
    mod) as ExcelJSNamespace;
}

const HEADER_BLUE = "FF16263F";
const HEADER_TEXT = "FFFFFFFF";
const ROW_ALT = "FFE8F1FB";

function styleHeader(row: ExcelJS.Row, cols: number) {
  for (let c = 1; c <= cols; c += 1) {
    const cell = row.getCell(c);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_BLUE },
    };
    cell.font = {
      name: "Calibri",
      bold: true,
      color: { argb: HEADER_TEXT },
      size: 11,
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  }
  row.height = 22;
}

function altFill(row: ExcelJS.Row, cols: number, odd: boolean) {
  if (!odd) return;
  for (let c = 1; c <= cols; c += 1) {
    row.getCell(c).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: ROW_ALT },
    };
  }
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-PA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export async function downloadLoadSessionExcel(input: {
  session: WarehouseLoadSession;
  progress: LoadSessionRaProgress[];
  scans: WarehousePackageScan[];
}): Promise<void> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = "ALDEPOSITOS";
  wb.created = new Date();

  const kindLabel =
    input.session.kind === "carga" ? "CARGA" : "DESCARGA";

  // ── Resumen ──
  const wsR = wb.addWorksheet("Resumen");
  wsR.getCell("A1").value = `RELACIÓN DE ${kindLabel}`;
  wsR.getCell("A1").font = { bold: true, size: 14, color: { argb: HEADER_BLUE } };
  wsR.mergeCells("A1:H1");
  wsR.getCell("A2").value =
    `Contenedor: ${input.session.container_number || "—"}  ·  Estado: ${input.session.status}`;
  wsR.getCell("A3").value =
    `Creada: ${fmtWhen(input.session.created_at)}  ·  Responsable: ${input.session.created_by || "—"}` +
    (input.session.closed_at
      ? `  ·  Cerrada: ${fmtWhen(input.session.closed_at)}`
      : "");
  if (input.session.notes) {
    wsR.getCell("A4").value = `Notas: ${input.session.notes}`;
  }

  const headerR = 6;
  const headersR = [
    "RA",
    "Cliente",
    "Expedidor",
    "Código pedido",
    "Esperados",
    "Leídos",
    "Faltantes",
    "Estado",
  ];
  headersR.forEach((h, i) => {
    wsR.getCell(headerR, i + 1).value = h;
  });
  styleHeader(wsR.getRow(headerR), 8);
  wsR.getColumn(1).width = 12;
  wsR.getColumn(2).width = 22;
  wsR.getColumn(3).width = 22;
  wsR.getColumn(4).width = 28;
  wsR.getColumn(5).width = 12;
  wsR.getColumn(6).width = 10;
  wsR.getColumn(7).width = 12;
  wsR.getColumn(8).width = 12;

  let totalExp = 0;
  let totalScan = 0;
  input.progress.forEach((p, i) => {
    const miss = p.missingSeqs.length;
    totalExp += p.expectedBultos;
    totalScan += p.scannedBultos;
    const estado =
      p.expectedBultos <= 0
        ? p.scannedBultos > 0
          ? "LEÍDO"
          : "—"
        : miss === 0
          ? "COMPLETO"
          : p.scannedBultos === 0
            ? "PENDIENTE"
            : "PARCIAL";
    const rowNum = headerR + 1 + i;
    const row = wsR.getRow(rowNum);
    row.values = [
      p.ra,
      p.clientDisplay || "—",
      p.shipperLabel || "—",
      p.orderBarcode || "—",
      p.expectedBultos,
      p.scannedBultos,
      miss,
      estado,
    ];
    altFill(row, 8, i % 2 === 1);
  });
  const tot = wsR.getRow(headerR + 1 + input.progress.length);
  tot.values = [
    "TOTAL",
    "",
    "",
    "",
    totalExp,
    totalScan,
    Math.max(0, totalExp - totalScan),
    "",
  ];
  tot.font = { bold: true };

  // ── Detalle ──
  const wsD = wb.addWorksheet("Detalle scans");
  const headersD = ["Hora", "RA", "Bulto", "Código", "Usuario"];
  headersD.forEach((h, i) => {
    wsD.getCell(1, i + 1).value = h;
  });
  styleHeader(wsD.getRow(1), 5);
  wsD.getColumn(1).width = 20;
  wsD.getColumn(2).width = 12;
  wsD.getColumn(3).width = 10;
  wsD.getColumn(4).width = 16;
  wsD.getColumn(5).width = 22;
  input.scans.forEach((s, i) => {
    const row = wsD.getRow(i + 2);
    row.values = [
      fmtWhen(s.scanned_at),
      s.ra,
      s.package_seq,
      s.package_barcode,
      s.scanned_by_label || "—",
    ];
    altFill(row, 5, i % 2 === 1);
  });

  // ── Faltantes ──
  const wsF = wb.addWorksheet("Faltantes");
  ["RA", "Bulto faltante", "Código esperado"].forEach((h, i) => {
    wsF.getCell(1, i + 1).value = h;
  });
  styleHeader(wsF.getRow(1), 3);
  wsF.getColumn(1).width = 12;
  wsF.getColumn(2).width = 14;
  wsF.getColumn(3).width = 16;
  let fi = 0;
  for (const p of input.progress) {
    for (const seq of p.missingSeqs) {
      const row = wsF.getRow(fi + 2);
      row.values = [
        p.ra,
        seq,
        `${p.ra}-${String(seq).padStart(3, "0")}`,
      ];
      altFill(row, 3, fi % 2 === 1);
      fi += 1;
    }
  }
  if (fi === 0) {
    wsF.getCell(2, 1).value = "Sin faltantes";
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const safeCont = (input.session.container_number || "sesion")
    .replace(/[^\w\-]+/g, "_")
    .slice(0, 40);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${kindLabel.toLowerCase()}-${safeCont}-${stamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}
