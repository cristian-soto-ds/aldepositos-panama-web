"use client";

/**
 * PDF del módulo REPORTES: captura el nodo de exportación (estilos inline) y lo
 * dibuja en una sola página Carta (Letter) vertical, maximizando el tamaño
 * dentro del área útil (object-fit: contain, sin deformar).
 */

import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const MAX_CANVAS_EDGE = 4096;

/** Ancho lógico del layout de exportación (8.5" a 96 DPI = Carta) */
export const PDF_EXPORT_WIDTH_PX = 816;

function removeExternalStylesFromClone(doc: Document): void {
  doc.querySelectorAll('link[rel="stylesheet"]').forEach((n) => n.remove());
  doc.querySelectorAll('link[rel="preload"][as="style"]').forEach((n) => n.remove());
  doc.querySelectorAll("style").forEach((n) => n.remove());
}

export function buildReportPdfFilename(tasks: { ra: string }[]): string {
  const sanitize = (s: string) =>
    String(s)
      .trim()
      .replace(/[^\w.\-]/g, "_")
      .slice(0, 64);

  if (tasks.length === 0) return "reporte_ingreso.pdf";
  if (tasks.length === 1) {
    return `reporte_ingreso_RA-${sanitize(tasks[0].ra)}.pdf`;
  }
  const first = sanitize(tasks[0].ra);
  return `reporte_ingreso_RA-${first}_y_${tasks.length - 1}_ordenes_mas.pdf`;
}

export async function waitForReportDomReady(): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    await document.fonts.ready;
  } catch {
    /* ignore */
  }

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 48);
  });
}

/**
 * Escala de captura: prioriza nitidez sin superar el límite del canvas.
 * No forzamos width/height en html2canvas para no inflar scrollHeight con aire.
 */
function computeCaptureScale(el: HTMLElement): number {
  const w = Math.max(1, el.offsetWidth || el.clientWidth);
  const h = Math.max(1, el.scrollHeight || el.offsetHeight);
  const byW = MAX_CANVAS_EDGE / w;
  const byH = MAX_CANVAS_EDGE / h;
  return Math.max(1.75, Math.min(2.75, byW, byH));
}

export async function capturePdfExportRoot(el: HTMLElement): Promise<HTMLCanvasElement> {
  const scale = computeCaptureScale(el);

  const canvas = await html2canvas(el, {
    scale,
    useCORS: true,
    allowTaint: false,
    logging: false,
    backgroundColor: "#ffffff",
    foreignObjectRendering: false,
    scrollX: 0,
    scrollY: 0,
    onclone: (doc) => {
      removeExternalStylesFromClone(doc);
    },
  });

  if (!canvas.width || !canvas.height) {
    throw new Error(
      `[Reports PDF] Canvas inválido (${canvas.width}x${canvas.height}).`,
    );
  }

  return canvas;
}

function addCanvasAsLetterPage(
  pdf: jsPDF,
  canvas: HTMLCanvasElement,
  pageIndex: number,
  totalPages: number,
): void {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const maxW = pageW - 2 * margin;
  const maxH = pageH - 2 * margin;

  const cw = canvas.width;
  const ch = canvas.height;
  const aspect = ch / cw;

  let wMm = maxW;
  let hMm = wMm * aspect;

  if (hMm > maxH) {
    hMm = maxH;
    wMm = maxH / aspect;
  }

  const x = margin + (maxW - wMm) / 2;
  const y = margin + (maxH - hMm) / 2;

  pdf.addImage(canvas, "PNG", x, y, wMm, hMm);
  pdf.setTextColor(100, 116, 139);
  pdf.setFontSize(8);
  pdf.text(`Pagina ${pageIndex + 1} de ${totalPages}`, pageW - margin, pageH - 5, {
    align: "right",
  });
}

/**
 * Carta vertical multipagina: agrega una pagina PDF por cada hoja renderizada.
 */
export async function savePdfLetterFromPages(
  pageElements: HTMLElement[],
  filename: string,
): Promise<void> {
  if (pageElements.length === 0) {
    throw new Error("[Reports PDF] No hay paginas para exportar.");
  }

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "letter",
  });
  for (let i = 0; i < pageElements.length; i += 1) {
    const canvas = await capturePdfExportRoot(pageElements[i]);
    if (i > 0) pdf.addPage("letter", "portrait");
    addCanvasAsLetterPage(pdf, canvas, i, pageElements.length);
  }
  pdf.save(filename);
}

export async function exportReportPdfFromExportRoot(
  root: HTMLElement | null,
  filename: string,
): Promise<void> {
  if (!root) {
    throw new Error("[Reports PDF] Contenedor de exportación no disponible.");
  }
  if (!root.isConnected) {
    throw new Error("[Reports PDF] Contenedor no está en el DOM.");
  }

  const pageElements = Array.from(
    root.querySelectorAll<HTMLElement>("[data-report-export-page]"),
  );
  if (pageElements.length > 0) {
    await savePdfLetterFromPages(pageElements, filename);
    return;
  }
  await savePdfLetterFromPages([root], filename);
}
