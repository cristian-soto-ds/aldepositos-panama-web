"use client";

import React, { useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Minus,
  MoreHorizontal,
  PackageOpen,
  PlusSquare,
  Rows3,
  Truck,
  Undo2,
  X,
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

/** Acciones principales siempre visibles. */
const RECEPTION_PRIMARY_ACTIONS: ReceptionStatusId[] = [
  RECEPTION_STATUS.EN_FILA,
  RECEPTION_STATUS.RAMPA_1,
  RECEPTION_STATUS.RAMPA_2,
  RECEPTION_STATUS.COMPLETADO,
];

/** Acciones especiales que se despliegan con el botón «Más». */
const RECEPTION_SECONDARY_ACTIONS: ReceptionStatusId[] = [
  RECEPTION_STATUS.RAMPA_EXTRA,
  RECEPTION_STATUS.CARRETILLADO,
];

const RECEPTION_ACTION_ICONS: Record<
  ReceptionStatusId,
  React.ComponentType<{ className?: string }>
> = {
  EN_FILA: Rows3,
  RAMPA_1: Truck,
  RAMPA_2: Truck,
  RAMPA_EXTRA: PlusSquare,
  CARRETILLADO: PackageOpen,
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
  rampBusy?: RampOccupancyRampId | null;
  onToggleRampOccupancy?: (rampId: RampOccupancyRampId) => void;
  onSetReceptionStatus: (orderId: string, status: ReceptionStatusId) => void;
  onClearReceptionStatus: (orderId: string) => void;
};

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
    "inline-flex min-h-[2.75rem] w-full flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1 text-center text-[7px] font-black uppercase leading-[1.1] tracking-tight transition-all disabled:opacity-50 sm:text-[8px]";
  return `${base} ${active ? theme.actionActive : theme.actionIdle}`;
}

function receptionShortLabel(status: ReceptionStatusId): string {
  switch (status) {
    case RECEPTION_STATUS.EN_FILA:
      return "Fila";
    case RECEPTION_STATUS.RAMPA_1:
      return "Rampa 1";
    case RECEPTION_STATUS.RAMPA_2:
      return "Rampa 2";
    case RECEPTION_STATUS.RAMPA_EXTRA:
      return "Extra";
    case RECEPTION_STATUS.CARRETILLADO:
      return "Carret.";
    case RECEPTION_STATUS.COMPLETADO:
      return "Listo";
    default:
      return RECEPTION_STATUS_LABELS[status];
  }
}

