"use client";

/**
 * Vista SOLO para exportación PDF (no se muestra en pantalla).
 * Estilos 100% inline (hex/rgb) — sin Tailwind — para html2canvas estable.
 */

import type { Task } from "@/lib/types/task";
import { PDF_EXPORT_WIDTH_PX } from "./reportsPdfExport";

const BRAND = "#16263F";
const TEXT = "#1e293b";
const MUTED = "#64748b";
const BORDER = "#cbd5e1";
const CELL_BG = "#f8fafc";
const HEADER_BG = "#1e293b";
const ACCENT = "#2563eb";

type Props = {
  task: Task;
  currentDate: string;
  /** Más compacto cuando hay varios RAs en un solo PDF */
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

export function ReportPdfExportLayout({
  task,
  currentDate,
  compact = false,
}: Props) {
  const { measureRows, isDetailed, showWeightColumn, showReferenceColumn, totals } =
    computeTotals(task);

  const pad = compact ? 10 : 16;
  const fs = compact ? 12 : 13;
  const fsSmall = compact ? 10 : 11;

  return (
    <div
      style={{
        width: `${PDF_EXPORT_WIDTH_PX}px`,
        boxSizing: "border-box",
        backgroundColor: "#ffffff",
        color: TEXT,
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
        fontSize: fs,
        lineHeight: 1.4,
        padding: `${pad}px`,
        marginBottom: compact ? 16 : 0,
        border: `1px solid ${BORDER}`,
        position: "relative",
        overflow: "visible",
        boxShadow: "none",
        transform: "none",
      }}
    >
      {/* Encabezado */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-end",
          borderBottom: `3px solid ${BRAND}`,
          paddingBottom: 16,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 16 }}>
          <div
            style={{
              backgroundColor: BRAND,
              padding: 12,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 44,
              height: 44,
              boxSizing: "border-box",
            }}
          >
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden
            >
              <path
                fill="#ffffff"
                d="M12 3L4 9v12h16V9l-8-6zm0 2.18l6 4.5V19H6v-9.32l6-4.5z"
              />
            </svg>
          </div>
          <div>
            <div
              style={{
                fontSize: compact ? 22 : 26,
                fontWeight: 900,
                color: BRAND,
                letterSpacing: "-0.02em",
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
                letterSpacing: "0.15em",
                marginTop: 4,
              }}
            >
              Servicios logísticos integrales
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: compact ? 14 : 16,
              fontWeight: 900,
              color: TEXT,
              textTransform: "uppercase",
            }}
          >
            Reporte de ingreso {isDetailed ? "detallado" : "rápido"}
          </div>
          <div style={{ fontSize: fsSmall, fontWeight: 700, color: MUTED, marginTop: 4 }}>
            Fecha: {currentDate}
          </div>
        </div>
      </div>

      {/* Cliente / RA */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            flex: 1,
            backgroundColor: CELL_BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            padding: 16,
          }}
        >
          <div style={{ fontSize: fsSmall, fontWeight: 800, color: MUTED, textTransform: "uppercase", marginBottom: 4 }}>
            Cliente / consignatario
          </div>
          <div style={{ fontWeight: 900, color: BRAND, textTransform: "uppercase" }}>{task.mainClient}</div>
          <div style={{ fontSize: fsSmall, fontWeight: 800, color: MUTED, textTransform: "uppercase", marginTop: 12, marginBottom: 4 }}>
            Expedidor
          </div>
          <div style={{ fontWeight: 700, color: TEXT, textTransform: "uppercase" }}>{task.subClient}</div>
        </div>
        <div
          style={{
            flex: 1,
            backgroundColor: CELL_BG,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            padding: 16,
          }}
        >
          <div style={{ fontSize: fsSmall, fontWeight: 800, color: MUTED, textTransform: "uppercase", marginBottom: 4 }}>
            Número de recepción (RA)
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: BRAND, textTransform: "uppercase" }}>RA-{task.ra}</div>
          <div style={{ display: "flex", flexDirection: "row", gap: 16, marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: fsSmall, fontWeight: 800, color: MUTED, textTransform: "uppercase", marginBottom: 4 }}>
                Proveedor
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: TEXT, textTransform: "uppercase" }}>{task.provider}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: fsSmall, fontWeight: 800, color: MUTED, textTransform: "uppercase", marginBottom: 4 }}>
                Marca / tracking
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: TEXT, textTransform: "uppercase" }}>{task.brand}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Resumen */}
      <div style={{ fontSize: fsSmall, fontWeight: 900, color: BRAND, textTransform: "uppercase", marginBottom: 8 }}>
        Resumen físico consolidado
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          overflow: "hidden",
          marginBottom: 16,
        }}
      >
        <div style={{ flex: 1, padding: 12, textAlign: "center", borderRight: `1px solid ${BORDER}`, backgroundColor: "#ffffff" }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: MUTED, textTransform: "uppercase" }}>Bultos físicos</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: BRAND }}>{totals.bultos}</div>
        </div>
        {isDetailed && (
          <div style={{ flex: 1, padding: 12, textAlign: "center", borderRight: `1px solid ${BORDER}`, backgroundColor: "#faf5ff" }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: "#7c3aed", textTransform: "uppercase" }}>Total unidades</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#6d28d9" }}>{totals.unidades}</div>
          </div>
        )}
        <div style={{ flex: 1, padding: 12, textAlign: "center", borderRight: `1px solid ${BORDER}`, backgroundColor: CELL_BG }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: MUTED, textTransform: "uppercase" }}>Volumen total (CBM)</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: BRAND }}>
            {totals.cbm} <span style={{ fontSize: 14 }}>m³</span>
          </div>
        </div>
        <div style={{ flex: 1, padding: 12, textAlign: "center", backgroundColor: "#ffffff" }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: MUTED, textTransform: "uppercase" }}>Peso total</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: BRAND }}>
            {totals.weight.toFixed(2)} <span style={{ fontSize: 14 }}>kg</span>
          </div>
        </div>
      </div>

      {/* Tabla dimensiones */}
      <div style={{ fontSize: fsSmall, fontWeight: 900, color: BRAND, textTransform: "uppercase", marginBottom: 8 }}>
        Detalle de dimensiones
      </div>

      {isDetailed ? (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: compact ? 7 : 8,
            marginBottom: 16,
            border: `1px solid ${BORDER}`,
          }}
        >
          <thead>
            <tr style={{ backgroundColor: HEADER_BG, color: "#ffffff" }}>
              {["#", "Ref.", "Desc.", "Bult.", "Und/B", "Tot.U", "P/B", "P.Tot", "L", "W", "H", "CBM/B", "Tot CBM"].map((h) => (
                <th
                  key={h}
                  style={{
                    border: `1px solid ${BORDER}`,
                    padding: "6px 4px",
                    fontWeight: 800,
                    textTransform: "uppercase",
                  }}
                >
                  {h}
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
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center", fontWeight: 700 }}>{idx + 1}</td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4 }}>{String(row.referencia || "-")}</td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4 }}>{String(row.descripcion || "-")}</td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center" }}>{bultos}</td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center" }}>{undPerBulto}</td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center" }}>{totalUnidades}</td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center" }}>{pesoPorBulto.toFixed(2)}</td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center" }}>{pesoTotal.toFixed(2)}</td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center" }}>{l}</td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center" }}>{w}</td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center" }}>{h}</td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center" }}>{cbmPorBulto.toFixed(2)}</td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 4, textAlign: "center", fontWeight: 800, color: ACCENT }}>{cubicajeTotal.toFixed(2)}</td>
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
            marginBottom: 16,
            border: `1px solid ${BORDER}`,
          }}
        >
          <thead>
            <tr style={{ backgroundColor: HEADER_BG, color: "#ffffff" }}>
              <th style={{ border: `1px solid ${BORDER}`, padding: 8, fontWeight: 800 }}>#</th>
              {showReferenceColumn && (
                <th style={{ border: `1px solid ${BORDER}`, padding: 8, fontWeight: 800 }}>Referencia</th>
              )}
              <th style={{ border: `1px solid ${BORDER}`, padding: 8, fontWeight: 800 }}>Bultos</th>
              {showWeightColumn && (
                <th style={{ border: `1px solid ${BORDER}`, padding: 8, fontWeight: 800 }}>Peso (kg)</th>
              )}
              <th style={{ border: `1px solid ${BORDER}`, padding: 8, fontWeight: 800 }}>L</th>
              <th style={{ border: `1px solid ${BORDER}`, padding: 8, fontWeight: 800 }}>W</th>
              <th style={{ border: `1px solid ${BORDER}`, padding: 8, fontWeight: 800 }}>H</th>
              <th style={{ border: `1px solid ${BORDER}`, padding: 8, fontWeight: 800, backgroundColor: ACCENT }}>Total CBM</th>
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
                  <td style={{ border: `1px solid ${BORDER}`, padding: 8, textAlign: "center", fontWeight: 700 }}>{idx + 1}</td>
                  {showReferenceColumn && (
                    <td style={{ border: `1px solid ${BORDER}`, padding: 8 }}>{String(row.referencia || "-")}</td>
                  )}
                  <td style={{ border: `1px solid ${BORDER}`, padding: 8, textAlign: "center", fontWeight: 700 }}>
                    {String(row.bultos ?? "")}
                  </td>
                  {showWeightColumn && (
                    <td style={{ border: `1px solid ${BORDER}`, padding: 8, textAlign: "center" }}>
                      {row.weight != null ? String(row.weight) : "-"}
                    </td>
                  )}
                  <td style={{ border: `1px solid ${BORDER}`, padding: 8, textAlign: "center", color: MUTED }}>
                    {String(row.l ?? 0)}
                  </td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 8, textAlign: "center", color: MUTED }}>
                    {String(row.w ?? 0)}
                  </td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 8, textAlign: "center", color: MUTED }}>
                    {String(row.h ?? 0)}
                  </td>
                  <td style={{ border: `1px solid ${BORDER}`, padding: 8, textAlign: "center", fontWeight: 800, color: ACCENT }}>{rowCbm.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {task.notes ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: fsSmall, fontWeight: 900, color: BRAND, textTransform: "uppercase", marginBottom: 8 }}>
            Observaciones
          </div>
          <div
            style={{
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: 12,
              fontSize: fsSmall,
              color: TEXT,
              backgroundColor: "#ffffff",
              textTransform: "uppercase",
            }}
          >
            {task.notes}
          </div>
        </div>
      ) : null}

      <div
        style={{
          marginTop: 16,
          paddingTop: 12,
          borderTop: `1px solid ${BORDER}`,
          textAlign: "center",
          fontSize: 8,
          fontWeight: 700,
          color: MUTED,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
        }}
      >
        Aldepositos · documento generado por Warehouse OS
      </div>
    </div>
  );
}
