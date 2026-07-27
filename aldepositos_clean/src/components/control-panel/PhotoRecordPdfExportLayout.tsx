"use client";

/**
 * Layout PDF profesional para registro fotográfico de RA.
 * Portada + 1–2 fotos grandes por hoja + pie de página.
 * Estilos inline para html2canvas.
 */

import type { CSSProperties } from "react";
import type { Task } from "@/lib/types/task";
import type { RaPhoto } from "@/lib/types/raPhoto";
import { RA_PHOTO_CATEGORY_LABELS } from "@/lib/types/raPhoto";
import logoMark from "@/assets/brand/logo-aldepositos.png";
import { PDF_EXPORT_WIDTH_PX } from "./reportsPdfExport";
import type { RaPhotoPdfAsset } from "@/lib/raPhotoStorage";
import { computeReportData } from "@/lib/reportTotals";
import { photoRecordTakenByLabel } from "@/lib/raPhotoRecord";

const BRAND = "#16263F";
const TEXT = "#1e293b";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const PAGE_PAD_X = 44;
const PAGE_PAD_Y = 36;
const CONTENT_W = PDF_EXPORT_WIDTH_PX - PAGE_PAD_X * 2;
/** Máximo de fotos por hoja (grandes, apaisadas). */
const PHOTOS_PER_PAGE = 2;
const PHOTO_SLOT_H = 420;
const FOOTER_H = 28;

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

function formatLongDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-PA", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
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
  return pages.length > 0 ? pages : [[]];
}

function pageShellStyle(): CSSProperties {
  return {
    width: `${PDF_EXPORT_WIDTH_PX}px`,
    minHeight: 1100,
    boxSizing: "border-box",
    backgroundColor: "#ffffff",
    color: TEXT,
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
    fontSize: 12,
    lineHeight: 1.45,
    padding: `${PAGE_PAD_Y}px ${PAGE_PAD_X}px ${PAGE_PAD_Y + FOOTER_H}px`,
    position: "relative",
    overflow: "visible",
  };
}

function PageFooter({
  task,
  page,
  totalPages,
}: {
  task: Task;
  page: number;
  totalPages: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: PAGE_PAD_X,
        right: PAGE_PAD_X,
        bottom: 18,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderTop: `1px solid ${BORDER}`,
        paddingTop: 10,
        fontSize: 9,
        fontWeight: 700,
        color: MUTED,
        letterSpacing: "0.04em",
      }}
    >
      <span>
        ALDEPÓSITOS · Zona Libre Panamá · RA {String(task.ra ?? "—")}
      </span>
      <span>
        p. {page}/{totalPages}
      </span>
    </div>
  );
}

function CoverPage({
  task,
  photos,
  generatedAt,
  generatedBy,
  totalPages,
}: {
  task: Task;
  photos: RaPhoto[];
  generatedAt: string;
  generatedBy?: string;
  totalPages: number;
}) {
  const { totals } = computeReportData(task);
  const capturadoPor =
    photoRecordTakenByLabel(task) !== "Sin atribuir"
      ? photoRecordTakenByLabel(task)
      : generatedBy || "—";

  const metaRows = [
    { label: "Cliente", value: task.mainClient || "—" },
    { label: "Proveedor", value: task.provider || "—" },
    { label: "Marca", value: task.brand || "—" },
    {
      label: "Bultos",
      value: `${task.currentBultos || totals.bultos || 0} / ${task.expectedBultos || "—"}`,
    },
    { label: "CBM", value: totals.cbm || "—" },
    { label: "Peso kg", value: String(totals.weight ?? "—") },
  ];

  return (
    <div data-report-export-page style={pageShellStyle()}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          paddingTop: 48,
          marginBottom: 36,
        }}
      >
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: 9999,
            padding: 10,
            border: `1px solid ${BORDER}`,
            marginBottom: 20,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoMark.src}
            alt="ALDEPÓSITOS"
            width={72}
            height={72}
            style={{ display: "block", width: 72, height: 72, objectFit: "contain" }}
            crossOrigin="anonymous"
          />
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: MUTED,
            marginBottom: 10,
          }}
        >
          ALDEPÓSITOS · Zona Libre Panamá
        </div>
        <div
          style={{
            fontSize: 28,
            fontWeight: 900,
            color: BRAND,
            letterSpacing: "-0.03em",
            lineHeight: 1.15,
            marginBottom: 8,
          }}
        >
          Registro fotográfico
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: TEXT,
            marginBottom: 6,
          }}
        >
          RA {String(task.ra ?? "—")}
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: MUTED }}>
          {formatLongDate(generatedAt)}
        </div>
      </div>

      <div
        style={{
          height: 4,
          backgroundColor: BRAND,
          borderRadius: 2,
          marginBottom: 28,
        }}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 28,
        }}
      >
        {metaRows.map((row) => (
          <div
            key={row.label}
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              padding: "14px 16px",
              backgroundColor: "#f8fafc",
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: MUTED,
                marginBottom: 6,
              }}
            >
              {row.label}
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 800,
                color: TEXT,
                wordBreak: "break-word",
              }}
            >
              {row.value}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: "18px 20px",
          backgroundColor: "#ffffff",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 12,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: MUTED,
                marginBottom: 4,
              }}
            >
              Capturado por
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: BRAND }}>
              {capturadoPor}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: MUTED,
                marginBottom: 4,
              }}
            >
              Fotografías
            </div>
            <div style={{ fontSize: 15, fontWeight: 800, color: TEXT }}>
              {photos.length}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>
          Documento de evidencia visual para el cliente. Generado{" "}
          {formatPhotoDate(generatedAt)}
          {generatedBy ? ` · ${generatedBy}` : ""}.
        </div>
      </div>

      <PageFooter task={task} page={1} totalPages={totalPages} />
    </div>
  );
}