export function CollectionOrderReceptionistView({
  orders,
  loading,
  busyOrderId,
  standalone = false,
  onBack,
  rampOccupancy = null,
  rampBusy = null,
  onToggleRampOccupancy,
  onSetReceptionStatus,
  onClearReceptionStatus,
}: CollectionOrderReceptionistViewProps) {
  const [activeTab, setActiveTab] = useState<CollectionOrderListTab>("general");
  const [expandedExtras, setExpandedExtras] = useState<Set<string>>(
    () => new Set(),
  );

  const toggleExtras = (orderId: string) => {
    setExpandedExtras((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

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
            ? "Asigná una ubicación a cada orden. «Quitar» la saca del tablero."
            : "Mercancía en bodega. El operador debe asignar un RA a cada orden."}
        </p>
      </header>

      {onToggleRampOccupancy ? (
        <div className="mb-4 shrink-0">
          <RampOccupancyControls
            occupancy={rampOccupancy}
            busyRamp={rampBusy}
            onToggle={onToggleRampOccupancy}
          />
        </div>
      ) : null}

      <CollectionOrderListTabs
        active={activeTab}
        generalCount={generalCount}
        warehouseCount={warehouseCount}
        onChange={setActiveTab}
      />

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
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {displayedOrders.map((o) => {
            const bultosTot = orderDisplayBultos(o);
            const currentStatus = o.receptionStatus;
            const isBusy = busyOrderId === o.id;
            const inWarehouse = activeTab === "warehouse";
            const hasRa = orderHasLinkedRa(o);
            const isExpanded =
              expandedExtras.has(o.id) ||
              (currentStatus != null &&
                RECEPTION_SECONDARY_ACTIONS.includes(currentStatus));

            const renderStatusButton = (status: ReceptionStatusId) => {
              const active = currentStatus === status;
              const Icon = RECEPTION_ACTION_ICONS[status];
              const label = receptionShortLabel(status);
              const rampBadge =
                status === RECEPTION_STATUS.RAMPA_1
                  ? "1"
                  : status === RECEPTION_STATUS.RAMPA_2
                    ? "2"
                    : status === RECEPTION_STATUS.RAMPA_EXTRA
                      ? "+"
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
                      className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-black leading-none ${
                        active ? "bg-white/25 text-white" : "bg-current/15"
                      }`}
                    >
                      {rampBadge}
                    </span>
                  ) : (
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  )}
                  <span>{label}</span>
                </button>
              );
            };

            return (
              <div
                key={o.id}
                className={`relative flex flex-col gap-2 overflow-hidden rounded-xl border py-2 pl-3 pr-2.5 text-left shadow-sm ring-1 ring-slate-900/[0.03] dark:ring-white/[0.04] sm:flex-row sm:items-center sm:gap-3 ${
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
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <p className="truncate text-sm font-black text-[#16263F] dark:text-slate-100 sm:text-[15px]">
                      Orden #{String(o.numero ?? "S/N")}
                    </p>
                    {inWarehouse ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                        ● En bodega
                      </span>
                    ) : currentStatus ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${RECEPTION_COLUMN_THEME[currentStatus].badge}`}
                      >
                        ● {RECEPTION_STATUS_LABELS[currentStatus]}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                    {o.proveedor?.trim() ? (
                      <span className="min-w-0 max-w-full truncate">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          Prov.{" "}
                        </span>
                        <span className="font-semibold text-slate-600 dark:text-slate-300">
                          {o.proveedor}
                        </span>
                      </span>
                    ) : null}
                    <span className="text-slate-300 dark:text-slate-600">·</span>
                    <span className="inline-flex items-baseline gap-1 whitespace-nowrap rounded-md bg-violet-50 px-1.5 py-0.5 dark:bg-violet-950/40">
                      <span className="text-[9px] font-black uppercase tracking-wide text-violet-500 dark:text-violet-300">
                        Bultos
                      </span>
                      <span className="text-sm font-black tabular-nums leading-none text-violet-600 dark:text-violet-200">
                        {bultosTot}
                      </span>
                    </span>
                    {inWarehouse ? (
                      hasRa ? (
                        <span className="rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300">
                          RA: {o.linkedRaNumbers!.join(", ")}
                        </span>
                      ) : (
                        <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
                          Pendiente RA
                        </span>
                      )
                    ) : null}
                  </div>
                </div>

                  <div className="flex w-full shrink-0 flex-col items-stretch gap-1 sm:w-[300px]">
                    {inWarehouse ? (
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {hasRa
                            ? "RA asignado — listo"
                            : "Esperando RA en la orden"}
                        </p>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => onClearReceptionStatus(o.id)}
                          title="Devolver a recepción"
                          className="inline-flex shrink-0 items-center justify-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-wide text-red-600 transition hover:border-red-300 hover:bg-red-100 disabled:opacity-50 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300"
                        >
                          {isBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Undo2 className="h-3.5 w-3.5" aria-hidden />
                          )}
                          <span>Devolver</span>
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-5 gap-1">
                          {RECEPTION_PRIMARY_ACTIONS.map((status) =>
                            renderStatusButton(status),
                          )}
                          <button
                            type="button"
                            onClick={() => toggleExtras(o.id)}
                            aria-expanded={isExpanded}
                            title="Rampa extra y carretillado"
                            className="inline-flex min-h-[2.75rem] w-full flex-col items-center justify-center gap-0.5 rounded-lg border-2 border-slate-200 bg-slate-50 px-0.5 py-1 text-center text-[7px] font-black uppercase leading-[1.1] tracking-tight text-slate-500 transition hover:border-slate-300 hover:bg-slate-100 sm:text-[8px] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          >
                            {isExpanded ? (
                              <Minus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            ) : (
                              <MoreHorizontal
                                className="h-3.5 w-3.5 shrink-0"
                                aria-hidden
                              />
                            )}
                            <span>{isExpanded ? "Menos" : "Más"}</span>
                          </button>
                        </div>

                        {isExpanded ? (
                          <div className="grid grid-cols-2 gap-1">
                            {RECEPTION_SECONDARY_ACTIONS.map((status) =>
                              renderStatusButton(status),
                            )}
                          </div>
                        ) : null}

                        {currentStatus ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => onClearReceptionStatus(o.id)}
                            title="Quitar de fila, rampa y tablero de camiones"
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50/70 px-3 py-1 text-[9px] font-black uppercase tracking-wide text-red-600 transition hover:border-red-300 hover:bg-red-100 hover:text-red-700 active:scale-[0.98] disabled:opacity-50 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
                          >
                            {isBusy ? (
                              <Loader2
                                className="h-3.5 w-3.5 shrink-0 animate-spin"
                                aria-hidden
                              />
                            ) : (
                              <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            )}
                            <span>Quitar del tablero</span>
                          </button>
                        ) : isBusy ? (
                          <div className="flex items-center justify-center py-1">
                            <Loader2
                              className="h-4 w-4 shrink-0 animate-spin text-slate-400"
                              aria-label="Guardando"
                            />
                          </div>
                        ) : null}
                      </>
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
