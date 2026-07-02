"use client";

import React, { useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Rows3,
  Truck,
} from "lucide-react";
import type { CollectionOrder, CollectionOrderLine } from "@/lib/types/collectionOrder";
import {
  RECEPTION_STATUS,
  RECEPTION_STATUS_LABELS,
  RECEPTION_COLUMN_THEME,
  type ReceptionStatusId,
} from "@/lib/receptionLogistics/config";
import {
  countOrdersForCollectionListTab,
  orderHasLinkedRa,
  ordersForCollectionListTab,
  type CollectionOrderListTab,
} from "@/lib/collectionOrderListTabs";
import { CollectionOrderListTabs } from "@/components/control-panel/CollectionOrderListTabs";
import { RampOccupancyControls } from "@/components/reception/RampOccupancyControls";
import type {
  RampOccupancyRampId,
  RampOccupancyState,
} from "@/lib/receptionLogistics/rampOccupancy";

const RECEPTION_ACTIONS: ReceptionStatusId[] = [
  RECEPTION_STATUS.EN_FILA,
  RECEPTION_STATUS.RAMPA_1,
  RECEPTION_STATUS.RAMPA_2,
  RECEPTION_STATUS.COMPLETADO,
];

const RECEPTION_ACTION_ICONS: Record<
  ReceptionStatusId,
  React.ComponentType<{ className?: string }>
> = {
  EN_FILA: Rows3,
  RAMPA_1: Truck,
  RAMPA_2: Truck,
  COMPLETADO: CheckCircle2,
};

type CollectionOrderReceptionistViewProps = {
  orders: CollectionOrder[];
  loading: boolean;
  busyOrderId: string | null;
  /** Módulo propio en el menú (sin botón volver). */
  standalone?: boolean;
  onBack?: () => void;
  rampOccupancy?: RampOccupancyState | null;
  rampOccupancyBusy?: RampOccupancyRampId | null;
  onToggleRampOccupancy?: (rampId: RampOccupancyRampId) => void;
  onSetReceptionStatus: (orderId: string, status: ReceptionStatusId) => void;
  onClearReceptionStatus: (orderId: string) => void;
};

function listReferenciasCount(lines: CollectionOrderLine[]): number {
  return lines.filter((l) => String(l.referencia ?? "").trim().length > 0).length;
}

function listBultosTotal(lines: CollectionOrderLine[]): number {
  let sum = 0;
  for (const l of lines) {
    const n = parseFloat(String(l.bultos ?? "").replace(",", "."));
    if (Number.isFinite(n) && n > 0) sum += Math.round(n);
  }
  return sum;
}

function orderDisplayBultos(order: CollectionOrder): number {
  if (order.expectedBultos != null && order.expectedBultos > 0) {
    return Math.round(order.expectedBultos);
  }
  return listBultosTotal(order.lines);
}

function receptionButtonClass(status: ReceptionStatusId, active: boolean): string {
  const theme = RECEPTION_COLUMN_THEME[status];
  const base =
    "inline-flex min-w-[4.25rem] flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-2 text-[8px] font-black uppercase leading-tight tracking-wide transition-all disabled:opacity-50 sm:min-w-[4.75rem] sm:px-2.5 sm:py-2.5 sm:text-[9px]";
  return `${base} ${active ? theme.actionActive : theme.actionIdle}`;
}

