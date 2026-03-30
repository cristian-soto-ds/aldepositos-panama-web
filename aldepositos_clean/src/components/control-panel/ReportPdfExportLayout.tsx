"use client";

/**
 * Vista SOLO para exportación PDF (off-screen). Carta 8.5×11 @96dpi.
 * Estilos inline (hex/rgb) para html2canvas estable — sin Tailwind.
 */

import type { CSSProperties } from "react";
import type { Task } from "@/lib/types/task";
import logoMark from "@/assets/brand/logo-aldepositos.png";
import { PDF_EXPORT_WIDTH_PX } from "./reportsPdfExport";

const BRAND = "#16263F";
const TEXT = "#1e293b";
const MUTED = "#64748b";
const BORDER = "#cbd5e1";
const CELL_BG = "#f1f5f9";
const ACCENT = "#2563eb";

/** Alto mínimo ≈ 11 in a 96 DPI — la página carta se siente “llena” con pie al fondo */
const LETTER_HEIGHT_PX = 1056;

type Props = {
  task: Task;
  currentDate: string;
  /** Varios RAs en un solo PDF: más denso, sin forzar altura carta */
  compact?: boolean;
};

function computeTotals(task: Task) {
  const measureRows = (task.measureData || []) as Record<string, unknown>[];
  const isDetailed = task.type === "detailed";
  const showWeightColumn = task.weightMode === "per_bundle" || isDetailed;
  const showReferenceColumn =
    task.weightMode === "by_reference" || isDetailed;

  let totalWeight = task.expectedWeight || 0;
  let totalUnidades = 0;

  if (isDetailed) {
    totalWeight = measureRows.reduce(
      (acc, row) =>
        acc +
        (parseFloat(String(row.pesoPorBulto ?? 0)) || 0) *
          (parseFloat(String(row.bultos ?? 0)) || 0),
      0,
    );
    totalUnidades = measureRows.reduce(
      (acc, row) =>
        acc +
        (parseFloat(String(row.unidadesPorBulto ?? 0)) || 0) *
          (parseFloat(String(row.bultos ?? 0)) || 0),
      0,
    );
  } else if (task.weightMode === "per_bundle") {
    const calcWeight = measureRows.reduce(
      (acc, row) =>
        acc +
        (parseFloat(String(row.weight ?? 0)) || 0) *
          (parseFloat(String(row.bultos ?? 0)) || 0),
      0,
    );
    if (calcWeight > 0) totalWeight = calcWeight;
  }

  const totals = {
    bultos: measureRows.reduce(
      (a, b) => a + (parseFloat(String(b.bultos ?? 0)) || 0),
      0,
    ),
    cbm: measureRows
      .reduce((acc, row) => {
        const l = parseFloat(String(row.l ?? 0)) || 0;
        const w = parseFloat(String(row.w ?? 0)) || 0;
        const h = parseFloat(String(row.h ?? 0)) || 0;
        const b = parseFloat(String(row.bultos ?? 0)) || 0;
        return acc + ((l * w * h) / 1_000_000) * b;
      }, 0)
      .toFixed(2),
    weight: totalWeight,
    unidades: totalUnidades,
  };

  return {
    measureRows,
    isDetailed,
    showWeightColumn,
    showReferenceColumn,
    totals,
  };
}

function sectionTitleStyle(fsSmall: number): CSSProperties {
  return {
    fontSize: fsSmall,
    fontWeight: 900,
    color: BRAND,
    textTransform: "uppercase",
    letterSpacing: "0.18em",
    marginBottom: 10,
    paddingLeft: 12,
    borderLeft: `4px solid ${ACCENT}`,
  };
}

