/**
 * PDF del reporte usando el mismo HTML profesional que Imprimir (estilo Excel).
 */

import type { Task } from "@/lib/types/task";
import { buildReportPrintHtml } from "@/lib/buildReportPrintHtml";
import { buildReportDownloadFilename } from "@/lib/reportDownloadFilename";
import {
  exportReportPdfFromExportRoot,
  loadBrandLogoDataUrl,
  PDF_EXPORT_WIDTH_PX,
  waitForReportDomReady,
} from "@/components/control-panel/reportsPdfExport";

export function buildReportPdfFilename(
  tasks: Parameters<typeof buildReportDownloadFilename>[0],
): string {
  return `${buildReportDownloadFilename(tasks)}.pdf`;
}

async function waitForIframeImages(doc: Document): Promise<void> {
  const imgs = Array.from(doc.images);
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
        }),
    ),
  );
}

function preparePdfExportDocument(doc: Document): void {
  doc.documentElement.style.background = "#ffffff";
  doc.body.style.background = "#ffffff";
  doc.body.style.margin = "0";
  doc.body.style.padding = "0";

  doc.querySelectorAll<HTMLElement>(".sheet").forEach((sheet) => {
    sheet.style.maxWidth = "none";
    sheet.style.width = `${PDF_EXPORT_WIDTH_PX}px`;
    sheet.style.margin = "0";
    sheet.style.padding = "0";
    sheet.style.boxShadow = "none";
    sheet.style.borderRadius = "0";
    sheet.setAttribute("data-report-export-page", "true");
  });
}

export async function downloadReportPdfFromPrintHtml(params: {
  tasks: Task[];
  currentDate?: string;
}): Promise<void> {
  const { tasks } = params;
  if (tasks.length === 0 || typeof document === "undefined") return;

  const currentDate =
    params.currentDate ??
    new Date().toLocaleDateString("es-PA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

  const logoDataUrl = await loadBrandLogoDataUrl();
  const html = buildReportPrintHtml(tasks, currentDate, { logoDataUrl });
  const filename = buildReportPdfFilename(tasks);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("title", "Exportación PDF reporte");
  Object.assign(iframe.style, {
    position: "fixed",
    left: "-16000px",
    top: "0",
    width: `${PDF_EXPORT_WIDTH_PX}px`,
    height: "2400px",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
    zIndex: "-1",
  });
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("No se pudo preparar el documento PDF.");

    doc.open();
    doc.write(html);
    doc.close();

    preparePdfExportDocument(doc);
    await waitForIframeImages(doc);
    await waitForReportDomReady();
    await exportReportPdfFromExportRoot(doc.body, filename, {
      preserveDocumentStyles: true,
      pageFormat: "a4",
      marginMm: 8,
    });
  } finally {
    document.body.removeChild(iframe);
  }
}
