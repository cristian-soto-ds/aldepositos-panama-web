/**
 * Documento de impresión con el mismo layout profesional del Excel
 * (cabecera marca, banner RA, campos, KPIs, tabla).
 * Se abre en ventana limpia — sin sidebar ni botones de la app.
 */

import type { Task } from "@/lib/types/task";
import logoMark from "@/assets/brand/logo-aldepositos.png";
import {
  computeReportData,
  reportLineTotalCbm,
  reportModuleLabel,
  reportPalletWeight,
  reportRowPallet,
} from "@/lib/reportTotals";
import { cubicajeM3FromDims, roundUpMeasure } from "@/lib/measureDecimals";

const BRAND = "#16263F";
const BRAND_LIGHT = "#1E3A5F";
const ACCENT = "#3B82F6";
const CBM = "#1D4ED8";
const MUTED = "#94A3B8";
const TEXT = "#1E293B";
const BORDER = "#E2E8F0";
const ROW_ALT = "#F8FAFC";
const KPI_BG = "#F1F5F9";

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function logoAbsUrl(): string {
  const src = logoMark.src.startsWith("http")
    ? logoMark.src
    : `${typeof window !== "undefined" ? window.location.origin : ""}${logoMark.src}`;
  return src;
}

function quickHeaders(showReference: boolean, showWeight: boolean): string[] {
  const headers = ["#"];
  if (showReference) headers.push("Referencia");
  headers.push("Bultos");
  if (showWeight) headers.push("Peso/B (kg)", "P. Total (kg)");
  headers.push("L", "W", "H", "Reempaque", "CBM/B", "Total CBM");
  return headers;
}

function palletizedHeaders(): string[] {
  return ["#", "Bultos", "L", "W", "H", "Reempaque", "Total CBM"];
}

