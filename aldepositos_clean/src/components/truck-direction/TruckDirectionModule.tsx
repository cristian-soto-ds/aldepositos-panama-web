"use client";

/**
 * Módulo Operador — Recepción de camiones
 * Tablero Kanban, carga de órdenes, buscador y Recibo de Almacén.
 * Personalización: src/lib/receptionLogistics/config.ts
 */

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  GripVertical,
  Loader2,
  Monitor,
  Truck,
  FileSpreadsheet,
} from "lucide-react";
import { useReceptionQueue } from "@/hooks/useReceptionQueue";
import {
  RECEPTION_COPY,
  RECEPTION_KANBAN_COLUMNS,
  RECEPTION_OPTIONAL_STATUS,
  RECEPTION_RECEIPT_ON_STATUS,
  RECEPTION_COLUMN_THEME,
  RECEPTION_STATUS,
  RECEPTION_STATUS_LABELS,
  type ReceptionStatusId,
} from "@/lib/receptionLogistics/config";
import type { ReceptionTruck } from "@/lib/receptionLogistics/types";
import { updateReceptionTruckStatus } from "@/lib/receptionLogistics/repository";
import {
  DailyReceptionReportError,
  generateAndDownloadDailyReceptionReport,
} from "@/lib/receptionLogistics/generateDailyReceptionReport";
import { ReceptionReportExportModal } from "@/components/modals/ReceptionReportExportModal";
import type { ReceptionReportFilter } from "@/lib/receptionLogistics/receptionReportFilter";
import { printWarehouseReceipt } from "@/lib/receptionLogistics/warehouseReceipt";
import { TruckDirectionTvModule } from "@/components/truck-direction/TruckDirectionTvModule";
import { ReceptionKanbanCardContent } from "@/components/truck-direction/ReceptionKanbanCardContent";
import type { ReceptionCardDensity } from "@/components/truck-direction/ReceptionKanbanCardContent";
import { useRampOccupancy } from "@/hooks/useRampOccupancy";
import { RampOccupancyTvCard } from "@/components/reception/RampOccupancyControls";
import {
  isRampOccupancyRampId,
  RAMP_OCCUPANCY_COPY,
} from "@/lib/receptionLogistics/rampOccupancy";

function queueDensity(count: number): ReceptionCardDensity {
  if (count >= 6) return "dense";
  if (count >= 3) return "compact";
  return "normal";
}