export function CollectionOrderReceptionistView({
  orders,
  loading,
  busyOrderId,
  standalone = false,
  onBack,
  rampOccupancy = null,
  rampOccupancyBusy = null,
  onToggleRampOccupancy,
  onSetReceptionStatus,
  onClearReceptionStatus,
}: CollectionOrderReceptionistViewProps) {
  const [activeTab, setActiveTab] = useState<CollectionOrderListTab>("general");

  const listDominantCliente = useMemo(() => {
    const freq = new Map<string, number>();
    for (const o of orders) {
      const c = String(o.cliente ?? "").trim();
      if (c) freq.set(c, (freq.get(c) ?? 0) + 1);
    }
    let best = "";
    let bestN = 0;
    for (const [c, n] of freq) {
      if (n > bestN) {
        best = c;
        bestN = n;
      }
    }
    return best;
  }, [orders]);

  const generalCount = countOrdersForCollectionListTab(orders, "general");
  const warehouseCount = countOrdersForCollectionListTab(orders, "warehouse");
  const displayedOrders = useMemo(
    () => ordersForCollectionListTab(orders, activeTab),
    [orders, activeTab],
  );

  return (
    <div className="flex h-full min-h-0 w-full max-w-5xl mx-auto flex-1 flex-col px-2 py-4 md:px-0 md:py-6">
      {!standalone && onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex w-fit items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Volver a órdenes
        </button>
      ) : null}

      <header className="mb-4 shrink-0 rounded-2xl border border-indigo-200/70 bg-gradient-to-r from-[#1e2a5a] via-[#24356d] to-[#1e4f86] p-4 text-white shadow-lg md:p-5">
        <div className="flex items-center gap-2 text-indigo-100">
          <ClipboardList className="h-5 w-5" aria-hidden />
          <span className="text-[10px] font-black uppercase tracking-[0.2em]">
            {standalone ? "Recepcionista" : "Recepción"}
          </span>
        </div>
        <h2 className="mt-1 text-lg font-black md:text-xl">
          {standalone ? "Recepcionista" : "Vista recepcionista"}
        </h2>
        <p className="mt-1 text-sm font-medium text-indigo-100/90">
          {activeTab === "general"
            ? "Órdenes en fila o rampa. Asigná estado de recepción."
            : "Mercancía en bodega. El operador debe asignar un RA a cada orden."}
        </p>
        {activeTab === "general" ? (
          <div className="mt-4 flex flex-wrap gap-2">
          {RECEPTION_ACTIONS.map((status) => {
            const theme = RECEPTION_COLUMN_THEME[status];
            const Icon = RECEPTION_ACTION_ICONS[status];
            return (
              <span
                key={status}
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${theme.badge}`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {RECEPTION_STATUS_LABELS[status]}
              </span>
            );
          })}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-red-700">
            Quitar = sacar del tablero
          </span>
        </div>
        ) : null}
      </header>

      <CollectionOrderListTabs
        active={activeTab}
        generalCount={generalCount}
        warehouseCount={warehouseCount}
        onChange={setActiveTab}
      />

      {standalone && activeTab === "general" && onToggleRampOccupancy ? (
        <div className="mb-3 shrink-0">
          <RampOccupancyControls
            occupancy={rampOccupancy}
            busyRamp={rampOccupancyBusy}
            onToggle={onToggleRampOccupancy}
            compact
          />
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm font-bold text-slate-500">Cargando…</p>
      ) : orders.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
          <p className="font-bold text-slate-500 dark:text-slate-400">
            No hay órdenes de recolección.
          </p>
        </div>
      ) : displayedOrders.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
          <p className="font-bold text-slate-500 dark:text-slate-400">
            {activeTab === "general"
              ? "No hay órdenes en recepción."
              : "No hay órdenes en bodega pendientes de RA."}
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {displayedOrders.map((o) => {
            const refCount = listReferenciasCount(o.lines);
            const bultosTot = orderDisplayBultos(o);
            const refWord = refCount === 1 ? "referencia" : "referencias";
            const clienteLabel =
              String(o.cliente ?? "").trim() || listDominantCliente;
            const currentStatus = o.receptionStatus;
            const isBusy = busyOrderId === o.id;
            const inWarehouse = activeTab === "warehouse";
            const hasRa = orderHasLinkedRa(o);

            return (
              <div
                key={o.id}
                className={`relative flex flex-col gap-3 overflow-hidden rounded-2xl border p-3.5 pl-3 text-left shadow-sm ring-1 ring-slate-900/[0.03] dark:ring-white/[0.04] sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${
                  currentStatus
                    ? RECEPTION_COLUMN_THEME[currentStatus].card
                    : "border-slate-200/90 bg-white dark:border-slate-600/80 dark:bg-slate-900"
                }`}
              >
                <span
                  className={`pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b ${
                    currentStatus
                      ? RECEPTION_COLUMN_THEME[currentStatus].stripe
                      : "from-indigo-500 to-sky-500"
                  }`}
                />

                <div className="min-w-0 flex-1 pl-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="truncate text-sm font-black text-[#16263F] dark:text-slate-100">
                      Orden #{String(o.numero ?? "S/N")}
                    </p>
                    {inWarehouse ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-700 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                        ● En bodega
                      </span>
                    ) : currentStatus ? (
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide shadow-sm ${RECEPTION_COLUMN_THEME[currentStatus].badge}`}
                      >
                        ● {RECEPTION_STATUS_LABELS[currentStatus]}
                      </span>
                    ) : (
                      <span className="rounded-full border border-dashed border-slate-300 bg-slate-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                        Sin asignar
                      </span>
                    )}
                  </div>
                  {o.proveedor?.trim() && (
                    <p className="mt-1 truncate text-xs font-medium text-slate-500 dark:text-slate-400">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        Proveedor{" "}
                      </span>
                      <span className="text-slate-600 dark:text-slate-300">
                        {o.proveedor}
                      </span>
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-baseline gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 shadow-sm dark:border-slate-600 dark:bg-slate-800/90">
                      <span className="text-base font-black tabular-nums leading-none text-[#16263F] dark:text-slate-100">
                        {refCount}
                      </span>
                      <span className="text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {refWord}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 shadow-sm dark:border-violet-500/35 dark:bg-violet-950/45">
                      <span className="text-[10px] font-black uppercase tracking-wide text-violet-600 dark:text-violet-300">
                        Bultos
                      </span>
                      <span className="text-xl font-black tabular-nums leading-none text-violet-600 dark:text-violet-200">
                        {bultosTot}
                      </span>
                    </span>
                    {inWarehouse ? (
                      hasRa ? (
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300">
                          RA: {o.linkedRaNumbers!.join(", ")}
                        </span>
                      ) : (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
                          Pendiente RA
                        </span>
                      )
                    ) : null}
                  </div>
                </div>

                  <div className="flex w-full shrink-0 flex-col items-stretch gap-2 sm:w-auto sm:min-w-[280px]">
                    {clienteLabel ? (
                      <span
                        className="truncate text-right text-xs font-semibold text-[#16263F] dark:text-slate-100 sm:text-sm"
                        title={`Cliente: ${clienteLabel}`}
                      >
                        {clienteLabel}
                      </span>
                    ) : null}
                    {inWarehouse ? (
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <p className="text-right text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {hasRa
                            ? "RA asignado — listo para inventario"
                            : "Esperando asignación de RA en orden de recolección"}
                        </p>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onClearReceptionStatus(o.id)}
                          title="Devolver a recepción"
                          className="inline-flex min-w-[4.25rem] flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-red-300 bg-red-50 px-2 py-2 text-[8px] font-black uppercase leading-tight tracking-wide text-red-700 transition hover:border-red-400 hover:bg-red-100 disabled:opacity-50 sm:min-w-[4.75rem] sm:px-2.5 sm:py-2.5 sm:text-[9px]"
                        >
                          <span className="text-base leading-none" aria-hidden>
                            ↩
                          </span>
                          <span>Devolver</span>
                        </button>
                        {isBusy ? (
                          <Loader2
                            className="h-4 w-4 shrink-0 animate-spin text-slate-400"
                            aria-label="Guardando"
                          />
                        ) : null}
                      </div>
                    ) : (
                    <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
                    {RECEPTION_ACTIONS.map((status) => {
                      const active = currentStatus === status;
                      const Icon = RECEPTION_ACTION_ICONS[status];
                      const label =
                        status === RECEPTION_STATUS.RAMPA_1
                          ? "Rampa 1"
                          : status === RECEPTION_STATUS.RAMPA_2
                            ? "Rampa 2"
                            : RECEPTION_STATUS_LABELS[status];
                      const rampBadge =
                        status === RECEPTION_STATUS.RAMPA_1
                          ? "1"
                          : status === RECEPTION_STATUS.RAMPA_2
                            ? "2"
                            : null;
                      return (
                        <button
                          key={status}
                          type="button"
                          disabled={isBusy}
                          onClick={() => onSetReceptionStatus(o.id, status)}
                          className={receptionButtonClass(status, active)}
                          aria-pressed={active}
                          title={RECEPTION_STATUS_LABELS[status]}
                        >
                          {rampBadge ? (
                            <span
                              className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-black leading-none ${
                                active ? "bg-white/25 text-white" : "bg-current/15"
                              }`}
                            >
                              {rampBadge}
                            </span>
                          ) : (
                            <Icon className="h-4 w-4 shrink-0" aria-hidden />
                          )}
                          <span>{label}</span>
                        </button>
                      );
                    })}
                    {currentStatus ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => onClearReceptionStatus(o.id)}
                        title="Quitar de fila, rampa y tablero de camiones"
                        className="inline-flex min-w-[4.25rem] flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-red-300 bg-red-50 px-2 py-2 text-[8px] font-black uppercase leading-tight tracking-wide text-red-700 transition hover:border-red-400 hover:bg-red-100 disabled:opacity-50 sm:min-w-[4.75rem] sm:px-2.5 sm:py-2.5 sm:text-[9px]"
                      >
                        <span className="text-base leading-none" aria-hidden>
                          ✕
                        </span>
                        <span>Quitar</span>
                      </button>
                    ) : null}
                    {isBusy ? (
                      <Loader2
                        className="h-4 w-4 shrink-0 animate-spin text-slate-400"
                        aria-label="Guardando"
                      />
                    ) : null}
                  </div>
                    )}
                  </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
