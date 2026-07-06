"use client";

/**
 * Layout PDF para registro fotográfico de RA — estilos inline para html2canvas.
 */

import type { CSSProperties } from "react";
import type { Task } from "@/lib/types/task";
import type { RaPhoto } from "@/lib/types/raPhoto";
import { RA_PHOTO_CATEGORY_LABELS } from "@/lib/types/raPhoto";
import logoMark from "@/assets/brand/logo-aldepositos.png";
import { PDF_EXPORT_WIDTH_PX } from "./reportsPdfExport";
import type { RaPhotoPdfAsset } from "@/lib/raPhotoStorage";
import { computeReportData } from "@/lib/reportTotals";

const BRAND = "#16263F";
const TEXT = "#1e293b";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const PAGE_PAD_X = 40;
const PAGE_PAD_Y = 28;
const CONTENT_W = PDF_EXPORT_WIDTH_PX - PAGE_PAD_X * 2;
const COL_GAP = 14;
const ROW_GAP = 14;
/** Máximo de fotos por hoja (cuadrícula 2×2). */
const PHOTOS_PER_PAGE = 4;
/** Altura máxima de imagen en cuadrícula — compacta pero legible. */
const GRID_IMG_MAX_H = 200;

type Props = {
  task: Task;
  photos: RaPhoto[];
  generatedAt: string;
  generatedBy?: string;
  photoSrcById?: Record<string, string>;
  photoAssetsById?: Record<string, RaPhotoPdfAsset>;
};

function formatPhotoDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-PA", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function fitImageInBox(
  naturalW: number,
  naturalH: number,
  maxW: number,
  maxH: number,
): { w: number; h: number } {
  const nw = Math.max(1, naturalW);
  const nh = Math.max(1, naturalH);
  const scale = Math.min(maxW / nw, maxH / nh);
  return {
    w: Math.max(1, Math.round(nw * scale)),
    h: Math.max(1, Math.round(nh * scale)),
  };
}

function assetForPhoto(
  photo: RaPhoto,
  photoAssetsById: Record<string, RaPhotoPdfAsset>,
  photoSrcById: Record<string, string>,
): RaPhotoPdfAsset {
  const asset = photoAssetsById[photo.id];
  if (asset) return asset;
  const src = photoSrcById[photo.id] || photo.url;
  return { src, width: 4, height: 3 };
}

function paginatePhotos(photos: RaPhoto[]): RaPhoto[][] {
  const pages: RaPhoto[][] = [];
  for (let i = 0; i < photos.length; i += PHOTOS_PER_PAGE) {
    pages.push(photos.slice(i, i + PHOTOS_PER_PAGE));
  }
  return pages;
}

function pageShellStyle(): CSSProperties {
  return {
    width: `${PDF_EXPORT_WIDTH_PX}px`,
    boxSizing: "border-box",
    backgroundColor: "#ffffff",
    color: TEXT,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
    fontSize: 12,
    lineHeight: 1.45,
    padding: `${PAGE_PAD_Y}px ${PAGE_PAD_X}px`,
    position: "relative",
    overflow: "visible",
  };
}

function PdfHeader({
  task,
  generatedAt,
  subtitle,
}: {
  task: Task;
  generatedAt: string;
  subtitle?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 16,
        marginBottom: 18,
        paddingBottom: 16,
        borderBottom: `4px solid ${BRAND}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
        <div
          style={{
            flexShrink: 0,
            backgroundColor: "#ffffff",
            borderRadius: 9999,
            padding: 6,
            border: `1px solid ${BORDER}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoMark.src}
            alt="ALDEPÓSITOS"
            width={48}
            height={48}
            style={{ display: "block", width: 48, height: 48, objectFit: "contain" }}
            crossOrigin="anonymous"
          />
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 18,
              fontWeight: 900,
              color: BRAND,
              letterSpacing: "-0.02em",
              lineHeight: 1.25,
            }}
          >
            Registro fotográfico · RA {String(task.ra ?? "—")}
          </div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: MUTED,
              marginTop: 6,
              lineHeight: 1.35,
            }}
          >
            {subtitle ?? "ALDEPÓSITOS · Zona Libre, Panamá"}
          </div>
        </div>
      </div>
      <div
        style={{
          textAlign: "right",
          fontSize: 10,
          color: MUTED,
          fontWeight: 700,
          lineHeight: 1.4,
          flexShrink: 0,
          paddingTop: 4,
        }}
      >
        {formatPhotoDate(generatedAt)}
      </div>
    </div>
  );
}