export function TruckDirectionModule() {
  const { trucks, loading, reload } = useReceptionQueue();
  const { occupancy: rampOccupancy } = useRampOccupancy();
  const [reportBusy, setReportBusy] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [moveBusy, setMoveBusy] = useState<string | null>(null);
  const [tvModeOpen, setTvModeOpen] = useState(false);
  const dragTruckId = useRef<string | null>(null);

  const filtered = trucks;

  const byStatus = useMemo(() => {
    const map: Record<ReceptionStatusId, ReceptionTruck[]> = {
      EN_FILA: [],
      RAMPA_1: [],
      RAMPA_2: [],
      RAMPA_EXTRA: [],
      CARRETILLADO: [],
      COMPLETADO: [],
    };
    for (const col of RECEPTION_KANBAN_COLUMNS) {
      map[col] = filtered
        .filter((t) => t.status === col)
        .sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  }, [filtered]);

  const visibleColumns = useMemo(
    () =>
      RECEPTION_KANBAN_COLUMNS.filter(
        (col) =>
          !RECEPTION_OPTIONAL_STATUS.includes(col) ||
          (byStatus[col]?.length ?? 0) > 0,
      ),
    [byStatus],
  );

  const onGenerateReport = useCallback(
    async (filter: ReceptionReportFilter) => {
      setReportBusy(true);
      try {
        const result = await generateAndDownloadDailyReceptionReport(trucks, {
          filter,
        });
        const geminiNote = result.withGemini
          ? " Incluye hoja de resumen con Alde.IA."
          : "";
        alert(
          `Reporte generado: ${result.rowCount} OR del período seleccionado.${geminiNote}`,
        );
        setReportModalOpen(false);
      } catch (e) {
        if (e instanceof DailyReceptionReportError && e.code === "NO_ROWS") {
          alert(e.message);
          return;
        }
        console.error(e);
        alert("No se pudo generar el reporte. Intentá de nuevo.");
      } finally {
        setReportBusy(false);
      }
    },
    [trucks],
  );

  const handleDropOnColumn = useCallback(
    async (status: ReceptionStatusId) => {
      const id = dragTruckId.current;
      dragTruckId.current = null;
      if (!id) return;

      const truck = trucks.find((t) => t.id === id);
      if (!truck || truck.status === status) return;

      const needsReceipt = RECEPTION_RECEIPT_ON_STATUS.includes(status);
      setMoveBusy(id);
      try {
        const updated = await updateReceptionTruckStatus(id, status, {
          issueReceipt: needsReceipt,
        });
        await reload();
        if (updated?.warehouseReceiptNumber && needsReceipt) {
          printWarehouseReceipt(updated);
        }
      } finally {
        setMoveBusy(null);
      }
    },
    [trucks, reload],
  );

  return (
    <>
      {tvModeOpen ? (
        <div className="fixed inset-0 z-[500]">
          <TruckDirectionTvModule
            onClose={() => setTvModeOpen(false)}
            trucks={trucks}
            loading={loading}
          />
        </div>
      ) : null}

      <div className="flex h-full min-h-0 flex-col gap-4 p-3 sm:p-4 md:p-6">
      <header className="shrink-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-black text-[#16263F] dark:text-slate-100 md:text-2xl">
              <Truck className="h-6 w-6 text-amber-600" aria-hidden />
              {RECEPTION_COPY.operatorTitle}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setTvModeOpen(true)}
              className="inline-flex items-center justify-center gap-2 border border-neutral-600 bg-white px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-neutral-800 transition hover:bg-neutral-50"
            >
              <Monitor className="h-4 w-4" />
              Modo TV
            </button>
            <button
              type="button"
              onClick={() => setReportModalOpen(true)}
              disabled={reportBusy}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#16263F] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-md transition hover:brightness-110 disabled:opacity-60"
            >
              {reportBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              {RECEPTION_COPY.reportLabel}
            </button>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-slate-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Cargando tablero…
        </div>
      ) : (
        <div
          className={`grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto pb-4 sm:grid-cols-2 xl:overflow-hidden ${
            visibleColumns.length >= 6
              ? "xl:grid-cols-6"
              : visibleColumns.length === 5
                ? "xl:grid-cols-5"
                : "xl:grid-cols-4"
          }`}
        >
          {visibleColumns.map((statusId) => {
            const theme = RECEPTION_COLUMN_THEME[statusId];
            const list = byStatus[statusId] ?? [];
            const isQueueColumn = statusId === RECEPTION_STATUS.EN_FILA;
            const isRampColumn = isRampOccupancyRampId(statusId);
            const rampRetiroOccupied =
              isRampColumn && rampOccupancy?.[statusId]?.occupied === true;
            const density = isQueueColumn ? queueDensity(list.length) : "normal";
            const isDenseQueue = density === "dense";
            return (
              <section
                key={statusId}
                className="flex min-h-[200px] min-w-0 flex-col rounded-2xl border border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/50 xl:min-h-0 xl:overflow-hidden"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  void handleDropOnColumn(statusId);
                }}
              >
                <div
                  className={`shrink-0 rounded-t-2xl border-b px-3 py-2.5 text-center text-xs font-black uppercase tracking-widest ${theme.header}`}
                >
                  {RECEPTION_STATUS_LABELS[statusId]}
                  <span className="ml-2 opacity-80">({list.length})</span>
                  {rampRetiroOccupied ? (
                    <p className="mt-1 text-[9px] font-bold normal-case tracking-wide text-white/90">
                      {RAMP_OCCUPANCY_COPY.operatorBadge}
                    </p>
                  ) : null}
                </div>

                <ul
                  className={`custom-scrollbar flex flex-1 flex-col overflow-y-auto p-2 ${
                    isDenseQueue ? "gap-1" : density === "compact" ? "gap-1.5" : "gap-2"
                  }`}
                >
                  {list.length === 0 ? (
                    rampRetiroOccupied && isRampColumn ? (
                      <RampOccupancyTvCard
                        rampId={statusId}
                        stripeClass={theme.stripe}
                      />
                    ) : (
                    <li className="py-8 text-center text-xs text-slate-400">
                      {RECEPTION_COPY.emptyColumn}
                    </li>
                    )
                  ) : (
                    <>
                      {rampRetiroOccupied && isRampColumn ? (
                        <li>
                          <RampOccupancyTvCard
                            rampId={statusId}
                            stripeClass={theme.stripe}
                          />
                        </li>
                      ) : null}
                      {list.map((truck, index) => (
                      <li
                        key={truck.id}
                        draggable={moveBusy !== truck.id}
                        onDragStart={() => {
                          dragTruckId.current = truck.id;
                        }}
                        onDragEnd={() => {
                          dragTruckId.current = null;
                        }}
                        className={`cursor-grab border active:cursor-grabbing ${theme.card} ${
                          isDenseQueue
                            ? "rounded-lg px-2 py-1.5 shadow-none ring-0"
                            : density === "compact"
                              ? "rounded-xl p-2 shadow-sm"
                              : "rounded-xl p-3.5 shadow-sm"
                        } ${moveBusy === truck.id ? "opacity-60" : ""}`}
                      >
                        <div
                          className={`flex items-center gap-1.5 ${isDenseQueue ? "" : "items-start gap-2"}`}
                        >
                          <GripVertical
                            className={`shrink-0 text-slate-300 ${
                              isDenseQueue ? "h-3.5 w-3.5" : "mt-1 h-4 w-4"
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <ReceptionKanbanCardContent
                              truck={truck}
                              bultosBadgeClassName={theme.badge}
                              queuePosition={isQueueColumn ? index + 1 : undefined}
                              density={density}
                            />
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1 border-t border-slate-100 pt-2 dark:border-slate-700 sm:hidden">
                          {RECEPTION_KANBAN_COLUMNS.filter((s) => s !== truck.status).map(
                            (target) => (
                              <button
                                key={target}
                                type="button"
                                className="rounded-lg border border-slate-200 px-2 py-1 text-[9px] font-bold uppercase"
                                onClick={() => {
                                  dragTruckId.current = truck.id;
                                  void handleDropOnColumn(target);
                                }}
                              >
                                → {RECEPTION_STATUS_LABELS[target]}
                              </button>
                            ),
                          )}
                        </div>
                      </li>
                    ))}
                    </>
                  )}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <p className="shrink-0 text-center text-[10px] text-slate-400">
        <FileSpreadsheet className="mr-1 inline h-3 w-3" />
        Arrastra tarjetas entre columnas · Recibo automático al asignar rampa
        {" · "}
        <button
          type="button"
          onClick={() => setTvModeOpen(true)}
          className="inline-flex items-center gap-0.5 font-semibold text-neutral-700 underline-offset-2 hover:underline"
        >
          <Monitor className="h-3 w-3" />
          Abrir pantalla TV
        </button>
      </p>
    </div>

      <ReceptionReportExportModal
        open={reportModalOpen}
        trucks={trucks}
        busy={reportBusy}
        onCancel={() => {
          if (!reportBusy) setReportModalOpen(false);
        }}
        onConfirm={(filter) => void onGenerateReport(filter)}
      />
    </>
  );
}
