import ExcelJS from "exceljs";

const COLS = 11;
const HEADER_BLUE = "FF16263F";
const HEADER_TEXT = "FFFFFFFF";
const ROW_ALT_FILL = "FFE8F1FB";
const TITLE_COLOR = "FF16263F";
const META_BAND_FILL = "FFF1F5F9";
const TITLE_BAND_FILL = "FFE8EEF4";
const LABEL_FONT_SIZE = 12;
const DATA_FONT_SIZE = 11;

const labelFont: Partial<ExcelJS.Font> = {
  name: "Calibri",
  bold: true,
  size: LABEL_FONT_SIZE,
  color: { argb: TITLE_COLOR },
};

const valueFont: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 12,
  color: { argb: "FF1E293B" },
};

const metaBorderLight: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFCBD5E1" } },
  left: { style: "thin", color: { argb: "FFCBD5E1" } },
  bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
  right: { style: "thin", color: { argb: "FFCBD5E1" } },
};

export type RelacionCargaExportRow = {
  ra: string;
  partial: string;
  provider: string;
  subClient: string;
  brand: string;
  date: string;
  cbm: string;
  weight: string;
  desc: string;
  bultos: number;
};

export type RelacionCargaContainerInfo = {
  type: string;
  consignment: string;
  number: string;
  bl: string;
  seal1: string;
  seal2: string;
  responsible: string;
  date: string;
  tare?: number;
};

export type RelacionCargaExportTotals = {
  bultos: number;
  cbm: number;
  netWeight: number;
  tare: number;
  grossWeight: number;
};