function CompactInfoRow({ task }: { task: Task }) {
  const { totals } = computeReportData(task);
  const items = [
    { label: "Cliente", value: task.mainClient },
    { label: "Proveedor", value: task.provider },
    { label: "Marca", value: task.brand },
    {
      label: "Bultos",
      value: `${task.currentBultos || totals.bultos} / ${task.expectedBultos || "—"}`,
    },
    { label: "CBM", value: totals.cbm },
    { label: "Peso kg", value: String(totals.weight) },
  ];

  const labelStyle: CSSProperties = {
    display: "block",
    fontWeight: 800,
    color: MUTED,
    textTransform: "uppercase",
    fontSize: 9,
    letterSpacing: "0.1em",
    lineHeight: 1.35,
    marginBottom: 4,
  };

  const valueStyle: CSSProperties = {
    display: "block",
    fontWeight: 800,
    color: TEXT,
    fontSize: 12,
    lineHeight: 1.45,
    minHeight: 18,
    wordBreak: "break-word",
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 10,
        marginBottom: 18,
        padding: "14px 16px",
        backgroundColor: "#f8fafc",
        borderRadius: 10,
        border: `1px solid ${BORDER}`,
        boxSizing: "border-box",
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            minWidth: 0,
            padding: "4px 2px",
            boxSizing: "border-box",
          }}
        >
          <span style={labelStyle}>{item.label}</span>
          <span style={valueStyle}>{item.value || "—"}</span>
        </div>
      ))}
    </div>
  );
}

function PhotoThumb({
  photo,
  asset,
  cellW,
}: {
  photo: RaPhoto;
  asset: RaPhotoPdfAsset;
  cellW: number;
}) {
  const imgMaxW = cellW - 4;
  const { w: imgW, h: imgH } = fitImageInBox(
    asset.width,
    asset.height,
    imgMaxW,
    GRID_IMG_MAX_H,
  );
  const category =
    photo.category && photo.category !== "general"
      ? RA_PHOTO_CATEGORY_LABELS[photo.category]
      : null;

  return (
    <div
      style={{
        width: `${cellW}px`,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: `${cellW}px`,
          height: `${GRID_IMG_MAX_H}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f1f5f9",
          borderRadius: 6,
          border: `1px solid ${BORDER}`,
          boxSizing: "border-box",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.src}
          alt={photo.caption || "Foto"}
          width={imgW}
          height={imgH}
          style={{
            width: `${imgW}px`,
            height: `${imgH}px`,
            display: "block",
            objectFit: "contain",
          }}
        />
      </div>
      {(category || photo.caption) && (
        <div
          style={{
            marginTop: 5,
            width: "100%",
            textAlign: "center",
            fontSize: 9,
            lineHeight: 1.3,
            color: MUTED,
          }}
        >
          {category ? (
            <span style={{ fontWeight: 800, color: BRAND, textTransform: "uppercase" }}>
              {category}
            </span>
          ) : null}
          {category && photo.caption ? " · " : null}
          {photo.caption ? (
            <span style={{ fontWeight: 600, color: TEXT }}>{photo.caption}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function PhotoGrid({
  photos,
  photoSrcById = {},
  photoAssetsById = {},
}: {
  photos: RaPhoto[];
  photoSrcById?: Record<string, string>;
  photoAssetsById?: Record<string, RaPhotoPdfAsset>;
}) {
  const cellW = Math.floor((CONTENT_W - COL_GAP) / 2);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(2, ${cellW}px)`,
        columnGap: COL_GAP,
        rowGap: ROW_GAP,
        width: `${CONTENT_W}px`,
        justifyContent: "center",
      }}
    >
      {photos.map((photo) => {
        const asset = assetForPhoto(photo, photoAssetsById, photoSrcById);
        return (
          <PhotoThumb key={photo.id} photo={photo} asset={asset} cellW={cellW} />
        );
      })}
    </div>
  );
}

export function PhotoRecordPdfExportLayout(props: Props) {
  const { task, photos, generatedAt, photoSrcById, photoAssetsById } = props;
  const photoPages = paginatePhotos(photos);
  const totalDocPages = photos.length > 0 ? photoPages.length : 1;

  if (photos.length === 0) {
    return (
      <div data-report-export-page style={pageShellStyle()}>
        <PdfHeader task={task} generatedAt={generatedAt} />
        <CompactInfoRow task={task} />
        <p style={{ fontSize: 11, color: MUTED, textAlign: "center", padding: 24 }}>
          Sin fotografías registradas.
        </p>
      </div>
    );
  }

  return (
    <>
      {photoPages.map((pagePhotos, pageIndex) => (
        <div
          key={`photo-pdf-page-${pageIndex}`}
          data-report-export-page
          style={pageShellStyle()}
        >
          <PdfHeader
            task={task}
            generatedAt={generatedAt}
            subtitle={
              totalDocPages > 1
                ? `Evidencia fotográfica · Hoja ${pageIndex + 1} de ${totalDocPages}`
                : "Evidencia fotográfica"
            }
          />
          {pageIndex === 0 ? <CompactInfoRow task={task} /> : null}
          <PhotoGrid
            photos={pagePhotos}
            photoSrcById={photoSrcById}
            photoAssetsById={photoAssetsById}
          />
        </div>
      ))}
    </>
  );
}