function detailedHeaders(): string[] {
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

type TableRow = {
  cells: (string | number)[];
  kind: "data" | "pallet" | "reempaque";
};

function buildTable(task: Task): { headers: string[]; rows: TableRow[] } {
  const {
    measureRows,
    isDetailed,
    isPalletized,
    showWeightColumn,
    showReferenceColumn,
  } = computeReportData(task);

  if (isDetailed) {
    const headers = detailedHeaders();
    const rows: TableRow[] = measureRows.map((row, idx) => {
      const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
      const undPerBulto = parseFloat(String(row.unidadesPorBulto ?? 0)) || 0;
      const pesoPorBulto = parseFloat(String(row.pesoPorBulto ?? 0)) || 0;
      const l = parseFloat(String(row.l ?? 0)) || 0;
      const w = parseFloat(String(row.w ?? 0)) || 0;
      const h = parseFloat(String(row.h ?? 0)) || 0;
      const isReempaque = row.reempaque === true;
      const cbmPorBulto = cubicajeM3FromDims(l, w, h, 1, isReempaque);
      const cubicajeTotal = reportLineTotalCbm(row);
      return {
        kind: isReempaque ? "reempaque" : "data",
        cells: [
          idx + 1,
          String(row.referencia || "-"),
          String(row.descripcion || "-"),
          bultos,
          undPerBulto,
          bultos * undPerBulto,
          Number(pesoPorBulto.toFixed(2)),
          Number((bultos * pesoPorBulto).toFixed(2)),
          isReempaque ? "SI" : "-",
          l,
          w,
          h,
          cbmPorBulto,
          cubicajeTotal,
        ],
      };
    });
    return { headers, rows };
  }

  if (isPalletized) {
    const headers = palletizedHeaders();
    const rows: TableRow[] = [];
    let lastPallet: number | null = null;
    let lineNum = 0;
    for (const row of measureRows) {
      const p = reportRowPallet(row);
      if (p !== lastPallet) {
        lastPallet = p;
        const pw = reportPalletWeight(measureRows, p);
        rows.push({
          kind: "pallet",
          cells: [
            `PALETA ${p}${pw > 0 ? `  ·  ${pw.toFixed(2)} kg` : ""}`,
            "",
            "",
            "",
            "",
            "",
            "",
          ],
        });
        lineNum = 0;
      }
      lineNum += 1;
      const l = parseFloat(String(row.l ?? 0)) || 0;
      const w = parseFloat(String(row.w ?? 0)) || 0;
      const h = parseFloat(String(row.h ?? 0)) || 0;
      const b = parseFloat(String(row.bultos ?? 0)) || 0;
      const isReempaque = row.reempaque === true;
      const rowCbm = reportLineTotalCbm(row);
      rows.push({
        kind: isReempaque ? "reempaque" : "data",
        cells: [
          lineNum,
          isReempaque ? "—" : b,
          isReempaque ? "—" : l,
          isReempaque ? "—" : w,
          isReempaque ? "—" : h,
          isReempaque ? "SI" : "-",
          isReempaque ? "—" : rowCbm,
        ],
      });
    }
    return { headers, rows };
  }

  const headers = quickHeaders(showReferenceColumn, showWeightColumn);
  const rows: TableRow[] = measureRows.map((row, idx) => {
    const l = parseFloat(String(row.l ?? 0)) || 0;
    const w = parseFloat(String(row.w ?? 0)) || 0;
    const h = parseFloat(String(row.h ?? 0)) || 0;
    const b = parseFloat(String(row.bultos ?? 0)) || 0;
    const isReempaque = row.reempaque === true;
    const rowCbm = reportLineTotalCbm(row);
    const cbmPorBulto = cubicajeM3FromDims(l, w, h, 1, isReempaque);
    const rowWeight = parseFloat(String(row.weight ?? 0)) || 0;
    const pesoTotal = roundUpMeasure(b * rowWeight);
    const cells: (string | number)[] = [idx + 1];
    if (showReferenceColumn) cells.push(String(row.referencia || "-"));
    cells.push(b);
    if (showWeightColumn) {
      cells.push(row.weight != null ? parseFloat(String(row.weight)) || 0 : "-");
      cells.push(isReempaque || pesoTotal <= 0 ? "-" : pesoTotal);
    }
    cells.push(l, w, h, isReempaque ? "SI" : "-", isReempaque ? "-" : cbmPorBulto);
    cells.push(rowCbm);
    return { kind: isReempaque ? "reempaque" : "data", cells };
  });
  return { headers, rows };
}

function renderSheet(task: Task, currentDate: string): string {
  const { totals, isDetailed } = computeReportData(task);
  const { headers, rows } = buildTable(task);
  const moduleLabel = reportModuleLabel(task).toUpperCase();
  const colCount = headers.length;
  const lastColIdx = colCount - 1;

  const kpiItems = isDetailed
    ? [
        ["BULTOS", String(totals.bultos)],
        ["UNIDADES", String(totals.unidades)],
        ["VOLUMEN (m³)", totals.cbm],
        ["PESO (kg)", totals.weight.toFixed(2)],
      ]
    : [
        ["BULTOS", String(totals.bultos)],
        ["VOLUMEN (m³)", totals.cbm],
        ["PESO (kg)", totals.weight.toFixed(2)],
      ];

  const tableHead = headers
    .map((h, i) => {
      const key = h.toLowerCase();
      const cls = [
        i === lastColIdx ? "th-cbm" : "",
        key.includes("refer") || key === "ref." ? "th-ref" : "",
        key === "l" || key === "w" || key === "h" ? "th-dim" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<th class="${cls}">${esc(h)}</th>`;
    })
    .join("");

  const colgroup = headers
    .map((h) => {
      const key = h.toLowerCase();
      if (h === "#") return `<col class="col-num" />`;
      if (key.includes("refer") || key === "ref.") return `<col class="col-ref" />`;
      if (key.includes("desc")) return `<col class="col-desc" />`;
      if (key === "l" || key === "w" || key === "h") return `<col class="col-dim" />`;
      if (key.includes("cbm") || key.includes("total cbm") || key.includes("tot. cbm"))
        return `<col class="col-cbm" />`;
      if (key.includes("bult")) return `<col class="col-bultos" />`;
      if (key.includes("peso")) return `<col class="col-peso" />`;
      return `<col />`;
    })
    .join("");

  const tableBody = rows
    .map((row, ri) => {
      if (row.kind === "pallet") {
        return `<tr class="pallet-row"><td colspan="${colCount}">${esc(row.cells[0])}</td></tr>`;
      }
      const tds = row.cells
        .map((c, i) => {
          const header = headers[i] ?? "";
          const key = header.toLowerCase();
          const cls = [
            i === lastColIdx ? "cell-cbm" : "",
            i === 0 || header === "#" ? "cell-num" : "",
            key.includes("refer") || key === "ref." ? "cell-ref" : "",
            key === "l" || key === "w" || key === "h" ? "cell-dim" : "",
            key.includes("bult") ? "cell-bultos" : "",
            key.includes("peso") ? "cell-peso" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return `<td class="${cls}">${esc(c)}</td>`;
        })
        .join("");
      const zebra = ri % 2 === 1 ? "alt" : "";
      const reemp = row.kind === "reempaque" ? "reempaque" : "";
      return `<tr class="${zebra} ${reemp}">${tds}</tr>`;
    })
    .join("");

  return `
  <section class="sheet">
    <header class="brand-bar">
      <div class="brand-left">
        <div class="logo-wrap">
          <img src="${esc(logoAbsUrl())}" alt="ALDEPOSITOS" width="72" height="72" />
        </div>
        <div class="brand-text">
          <div class="brand-name">ALDEPOSITOS</div>
          <div class="brand-tag">Servicios logísticos integrales</div>
        </div>
      </div>
      <div class="brand-right">
        <div class="report-title">REPORTE DE INGRESO</div>
        <div class="report-meta">${esc(moduleLabel)}  ·  ${esc(currentDate)}</div>
      </div>
    </header>

    <div class="ra-banner">
      <span class="ra-label">RECIBO DE ALMACÉN</span>
      <span class="ra-value">RA-${esc(String(task.ra || "—").toUpperCase())}</span>
    </div>

    <div class="fields">
      <div class="field">
        <div class="field-label">CLIENTE</div>
        <div class="field-value hero">${esc((task.mainClient || "—").toUpperCase())}</div>
      </div>
      <div class="field">
        <div class="field-label">EXPEDIDOR</div>
        <div class="field-value">${esc((task.subClient || "—").toUpperCase())}</div>
      </div>
      <div class="field">
        <div class="field-label">PROVEEDOR</div>
        <div class="field-value">${esc((task.provider || "—").toUpperCase())}</div>
      </div>
      <div class="field">
        <div class="field-label">MARCA</div>
        <div class="field-value">${esc((task.brand || "—").toUpperCase())}</div>
      </div>
    </div>

    <div class="kpis${isDetailed ? " detailed" : ""}">
      ${kpiItems
        .map(
          ([label, value]) => `
        <div class="kpi">
          <div class="kpi-label">${esc(label)}</div>
          <div class="kpi-value">${esc(value)}</div>
        </div>`,
        )
        .join("")}
    </div>

    <h2 class="section-title">DETALLE DE DIMENSIONES</h2>
    <table>
      <colgroup>${colgroup}</colgroup>
      <thead><tr>${tableHead}</tr></thead>
      <tbody>${tableBody}</tbody>
    </table>
  </section>`;
}

const PRINT_CSS = `
  @page {
    size: A4 portrait;
    margin: 8mm 10mm;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: ${TEXT};
    font-family: Calibri, "Segoe UI", system-ui, Arial, sans-serif;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  body { padding: 0; }
  .sheet {
    width: 100%;
    max-width: 190mm;
    margin: 0 auto 12mm;
    page-break-after: always;
  }
  .sheet:last-child { page-break-after: auto; margin-bottom: 0; }

  .brand-bar {
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    gap: 16px;
    background: ${BRAND};
    color: #fff;
    border-radius: 4px;
    overflow: hidden;
    min-height: 78px;
  }
  .brand-left {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 12px;
    background: #fff;
    min-width: 52%;
  }
  .logo-wrap {
    flex-shrink: 0;
    width: 64px;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .logo-wrap img {
    width: 64px;
    height: 64px;
    object-fit: contain;
  }
  .brand-name {
    font-size: 22px;
    font-weight: 900;
    color: ${BRAND};
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .brand-tag {
    margin-top: 5px;
    font-size: 9px;
    font-style: italic;
    color: #64748b;
    letter-spacing: 0.04em;
  }
  .brand-right {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-end;
    padding: 10px 16px;
    text-align: right;
  }
  .report-title {
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.08em;
  }
  .report-meta {
    margin-top: 6px;
    font-size: 9px;
    color: #B8C4D4;
  }

  .ra-banner {
    margin-top: 8px;
    background: ${KPI_BG};
    border: 1px solid ${BORDER};
    border-radius: 4px;
    text-align: center;
    padding: 8px 12px;
  }
  .ra-label {
    display: block;
    font-size: 9px;
    font-weight: 700;
    color: ${MUTED};
    letter-spacing: 0.14em;
  }
  .ra-value {
    display: block;
    margin-top: 2px;
    font-size: 22px;
    font-weight: 900;
    color: ${BRAND};
    letter-spacing: -0.02em;
  }

  .fields {
    display: grid;
    grid-template-columns: 1.15fr 1.15fr 1fr 0.9fr;
    gap: 0;
    margin-top: 8px;
    border-top: 1px solid ${BORDER};
    border-bottom: 1px solid ${BORDER};
  }
  .field {
    padding: 8px 10px 10px;
    border-right: 1px solid ${BORDER};
  }
  .field:last-child { border-right: none; }
  .field-label {
    font-size: 8px;
    font-weight: 800;
    color: ${MUTED};
    letter-spacing: 0.12em;
    margin-bottom: 4px;
  }
  .field-value {
    font-size: 11px;
    font-weight: 700;
    color: ${TEXT};
    line-height: 1.25;
    word-break: break-word;
  }
  .field-value.hero {
    font-size: 13px;
    font-weight: 900;
    color: ${BRAND};
  }

  .kpis {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0;
    margin-top: 8px;
    border-top: 2px solid ${BRAND_LIGHT};
    border-bottom: 2px solid ${BRAND_LIGHT};
  }
  .kpis.detailed { grid-template-columns: repeat(4, 1fr); }
  .kpi {
    text-align: center;
    padding: 8px 6px;
    border-right: 1px solid ${BORDER};
    background: #fff;
  }
  .kpi:last-child { border-right: none; }
  .kpi-label {
    font-size: 8px;
    font-weight: 800;
    color: ${MUTED};
    letter-spacing: 0.1em;
  }
  .kpi-value {
    margin-top: 3px;
    font-size: 18px;
    font-weight: 900;
    color: ${BRAND};
    line-height: 1.1;
  }

  .section-title {
    margin: 12px 0 6px;
    font-size: 10px;
    font-weight: 900;
    color: ${BRAND};
    letter-spacing: 0.12em;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 10px;
  }
  col.col-num { width: 4%; }
  col.col-ref { width: 18%; }
  col.col-desc { width: 16%; }
  col.col-dim { width: 7%; }
  col.col-bultos { width: 7%; }
  col.col-peso { width: 9%; }
  col.col-cbm { width: 9%; }

  th {
    background: ${BRAND};
    color: #fff;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    padding: 8px 3px;
    border: 1px solid ${BRAND};
    text-align: center;
    font-size: 8px;
    line-height: 1.15;
  }
  th.th-cbm { background: ${ACCENT}; }
  th.th-ref { font-size: 8.5px; }
  th.th-dim { font-size: 9px; }

  td {
    border: 1px solid ${BORDER};
    padding: 6px 4px;
    text-align: center;
    color: ${TEXT};
    vertical-align: middle;
    word-break: break-word;
  }
  tr.alt td { background: ${ROW_ALT}; }
  tr.reempaque td { background: #F5F3FF; }
  tr.pallet-row td {
    background: #EEF2FF;
    color: #3730A3;
    font-weight: 800;
    text-align: left;
    padding: 6px 8px;
    letter-spacing: 0.04em;
  }

  td.cell-num {
    font-weight: 800;
    color: ${BRAND};
    font-size: 10px;
  }
  td.cell-ref {
    text-align: left;
    padding-left: 6px;
    font-weight: 800;
    font-size: 11px;
    color: ${BRAND};
    letter-spacing: 0.01em;
  }
  td.cell-dim {
    font-weight: 800;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: ${TEXT};
  }
  td.cell-bultos {
    font-weight: 800;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  td.cell-peso {
    font-variant-numeric: tabular-nums;
    font-size: 10px;
  }
  td.cell-cbm {
    color: ${CBM};
    font-weight: 900;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  @media print {
    html, body {
      background: #fff !important;
    }
    .sheet {
      max-width: none;
      margin: 0;
    }
  }

  @media screen {
    body {
      background: #e2e8f0;
      padding: 16px;
    }
    .sheet {
      background: #fff;
      padding: 12mm 10mm;
      box-shadow: 0 10px 40px rgba(15,23,42,0.18);
      border-radius: 4px;
    }
  }
`;

export function buildReportPrintHtml(
  tasks: Task[],
  currentDate: string,
): string {
  const sheets = tasks.map((t) => renderSheet(t, currentDate)).join("\n");

  // Título vacío: evita el texto central del encabezado del navegador
  // (fecha / título / URL se ocultan en Más opciones → Encabezados y pies).
  return `<!DOCTYPE html>
<html lang="es-PA">
<head>
  <meta charset="utf-8" />
  <title></title>
  <style>${PRINT_CSS}</style>
</head>
<body>
${sheets}
</body>
</html>`;
}

const PRINT_IFRAME_ID = "aldepositos-report-print-frame";

/**
 * Imprime el reporte estilo Excel sin abrir ventana emergente
 * (usa un iframe oculto en la misma página → no lo bloquea el navegador).
 */
export function openReportPrintWindow(
  tasks: Task[],
  currentDate: string,
): void {
  if (typeof document === "undefined" || tasks.length === 0) return;

  const html = buildReportPrintHtml(tasks, currentDate);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);

  let iframe = document.getElementById(PRINT_IFRAME_ID) as HTMLIFrameElement | null;
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.id = PRINT_IFRAME_ID;
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("title", "Impresión de reporte");
    Object.assign(iframe.style, {
      position: "fixed",
      right: "0",
      bottom: "0",
      width: "0",
      height: "0",
      border: "0",
      opacity: "0",
      pointerEvents: "none",
      zIndex: "-1",
    });
    document.body.appendChild(iframe);
  }

  const frame = iframe;
  const prevSrc = frame.dataset.blobUrl;
  if (prevSrc) {
    try {
      URL.revokeObjectURL(prevSrc);
    } catch {
      /* ignore */
    }
  }
  frame.dataset.blobUrl = blobUrl;

  const runPrint = () => {
    try {
      const win = frame.contentWindow;
      if (!win) return;
      // Título vacío otra vez por si el navegador lo reescribe.
      try {
        if (frame.contentDocument) frame.contentDocument.title = "";
      } catch {
        /* ignore */
      }
      win.focus();
      win.print();
    } catch (err) {
      console.error("[Reports Print]", err);
      alert("No se pudo abrir el diálogo de impresión. Intentá de nuevo.");
    }
  };

  const onReady = () => {
    const doc = frame.contentDocument;
    if (!doc) {
      setTimeout(runPrint, 200);
      return;
    }
    const imgs = Array.from(doc.images);
    if (imgs.length === 0) {
      setTimeout(runPrint, 120);
      return;
    }
    let pending = imgs.length;
    let printed = false;
    const maybePrint = () => {
      if (printed) return;
      printed = true;
      setTimeout(runPrint, 80);
    };
    const onOne = () => {
      pending -= 1;
      if (pending <= 0) maybePrint();
    };
    for (const img of imgs) {
      if (img.complete) onOne();
      else {
        img.addEventListener("load", onOne, { once: true });
        img.addEventListener("error", onOne, { once: true });
      }
    }
    setTimeout(maybePrint, 1500);
  };

  frame.onload = () => onReady();
  frame.src = blobUrl;
}