function formatDateDisplay(isoOrDate: string): string {
  const s = String(isoOrDate ?? "").trim();
  if (!s) return "—";
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleDateString("es-PA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }
  return s;
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const edge = { style: "thin" as const, color: { argb: "FF94A3B8" } };
  return { top: edge, left: edge, bottom: edge, right: edge };
}

function strongBorder(): Partial<ExcelJS.Borders> {
  const edge = { style: "thin" as const, color: { argb: "FF000000" } };
  return { top: edge, left: edge, bottom: edge, right: edge };
}

/**
 * Excel con formato tipo plantilla “RELACION DE CARGA EN CONTENEDOR” (módulo entrega de carga).
 */
export async function downloadRelacionCargaExcel(params: {
  containerInfo: RelacionCargaContainerInfo;
  rows: RelacionCargaExportRow[];
  totals: RelacionCargaExportTotals;
  primaryClient: string;
  trackingRef: string;
  exportedByLabel: string;
  fileBaseName: string;
}): Promise<void> {
  const {
    containerInfo,
    rows,
    totals,
    primaryClient,
    trackingRef,
    exportedByLabel,
    fileBaseName,
  } = params;

  const wb = new ExcelJS.Workbook();
  wb.creator = "ALDEPOSITOS";
  wb.created = new Date();

  const ws = wb.addWorksheet("Relación de Carga", {
    properties: { defaultRowHeight: 18 },
    views: [{ showGridLines: false }],
  });
  ws.views = [{ state: "frozen", ySplit: 5, showGridLines: false }];
  ws.pageSetup = {
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.35, right: 0.35, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  };

  // Anchos equilibrados: bloque izquierdo legible (etiquetas combinadas) y tabla de datos.
  ws.columns = [
    { width: 7 },
    { width: 13 },
    { width: 11 },
    { width: 20 },
    { width: 21 },
    { width: 10 },
    { width: 16 },
    { width: 12 },
    { width: 11 },
    { width: 13 },
    { width: 39 },
  ];

  // --- Fila 1: título A:K ---
  ws.mergeCells(1, 1, 1, COLS);
  const title = ws.getCell(1, 1);
  title.value = "RELACION DE CARGA EN CONTENEDOR";
  title.font = {
    name: "Calibri",
    size: 20,
    bold: true,
    color: { argb: TITLE_COLOR },
  };
  title.alignment = { horizontal: "center", vertical: "middle", wrapText: false };
  title.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: TITLE_BAND_FILL },
  };
  title.border = {
    bottom: { style: "medium", color: { argb: "FF16263F" } },
  };
  ws.getRow(1).height = 38;

  const applyMetaBand = (rowFrom: number, rowTo: number) => {
    for (let r = rowFrom; r <= rowTo; r++) {
      for (let c = 1; c <= COLS; c++) {
        const cell = ws.getCell(r, c);
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: META_BAND_FILL },
        };
        cell.border = metaBorderLight;
      }
    }
  };

  // --- Fila 2: fecha + contenedor (sin cortar etiquetas) ---
  ws.mergeCells(2, 1, 2, 3);
  ws.getCell(2, 1).value = "FECHA DE LLEGADA:";
  ws.getCell(2, 1).font = labelFont;
  ws.getCell(2, 1).alignment = {
    horizontal: "left",
    vertical: "middle",
    wrapText: false,
  };

  ws.mergeCells(2, 4, 2, 7);
  ws.getCell(2, 4).value = formatDateDisplay(containerInfo.date);
  ws.getCell(2, 4).font = {
    ...valueFont,
    bold: true,
    size: 14,
    color: { argb: TITLE_COLOR },
  };
  ws.getCell(2, 4).alignment = {
    horizontal: "left",
    vertical: "middle",
    wrapText: false,
  };

  ws.mergeCells(2, 8, 2, 9);
  ws.getCell(2, 8).value = "CONTENEDOR";
  ws.getCell(2, 8).font = labelFont;
  ws.getCell(2, 8).alignment = {
    horizontal: "right",
    vertical: "middle",
    wrapText: false,
  };

  ws.mergeCells(2, 10, 2, COLS);
  ws.getCell(2, 10).value = (containerInfo.number || "").trim() || "—";
  ws.getCell(2, 10).font = {
    name: "Calibri",
    bold: true,
    size: 13,
    color: { argb: "FF0F172A" },
  };
  ws.getCell(2, 10).alignment = {
    horizontal: "left",
    vertical: "middle",
    wrapText: true,
  };

  // --- Fila 3: cliente (izq.) | seguimiento (centro) | sellos (der.) — 11 columnas sin solapes ---
  ws.mergeCells(3, 1, 3, 2);
  ws.getCell(3, 1).value = "CLIENTE:";
  ws.getCell(3, 1).font = labelFont;
  ws.getCell(3, 1).alignment = {
    horizontal: "left",
    vertical: "middle",
    wrapText: false,
  };

  ws.mergeCells(3, 3, 3, 5);
  ws.getCell(3, 3).value = primaryClient || "—";
  ws.getCell(3, 3).font = { ...valueFont, bold: true, size: 13 };
  ws.getCell(3, 3).alignment = {
    horizontal: "left",
    vertical: "middle",
    wrapText: true,
  };

  const tracking = (trackingRef || "").trim() || "—";
  ws.mergeCells(3, 6, 3, 8);
  ws.getCell(3, 6).value = `Seguimiento / Ref.: ${tracking}`;
  ws.getCell(3, 6).font = { ...valueFont, size: 12 };
  ws.getCell(3, 6).alignment = {
    horizontal: "left",
    vertical: "middle",
    wrapText: true,
  };

  const seal1 = (containerInfo.seal1 || "").trim();
  const seal2 = (containerInfo.seal2 || "").trim();
  const sealsText = [seal1, seal2].filter(Boolean).join(" / ") || "—";
  ws.mergeCells(3, 9, 3, COLS);
  ws.getCell(3, 9).value = `SELLOS: ${sealsText}`;
  ws.getCell(3, 9).font = {
    name: "Calibri",
    size: 12,
    color: { argb: "FF1E293B" },
    bold: true,
  };
  ws.getCell(3, 9).alignment = {
    horizontal: "left",
    vertical: "middle",
    wrapText: true,
  };

  // --- Fila 4: responsable a todo el ancho útil ---
  ws.mergeCells(4, 1, 4, 2);
  ws.getCell(4, 1).value = "CARGADO POR:";
  ws.getCell(4, 1).font = labelFont;
  ws.getCell(4, 1).alignment = {
    horizontal: "left",
    vertical: "middle",
    wrapText: false,
  };

  ws.mergeCells(4, 3, 4, COLS);
  ws.getCell(4, 3).value = (exportedByLabel || "").trim() || "—";
  ws.getCell(4, 3).font = { ...valueFont, bold: true, size: 12 };
  ws.getCell(4, 3).alignment = {
    horizontal: "left",
    vertical: "middle",
    wrapText: false,
  };

  applyMetaBand(2, 4);
  ws.getRow(2).height = 28;
  ws.getRow(3).height = 28;
  ws.getRow(4).height = 26;

  // Refuerzo de bordes externos del bloque metadatos
  for (let c = 1; c <= COLS; c++) {
    ws.getCell(2, c).border = {
      ...ws.getCell(2, c).border,
      top: { style: "thin", color: { argb: "FF94A3B8" } },
    };
    ws.getCell(4, c).border = {
      ...ws.getCell(4, c).border,
      bottom: { style: "thin", color: { argb: "FF94A3B8" } },
    };
  }
  for (let r = 2; r <= 4; r++) {
    ws.getCell(r, 1).border = {
      ...ws.getCell(r, 1).border,
      left: { style: "thin", color: { argb: "FF94A3B8" } },
    };
    ws.getCell(r, COLS).border = {
      ...ws.getCell(r, COLS).border,
      right: { style: "thin", color: { argb: "FF94A3B8" } },
    };
  }

  const headerRowIndex = 5;
  const headers: string[] = [
    "#",
    "R/A",
    "Parcial",
    "Compañía (Proveedor)",
    "Cliente (Expedidor)",
    "Bultos",
    "Marca",
    "Fecha",
    "CBM / CUB",
    "Peso(kg)",
    "Descripción",
  ];

  for (let c = 0; c < COLS; c++) {
    const cell = ws.getCell(headerRowIndex, c + 1);
    cell.value = headers[c]!;
    cell.font = {
      name: "Calibri",
      size: 11,
      bold: true,
      color: { argb: HEADER_TEXT },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_BLUE },
    };
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
    cell.border = strongBorder();
  }
  ws.getRow(headerRowIndex).height = 27;
  ws.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: headerRowIndex, column: COLS },
  };

  const dataStartRow = 6;
  rows.forEach((row, idx) => {
    const r = dataStartRow + idx;
    const fill =
      idx % 2 === 0
        ? {
            type: "pattern" as const,
            pattern: "solid" as const,
            fgColor: { argb: ROW_ALT_FILL },
          }
        : undefined;

    const values: (string | number)[] = [
      idx + 1,
      row.ra,
      row.partial,
      row.provider,
      row.subClient,
      row.bultos,
      row.brand,
      formatDateDisplay(String(row.date)),
      parseFloat(row.cbm) || 0,
      parseFloat(String(row.weight).replace(",", ".")) || 0,
      row.desc,
    ];

    for (let c = 0; c < COLS; c++) {
      const cell = ws.getCell(r, c + 1);
      cell.value = values[c] as ExcelJS.CellValue;
      cell.font = { name: "Calibri", size: DATA_FONT_SIZE };
      cell.alignment = {
        horizontal: c === 0 || c === 5 || c === 7 || c === 8 || c === 9 ? "center" : "left",
        vertical: "middle",
        wrapText: c === COLS - 1,
      };
      if (fill) cell.fill = fill;
      cell.border = thinBorder();
      if (c === 8 || c === 9) {
        cell.numFmt = c === 8 ? "0.00" : "0.00";
      }
    }
    ws.getRow(r).height = 22;
  });

  const lastDataRow = dataStartRow + Math.max(rows.length, 1) - 1;
  const gapRow = lastDataRow + 1;
  const totalRow = gapRow + 1;

  ws.getRow(gapRow).height = 6;

  ws.getCell(totalRow, 5).value = "TOTAL";
  ws.getCell(totalRow, 5).font = {
    name: "Calibri",
    bold: true,
    size: 11,
    color: { argb: TITLE_COLOR },
  };
  ws.getCell(totalRow, 5).alignment = { horizontal: "right", vertical: "middle" };
  ws.getCell(totalRow, 5).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };

  ws.getCell(totalRow, 6).value = totals.bultos;
  ws.getCell(totalRow, 6).font = {
    name: "Calibri",
    bold: true,
    size: 11,
    color: { argb: TITLE_COLOR },
  };
  ws.getCell(totalRow, 6).alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell(totalRow, 6).numFmt = "0";
  ws.getCell(totalRow, 6).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };

  ws.getCell(totalRow, 9).value = totals.cbm;
  ws.getCell(totalRow, 9).font = {
    name: "Calibri",
    bold: true,
    size: 11,
    color: { argb: TITLE_COLOR },
  };
  ws.getCell(totalRow, 9).alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell(totalRow, 9).numFmt = "0.00";
  ws.getCell(totalRow, 9).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };

  const tareValue = totals.tare;

  const netRow = totalRow + 1;
  const taraRow = totalRow + 2;
  const grossRow = totalRow + 3;

  ws.getCell(netRow, 10).value = totals.netWeight;
  ws.getCell(netRow, 10).numFmt = "0.00";
  ws.getCell(netRow, 10).font = { name: "Calibri", bold: true, size: 10 };
  ws.getCell(netRow, 10).alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell(netRow, 11).value = "PESO NETO";
  ws.getCell(netRow, 11).font = {
    name: "Calibri",
    bold: true,
    size: 10,
    color: { argb: TITLE_COLOR },
  };

  ws.getCell(taraRow, 10).value = tareValue;
  ws.getCell(taraRow, 10).numFmt = "0.00";
  ws.getCell(taraRow, 10).font = { name: "Calibri", bold: true, size: 10 };
  ws.getCell(taraRow, 10).alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell(taraRow, 11).value = "TARA";
  ws.getCell(taraRow, 11).font = {
    name: "Calibri",
    bold: true,
    size: 10,
    color: { argb: TITLE_COLOR },
  };

  ws.getCell(grossRow, 9).value = "TOTAL";
  ws.getCell(grossRow, 9).font = {
    name: "Calibri",
    bold: true,
    size: 12,
    color: { argb: "FF0F766E" },
  };
  ws.getCell(grossRow, 9).alignment = { horizontal: "right", vertical: "middle" };
  ws.getCell(grossRow, 10).value = totals.grossWeight;
  ws.getCell(grossRow, 10).numFmt = "0.00";
  ws.getCell(grossRow, 10).font = {
    name: "Calibri",
    bold: true,
    size: 12,
    color: { argb: "FF0F766E" },
  };
  ws.getCell(grossRow, 10).alignment = { horizontal: "center", vertical: "middle" };
  ws.getCell(grossRow, 10).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD1FAE5" },
  };

  // Bloque visual de resumen final
  for (let r = totalRow; r <= grossRow; r++) {
    for (const c of [9, 10, 11]) {
      ws.getCell(r, c).border = strongBorder();
      ws.getCell(r, c).alignment = {
        ...ws.getCell(r, c).alignment,
        vertical: "middle",
      };
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const safeName = fileBaseName.replace(/[/\\?%*:|"<>]/g, "-") || "Relacion_Carga";
  const filename = `${safeName}.xlsx`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
