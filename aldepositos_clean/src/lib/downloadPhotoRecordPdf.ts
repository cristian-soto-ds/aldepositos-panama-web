"use client";

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Task } from "@/lib/types/task";
import type { RaPhoto } from "@/lib/types/raPhoto";
import { buildPhotoRecordPdfFilename } from "@/lib/raPhotoRecord";
import {
  preloadRaPhotoPdfAssets,
  type RaPhotoPdfAsset,
} from "@/lib/raPhotoStorage";
import { PhotoRecordPdfExportLayout } from "@/components/control-panel/PhotoRecordPdfExportLayout";
import {
  exportReportPdfFromExportRoot,
  loadBrandLogoDataUrl,
  PDF_EXPORT_WIDTH_PX,
  waitForReportDomReady,
} from "@/components/control-panel/reportsPdfExport";

async function waitForExportImages(
  root: HTMLElement,
  timeoutMs = 15000,
): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          const done = () => resolve();
          const timer = window.setTimeout(done, timeoutMs);
          img.addEventListener(
            "load",
            () => {
              window.clearTimeout(timer);
              done();
            },
            { once: true },
          );
          img.addEventListener(
            "error",
            () => {
              window.clearTimeout(timer);
              done();
            },
            { once: true },
          );
        }),
    ),
  );
}

/**
 * Genera y descarga el PDF del registro fotográfico montando el layout en
 * document.body (html2canvas no captura bien nodos con z-index negativo).
 */
export async function downloadPhotoRecordPdf(params: {
  task: Task;
  photos: RaPhoto[];
  generatedBy?: string;
}): Promise<void> {
  const { task, photos, generatedBy } = params;
  if (photos.length === 0) {
    throw new Error("No hay fotos para exportar.");
  }

  const [assets, logoDataUrl] = await Promise.all([
    preloadRaPhotoPdfAssets(photos, task.id),
    loadBrandLogoDataUrl(),
  ]);

  const mount = document.createElement("div");
  mount.id = "photo-record-pdf-export-mount";
  mount.setAttribute("aria-hidden", "true");
  mount.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    `width:${PDF_EXPORT_WIDTH_PX}px`,
    "opacity:0",
    "pointer-events:none",
    "z-index:2147483646",
    "overflow:visible",
    "background:#ffffff",
  ].join(";");

  document.body.appendChild(mount);
  const reactRoot = createRoot(mount);

  try {
    const generatedAt = new Date().toISOString();
    await new Promise<void>((resolve, reject) => {
      try {
        reactRoot.render(
          createElement(PhotoRecordPdfExportLayout, {
            task,
            photos,
            generatedAt,
            generatedBy,
            photoAssetsById: assets,
            logoSrc: logoDataUrl ?? undefined,
          }),
        );
        resolve();
      } catch (e) {
        reject(e);
      }
    });

    await waitForReportDomReady();
    await waitForExportImages(mount);

    const pages = mount.querySelectorAll("[data-report-export-page]");
    if (pages.length === 0) {
      throw new Error("El layout PDF no generó páginas.");
    }

    await exportReportPdfFromExportRoot(mount, buildPhotoRecordPdfFilename(task.ra));
  } finally {
    reactRoot.unmount();
    mount.remove();
  }
}

export type { RaPhotoPdfAsset };