export function ReportPdfExportLayout({
  task,
  currentDate,
  compact = false,
}: Props) {
  const { measureRows, isDetailed, showWeightColumn, showReferenceColumn, totals } =
    computeTotals(task);

  const padX = compact ? 14 : 44;
  const padY = compact ? 12 : 40;
  const fs = compact ? 12 : 13;
  const fsSmall = compact ? 10 : 11;
  const logoSize = compact ? 40 : 54;

  const thBase: CSSProperties = {
    border: "1px solid rgba(255,255,255,0.22)",
    padding: compact ? "6px 4px" : "8px 6px",
    fontWeight: 800,
    textTransform: "uppercase",
    fontSize: compact ? 7 : 8,
    letterSpacing: "0.04em",
    backgroundColor: BRAND,
    color: "#ffffff",
  };

  return (
    <div
      style={{
        width: `${PDF_EXPORT_WIDTH_PX}px`,
        minHeight: compact ? undefined : LETTER_HEIGHT_PX,
        boxSizing: "border-box",
        backgroundColor: "#ffffff",
        color: TEXT,
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
        fontSize: fs,
        lineHeight: 1.45,
        padding: `${padY}px ${padX}px`,
        marginBottom: compact ? 20 : 0,
        border: "none",
        position: "relative",
        overflow: "visible",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Encabezado — ancho útil carta */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "stretch",
          gap: 20,
          marginBottom: 22,
          paddingBottom: 20,
          borderBottom: `4px solid ${BRAND}`,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: compact ? 12 : 18,
            flex: 1,
            minWidth: 0,
          }}
        >
          <div
            style={{
              flexShrink: 0,
              backgroundColor: "#ffffff",
              borderRadius: 9999,
              padding: compact ? 5 : 7,
              border: `1px solid ${BORDER}`,
              boxShadow: "0 2px 8px rgba(15, 23, 42, 0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src={logoMark.src}
              alt=""
              width={logoMark.width}
              height={logoMark.height}
              style={{
                display: "block",
                width: logoSize,
                height: logoSize,
                objectFit: "contain",
              }}
            />
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: compact ? 21 : 28,
                fontWeight: 900,
                color: BRAND,
                letterSpacing: "-0.03em",
                lineHeight: 1,
              }}
            >
              ALDEPOSITOS
            </div>
            <div
              style={{
                fontSize: fsSmall,
                fontWeight: 700,
                color: MUTED,
                textTransform: "uppercase",
                letterSpacing: "0.2em",
                marginTop: 8,
              }}
            >
              Servicios logísticos integrales
            </div>
          </div>
        </div>
        <div
          style={{
            textAlign: "right",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            paddingLeft: 16,
            borderLeft: `3px solid ${ACCENT}`,
          }}
        >
          <div
            style={{
              fontSize: compact ? 12 : 14,
              fontWeight: 900,
              color: TEXT,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              lineHeight: 1.25,
            }}
          >
            Reporte de ingreso
            <br />
            {isDetailed ? "detallado" : "rápido"}
          </div>
          <div
            style={{
              fontSize: fsSmall,
              fontWeight: 700,
              color: MUTED,
              marginTop: 8,
            }}
          >
            Fecha: {currentDate}
          </div>
        </div>
      </div>

      {/* Cliente / RA */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: 14,
          marginBottom: 22,
        }}
      >
        <div
          style={{
            flex: 1,
            backgroundColor: CELL_BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 6,
            padding: compact ? 12 : 18,
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 800,
              color: MUTED,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              marginBottom: 6,
            }}
          >
            Cliente / consignatario
          </div>
          <div
            style={{
              fontWeight: 900,
              color: BRAND,
              textTransform: "uppercase",
              fontSize: compact ? 13 : 15,
            }}
          >
            {task.mainClient}
          </div>
          <div
            style={{
              fontSize: 9,
              fontWeight: 800,
              color: MUTED,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              marginTop: 14,
              marginBottom: 6,
            }}
          >
            Expedidor
          </div>
          <div
            style={{
              fontWeight: 700,
              color: TEXT,
              textTransform: "uppercase",
              fontSize: fsSmall,
            }}
          >
            {task.subClient}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            backgroundColor: CELL_BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 6,
            padding: compact ? 12 : 18,
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 800,
              color: MUTED,
              textTransform: "uppercase",
              letterSpacing: "0.14em",
              marginBottom: 6,
            }}
          >
            Número de recepción (RA)
          </div>
          <div
            style={{
              fontSize: compact ? 20 : 26,
              fontWeight: 900,
              color: BRAND,
              textTransform: "uppercase",
              letterSpacing: "-0.02em",
            }}
          >
            RA-{task.ra}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              gap: 12,
              marginTop: 14,
              paddingTop: 14,
              borderTop: `1px solid ${BORDER}`,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  color: MUTED,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  marginBottom: 4,
                }}
              >
                Proveedor
              </div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: TEXT,
                  textTransform: "uppercase",
                  lineHeight: 1.35,
                }}
              >
                {task.provider}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  color: MUTED,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  marginBottom: 4,
                }}
              >
                Marca / tracking
              </div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: TEXT,
                  textTransform: "uppercase",
                  lineHeight: 1.35,
                }}
              >
                {task.brand}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={sectionTitleStyle(fsSmall)}>Resumen físico consolidado</div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          border: `1px solid ${BORDER}`,
          borderRadius: 6,
          overflow: "hidden",
          marginBottom: 22,
        }}
      >
        <div
          style={{
            flex: 1,
            padding: compact ? 10 : 14,
            textAlign: "center",
            borderRight: `1px solid ${BORDER}`,
            backgroundColor: "#ffffff",
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 800,
              color: MUTED,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 4,
            }}
          >
            Bultos físicos
          </div>
          <div style={{ fontSize: compact ? 20 : 26, fontWeight: 900, color: BRAND }}>
            {totals.bultos}
          </div>
        </div>
        {isDetailed && (
          <div
            style={{
              flex: 1,
              padding: compact ? 10 : 14,
              textAlign: "center",
              borderRight: `1px solid ${BORDER}`,
              backgroundColor: "#faf5ff",
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 800,
                color: "#7c3aed",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                marginBottom: 4,
              }}
            >
              Total unidades
            </div>
            <div style={{ fontSize: compact ? 20 : 26, fontWeight: 900, color: "#5b21b6" }}>
              {totals.unidades}
            </div>
          </div>
        )}
        <div
          style={{
            flex: 1,
            padding: compact ? 10 : 14,
            textAlign: "center",
            borderRight: `1px solid ${BORDER}`,
            backgroundColor: CELL_BG,
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 800,
              color: MUTED,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 4,
            }}
          >
            Volumen total (CBM)
          </div>
          <div style={{ fontSize: compact ? 20 : 26, fontWeight: 900, color: BRAND }}>
            {totals.cbm} <span style={{ fontSize: 14 }}>m³</span>
          </div>
        </div>
        <div
          style={{
            flex: 1,
            padding: compact ? 10 : 14,
            textAlign: "center",
            backgroundColor: "#ffffff",
          }}
        >
          <div
            style={{
              fontSize: 9,
              fontWeight: 800,
              color: MUTED,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 4,
            }}
          >
            Peso total
          </div>
          <div style={{ fontSize: compact ? 20 : 26, fontWeight: 900, color: BRAND }}>
            {totals.weight.toFixed(2)} <span style={{ fontSize: 14 }}>kg</span>
          </div>
        </div>
      </div>

      <div style={sectionTitleStyle(fsSmall)}>Detalle de dimensiones</div>

      {isDetailed ? (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: compact ? 7 : 8,
            marginBottom: 18,
            border: `1px solid ${BORDER}`,
          }}
        >
          <thead>
            <tr>
              {[
                "#",
                "Ref.",
                "Desc.",
                "Bult.",
                "Und/B",
                "Tot.U",
                "P/B",
                "P.Tot",
                "L",
                "W",
                "H",
                "CBM/B",
                "Tot CBM",
              ].map((label, i, arr) => (
                <th
                  key={label}
                  style={{
                    ...thBase,
                    backgroundColor: i === arr.length - 1 ? ACCENT : BRAND,
                  }}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {measureRows.map((row, idx) => {
              const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
              const undPerBulto = parseFloat(String(row.unidadesPorBulto ?? 0)) || 0;
              const pesoPorBulto = parseFloat(String(row.pesoPorBulto ?? 0)) || 0;
              const l = parseFloat(String(row.l ?? 0)) || 0;
              const w = parseFloat(String(row.w ?? 0)) || 0;
              const h = parseFloat(String(row.h ?? 0)) || 0;
              const totalUnidades = bultos * undPerBulto;
              const pesoTotal = bultos * pesoPorBulto;
              const cbmPorBulto = (l * w * h) / 1_000_000;
              const cubicajeTotal = cbmPorBulto * bultos;
              const bg = idx % 2 === 0 ? "#ffffff" : CELL_BG;
              return (
                <tr key={idx} style={{ backgroundColor: bg }}>
                  <td
                    style={{
                      border: `1px solid ${BORDER}`,
                      padding: 4,
                      textAlign: "center",
                      fontWeight: 700,
                    }}
                  >
                    {idx + 1}
                  </td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4 }}>
                    {String(row.referencia || "-")}
                  </td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4 }}>
                    {String(row.descripcion || "-")}
                  </td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center" }}>
                    {bultos}
                  </td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center" }}>
                    {undPerBulto}
                  </td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center" }}>
                    {totalUnidades}
                  </td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center" }}>
                    {pesoPorBulto.toFixed(2)}
                  </td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center" }}>
                    {pesoTotal.toFixed(2)}
                  </td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center" }}>
                    {l}
                  </td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center" }}>
                    {w}
                  </td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center" }}>
                    {h}
                  </td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center" }}>
                    {cbmPorBulto.toFixed(2)}
                  </td>
                  <td
                    style={{
                      border: `1px solid ${BORDER}`,
                      padding: 4,
                      textAlign: "center",
                      fontWeight: 800,
                      color: "#1e40af",
                    }}
                  >
                    {cubicajeTotal.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: compact ? 9 : 10,
            marginBottom: 18,
            border: `1px solid ${BORDER}`,
          }}
        >
          <thead>
            <tr>
              <th style={thBase}>#</th>
              {showReferenceColumn && <th style={thBase}>Referencia</th>}
              <th style={thBase}>Bultos</th>
              {showWeightColumn && <th style={thBase}>Peso (kg)</th>}
              <th style={thBase}>L</th>
              <th style={thBase}>W</th>
              <th style={thBase}>H</th>
              <th style={{ ...thBase, backgroundColor: ACCENT }}>Total CBM</th>
            </tr>
          </thead>
          <tbody>
            {measureRows.map((row, idx) => {
              const l = parseFloat(String(row.l ?? 0)) || 0;
              const w = parseFloat(String(row.w ?? 0)) || 0;
              const h = parseFloat(String(row.h ?? 0)) || 0;
              const b = parseFloat(String(row.bultos ?? 0)) || 0;
              const rowCbm = ((l * w * h) / 1_000_000) * b;
              const bg = idx % 2 === 0 ? "#ffffff" : CELL_BG;
              return (
                <tr key={idx} style={{ backgroundColor: bg }}>
                  <td
                    style={{
                      border: `1px solid ${BORDER}`,
                      padding: compact ? 6 : 8,
                      textAlign: "center",
                      fontWeight: 700,
                    }}
                  >
                    {idx + 1}
                  </td>
                  {showReferenceColumn && (
                    <td style={{ border: `1px solid ${BORDER}`, padding: compact ? 6 : 8 }}>
                      {String(row.referencia || "-")}
                    </td>
                  )}
                  <td
                    style={{
                      border: `1px solid ${BORDER}`,
                      padding: compact ? 6 : 8,
                      textAlign: "center",
                      fontWeight: 700,
                    }}
                  >
                    {String(row.bultos ?? "")}
                  </td>
                  {showWeightColumn && (
                    <td
                      style={{
                        border: `1px solid ${BORDER}`,
                        padding: compact ? 6 : 8,
                        textAlign: "center",
                      }}
                    >
                      {row.weight != null ? String(row.weight) : "-"}
                    </td>
                  )}
                  <td
                    style={{
                      border: `1px solid ${BORDER}`,
                      padding: compact ? 6 : 8,
                      textAlign: "center",
                      color: MUTED,
                    }}
                  >
                    {String(row.l ?? 0)}
                  </td>
                  <td
                    style={{
                      border: `1px solid ${BORDER}`,
                      padding: compact ? 6 : 8,
                      textAlign: "center",
                      color: MUTED,
                    }}
                  >
                    {String(row.w ?? 0)}
                  </td>
                  <td
                    style={{
                      border: `1px solid ${BORDER}`,
                      padding: compact ? 6 : 8,
                      textAlign: "center",
                      color: MUTED,
                    }}
                  >
                    {String(row.h ?? 0)}
                  </td>
                  <td
                    style={{
                      border: `1px solid ${BORDER}`,
                      padding: compact ? 6 : 8,
                      textAlign: "center",
                      fontWeight: 800,
                      color: "#1e40af",
                    }}
                  >
                    {rowCbm.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {task.notes ? (
        <div style={{ marginBottom: compact ? 12 : 18 }}>
          <div style={sectionTitleStyle(fsSmall)}>Observaciones</div>
          <div
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: 6,
              padding: 14,
              fontSize: fsSmall,
              color: TEXT,
              backgroundColor: "#ffffff",
              textTransform: "uppercase",
              lineHeight: 1.5,
            }}
          >
            {task.notes}
          </div>
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: compact ? 8 : 20 }} aria-hidden />

      <div
        style={{
          paddingTop: 16,
          borderTop: `1px solid ${BORDER}`,
          textAlign: "center",
          fontSize: 8,
          fontWeight: 700,
          color: MUTED,
          textTransform: "uppercase",
          letterSpacing: "0.16em",
        }}
      >
        Aldepositos · documento generado por Warehouse OS
      </div>
    </div>
  );
}
