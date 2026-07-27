"use client";

/**
 * PDF del módulo REPORTES: captura el nodo de exportación (estilos inline) y lo
 * dibuja en una sola página Carta (Letter) vertical, maximizando el tamaño
 * dentro del área útil (object-fit: contain, sin deformar).
 */

import type { jsPDF } from "jspdf";
import logoMark from "@/assets/brand/logo-aldepositos.png";
import { buildReportDownloadFilename } from "@/lib/reportDownloadFilename";

const MAX_CANVAS_EDGE = 4096;

/** Ancho lógico del layout de exportación (8.5" a 96 DPI = Carta) */
export const PDF_EXPORT_WIDTH_PX = 816;

export type ReportPdfExportOptions = {
  /** Conserva `<style>` del documento (p. ej. iframe de impresión). */
  preserveDocumentStyles?: boolean;
  pageFormat?: "a4" | "letter";
  marginMm?: number;
};

function removeExternalStylesFromClone(doc: Document): void {
  doc.querySelectorAll('link[rel="stylesheet"]').forEach((n) => n.remove());
  doc.querySelectorAll('link[rel="preload"][as="style"]').forEach((n) => n.remove());
  doc.querySelectorAll("style").forEach((n) => n.remove());
}

export function buildReportPdfFilename(
  tasks: Parameters<typeof buildReportDownloadFilename>[0],
): string {
  return `${buildReportDownloadFilename(tasks)}.pdf`;
}

let brandLogoDataUrlCache: string | null | undefined;

/** Logo embebido como data URL para html2canvas (evita CORS / rutas _next). */
export async function loadBrandLogoDataUrl(): Promise<string | null> {
  if (brandLogoDataUrlCache !== undefined) return brandLogoDataUrlCache;
  try {
    const res = await fetch(logoMark.src);
    if (!res.ok) {
      brandLogoDataUrlCache = null;
      return null;
    }
    const blob = await res.blob();
    brandLogoDataUrlCache = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("No se pudo leer el logo"));
      reader.readAsDataURL(blob);
    });
    return brandLogoDataUrlCache;
  } catch {
    brandLogoDataUrlCache = null;
    return null;
  }
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

async function capturePdfExportRootAtScale(
  el: HTMLElement,
  scale: number,
  preserveDocumentStyles = false,
): Promise<HTMLCanvasElement> {
  const html2canvas = (await import("html2canvas")).default;

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
      if (!preserveDocumentStyles) {
        removeExternalStylesFromClone(doc);
      }
    },
  });

  if (!canvas.width || !canvas.height) {
    throw new Error(
      `[Reports PDF] Canvas inválido (${canvas.width}x${canvas.height}).`,
    );
  }

  return canvas;
}

export async function capturePdfExportRoot(
  el: HTMLElement,
  preserveDocumentStyles = false,
): Promise<HTMLCanvasElement> {
  const preferred = computeCaptureScale(el);
  const fallbacks = [preferred, Math.min(preferred, 2), 1.5, 1.25, 1];
  const scales = [...new Set(fallbacks.map((s) => Math.round(s * 100) / 100))];

  let lastError: unknown;
  for (const scale of scales) {
    try {
      return await capturePdfExportRootAtScale(el, scale, preserveDocumentStyles);
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("[Reports PDF] No se pudo capturar la página.");
}

function countPdfSlices(
  canvas: HTMLCanvasElement,
  maxW: number,
  maxH: number,
): number {
  const scale = maxW / canvas.width;
  const sliceHeightPx = Math.max(1, Math.floor(maxH / scale));
  return Math.max(1, Math.ceil(canvas.height / sliceHeightPx));
}

function addCanvasSlicesToPdf(
  pdf: jsPDF,
  canvas: HTMLCanvasElement,
  opts: {
    margin: number;
    pageFormat: "a4" | "letter";
    pageIndexOffset: number;
    totalPages: number;
    isFirstPdfPage: boolean;
  },
): boolean {
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = opts.margin;
  const footerMm = 5;
  const maxW = pageW - 2 * margin;
  const maxH = pageH - 2 * margin - footerMm;
  const scale = maxW / canvas.width;
  const sliceHeightPx = Math.max(1, Math.floor(maxH / scale));

  let sourceY = 0;
  let sliceIndex = 0;
  let isFirst = opts.isFirstPdfPage;

  while (sourceY < canvas.height) {
    const h = Math.min(sliceHeightPx, canvas.height - sourceY);
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = h;
    const ctx = sliceCanvas.getContext("2d");
    if (!ctx) throw new Error("[Reports PDF] No se pudo preparar el lienzo.");
    ctx.drawImage(canvas, 0, sourceY, canvas.width, h, 0, 0, canvas.width, h);

    const imgHeightMm = h * scale;
    if (!isFirst) {
      pdf.addPage(opts.pageFormat, "portrait");
    }
    isFirst = false;

    pdf.addImage(sliceCanvas, "PNG", margin, margin, maxW, imgHeightMm);
    pdf.setTextColor(100, 116, 139);
    pdf.setFontSize(8);
    pdf.text(
      `Pagina ${opts.pageIndexOffset + sliceIndex + 1} de ${opts.totalPages}`,
      pageW - margin,
      pageH - 3,
      { align: "right" },
    );

    sourceY += h;
    sliceIndex += 1;
  }

  return !opts.isFirstPdfPage || sliceIndex > 1;
}

/**
 * Carta/A4 vertical multipagina: una o mas paginas PDF por cada hoja renderizada.
 */
export async function savePdfLetterFromPages(
  pageElements: HTMLElement[],
  filename: string,
  options: ReportPdfExportOptions = {},
): Promise<void> {
  if (pageElements.length === 0) {
    throw new Error("[Reports PDF] No hay paginas para exportar.");
  }

  const pageFormat = options.pageFormat ?? "a4";
  const margin = options.marginMm ?? 8;
  const preserveDocumentStyles = options.preserveDocumentStyles ?? false;
  const pageW =
    pageFormat === "a4" ? 210 - 2 * margin : 215.9 - 2 * margin;
  const pageH =
    pageFormat === "a4" ? 297 - 2 * margin - 5 : 279.4 - 2 * margin - 5;

  const canvases: HTMLCanvasElement[] = [];
  for (const el of pageElements) {
    canvases.push(await capturePdfExportRoot(el, preserveDocumentStyles));
  }

  const sliceCounts = canvases.map((c) => countPdfSlices(c, pageW, pageH));
  const totalPages = sliceCounts.reduce((sum, n) => sum + n, 0);

  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: pageFormat,
  });

  let pageOffset = 0;
  let isFirstPdfPage = true;
  for (let i = 0; i < canvases.length; i += 1) {
    addCanvasSlicesToPdf(pdf, canvases[i]!, {
      margin,
      pageFormat,
      pageIndexOffset: pageOffset,
      totalPages,
      isFirstPdfPage,
    });
    pageOffset += sliceCounts[i]!;
    isFirstPdfPage = false;
  }

  pdf.save(filename);
}

export async function exportReportPdfFromExportRoot(
  root: HTMLElement | null,
  filename: string,
  options: ReportPdfExportOptions = {},
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
    await savePdfLetterFromPages(pageElements, filename, options);
    return;
  }
  await savePdfLetterFromPages([root], filename, options);
}