function PhotoBlock({
  photo,
  asset,
  index,
  slotH,
}: {
  photo: RaPhoto;
  asset: RaPhotoPdfAsset;
  index: number;
  slotH: number;
}) {
  const metaH = 44;
  const imgMaxH = slotH - metaH;
  const { w: imgW, h: imgH } = fitImageInBox(
    asset.width,
    asset.height,
    CONTENT_W - 8,
    imgMaxH,
  );
  const category = RA_PHOTO_CATEGORY_LABELS[photo.category ?? "general"];

  return (
    <div
      style={{
        width: CONTENT_W,
        height: slotH,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        marginBottom: 18,
      }}
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#f1f5f9",
          borderRadius: 10,
          border: `1px solid ${BORDER}`,
          minHeight: imgMaxH,
          boxSizing: "border-box",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.src}
          alt={photo.caption || `Foto ${index}`}
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
      <div
        style={{
          marginTop: 8,
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: BRAND,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            #{index} · {category}
          </div>
          {photo.caption ? (
            <div
              style={{
                marginTop: 2,
                fontSize: 12,
                fontWeight: 600,
                color: TEXT,
              }}
            >
              {photo.caption}
            </div>
          ) : null}
        </div>
        <div
          style={{
            textAlign: "right",
            fontSize: 10,
            fontWeight: 600,
            color: MUTED,
            flexShrink: 0,
          }}
        >
          {formatPhotoDate(photo.takenAt)}
          {photo.takenByName ? (
            <div style={{ marginTop: 2 }}>{photo.takenByName}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function PhotoRecordPdfExportLayout(props: Props) {
  const {
    task,
    photos,
    generatedAt,
    generatedBy,
    photoSrcById = {},
    photoAssetsById = {},
  } = props;

  const photoPages = paginatePhotos(photos);
  const totalPages = 1 + (photos.length > 0 ? photoPages.length : 0);

  return (
    <>
      <CoverPage
        task={task}
        photos={photos}
        generatedAt={generatedAt}
        generatedBy={generatedBy}
        totalPages={Math.max(1, totalPages)}
      />

      {photos.length === 0 ? null : (
        photoPages.map((pagePhotos, pageIndex) => {
          const pageNum = pageIndex + 2;
          const single = pagePhotos.length === 1;
          const slotH = single ? PHOTO_SLOT_H * 1.55 : PHOTO_SLOT_H;

          return (
            <div
              key={`photo-pdf-page-${pageIndex}`}
              data-report-export-page
              style={pageShellStyle()}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-end",
                  marginBottom: 18,
                  paddingBottom: 12,
                  borderBottom: `3px solid ${BRAND}`,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      color: MUTED,
                      marginBottom: 4,
                    }}
                  >
                    Evidencia fotográfica
                  </div>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 900,
                      color: BRAND,
                    }}
                  >
                    RA {String(task.ra ?? "—")}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: MUTED,
                  }}
                >
                  {pagePhotos.length} foto
                  {pagePhotos.length === 1 ? "" : "s"} en esta hoja
                </div>
              </div>

              {pagePhotos.map((photo, i) => {
                const globalIndex = pageIndex * PHOTOS_PER_PAGE + i + 1;
                const asset = assetForPhoto(
                  photo,
                  photoAssetsById,
                  photoSrcById,
                );
                return (
                  <PhotoBlock
                    key={photo.id}
                    photo={photo}
                    asset={asset}
                    index={globalIndex}
                    slotH={slotH}
                  />
                );
              })}

              <PageFooter
                task={task}
                page={pageNum}
                totalPages={totalPages}
              />
            </div>
          );
        })
      )}
    </>
  );
}
