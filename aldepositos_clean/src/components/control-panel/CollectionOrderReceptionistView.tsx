"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Loader2,
  Minus,
  MoreHorizontal,
  PackageCheck,
  PackageMinus,
  PackageOpen,
  PlusSquare,
  Rows3,
  Search,
  Truck,
  Undo2,
  UserCheck,
  X,
  Zap,
} from "lucide-react";
import type { CollectionOrder } from "@/lib/types/collectionOrder";
import { parseCollectionOrderNumber } from "@/lib/collectionOrders";
import {
  compareReceptionQueue,
  RECEPTION_PRIORITY_THEME,
  RECEPTION_STATUS,
  RECEPTION_STATUS_LABELS,
  RECEPTION_COLUMN_THEME,
  type ReceptionStatusId,
} from "@/lib/receptionLogistics/config";
import {
  orderBultos,
  orderHasOpenPartialDelivery,
  orderPendingBultos,
  orderReceivedBultos,
} from "@/lib/receptionLogistics/syncCollectionOrderReception";
import {
  countOrdersForCollectionListTab,
  orderHasLinkedRa,
  ordersForCollectionListTab,
  type CollectionOrderListTab,
} from "@/lib/collectionOrderListTabs";
import { CollectionOrderListTabs } from "@/components/control-panel/CollectionOrderListTabs";
import { CollectionOrderListSearch } from "@/components/control-panel/CollectionOrderListSearch";
import { filterCollectionOrdersBySearch } from "@/lib/collectionOrderListSearch";
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
  PARCIAL: PackageMinus,
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
  /** Agrupar ≥2 OR en un solo camión (En fila). */
  onCreateTruckGroup?: (input: {
    orderIds: string[];
  }) => Promise<void>;
  /** Sumar OR olvidadas a un camión ya unificado. */
  onAddOrdersToTruckGroup?: (input: {
    groupId: string;
    orderIds: string[];
  }) => Promise<void>;
  /** Activa / quita la prioridad del camión (primero en la fila). */
  onTogglePriority?: (orderId: string) => void;
  /** Entrega incompleta: registra cuántos bultos llegaron. */
  onMarkPartialDelivery?: (orderId: string, arrivedBultos: number) => Promise<void>;
  /** Llegó el resto de una entrega parcial: vuelve a la fila. */
  onResumePartialDelivery?: (orderId: string) => void;
};

function canSelectForTruckGroup(order: CollectionOrder): boolean {
  if (order.receptionGroupId) return false;
  if (!order.receptionStatus) return true;
  return order.receptionStatus === RECEPTION_STATUS.EN_FILA;
}

const orderDisplayBultos = orderBultos;

type ActionTone = {
  /** Hover del botón inactivo (borde / fondo / texto del color del estado). */
  idle: string;
  /** Botón activo: relleno sólido del color del estado. */
  active: string;
  /** Ícono en reposo. */
  icon: string;
  /** Círculo con el número de rampa en reposo. */
  badge: string;
};

const RECEPTION_ACTION_TONE: Record<ReceptionStatusId, ActionTone> = {
  EN_FILA: {
    idle: "hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800",
    active:
      "border-slate-700 bg-gradient-to-b from-slate-600 to-slate-800 text-white shadow-md shadow-slate-700/30",
    icon: "text-slate-500 dark:text-slate-400",
    badge: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  },
  RAMPA_1: {
    idle: "hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 dark:hover:bg-amber-950/40 dark:hover:text-amber-200",
    active:
      "border-amber-500 bg-gradient-to-b from-amber-400 to-amber-500 text-white shadow-md shadow-amber-500/35",
    icon: "text-amber-500",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200",
  },
  RAMPA_2: {
    idle: "hover:border-orange-300 hover:bg-orange-50 hover:text-orange-800 dark:hover:bg-orange-950/40 dark:hover:text-orange-200",
    active:
      "border-orange-500 bg-gradient-to-b from-orange-400 to-orange-600 text-white shadow-md shadow-orange-500/35",
    icon: "text-orange-500",
    badge: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-200",
  },
  RAMPA_EXTRA: {
    idle: "hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 dark:hover:bg-sky-950/40 dark:hover:text-sky-200",
    active:
      "border-sky-500 bg-gradient-to-b from-sky-400 to-sky-600 text-white shadow-md shadow-sky-500/35",
    icon: "text-sky-500",
    badge: "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200",
  },
  CARRETILLADO: {
    idle: "hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-200",
    active:
      "border-violet-500 bg-gradient-to-b from-violet-500 to-violet-600 text-white shadow-md shadow-violet-500/35",
    icon: "text-violet-500",
    badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-200",
  },
  PARCIAL: {
    idle: "hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-800 dark:hover:bg-cyan-950/40 dark:hover:text-cyan-200",
    active:
      "border-cyan-600 bg-gradient-to-b from-cyan-600 to-cyan-700 text-white shadow-md shadow-cyan-600/35",
    icon: "text-cyan-600",
    badge: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-200",
  },
  COMPLETADO: {
    idle: "hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-200",
    active:
      "border-emerald-600 bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-md shadow-emerald-500/35",
    icon: "text-emerald-500",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200",
  },
};

const actionButtonBase =
  "inline-flex w-full items-center justify-center rounded-lg border text-center font-bold uppercase leading-none tracking-wide transition-all duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40";

const actionButtonIdle =
  "border-slate-200 bg-white text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";

/** Botón de estado: alto y apilado (fila principal) o bajo y en línea (extras). */
function receptionButtonClass(
  status: ReceptionStatusId,
  active: boolean,
  compact = false,
): string {
  const tone = RECEPTION_ACTION_TONE[status];
  const shape = compact
    ? "h-9 flex-row gap-1.5 px-2 text-[9px] sm:text-[10px]"
    : "h-11 flex-col gap-1 px-0.5 text-[8px] sm:h-12 sm:text-[9px]";
  return `${actionButtonBase} ${shape} ${active ? tone.active : `${actionButtonIdle} ${tone.idle}`}`;
}

const receptionExtraButtonBase = `${actionButtonBase} h-9 flex-row gap-1.5 px-2 text-[9px] sm:text-[10px]`;

const priorityButtonIdle = `${actionButtonIdle} hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-300`;
const priorityButtonActive =
  "border-red-600 bg-gradient-to-b from-red-500 to-rose-600 text-white shadow-md shadow-red-500/35";
const partialButtonIdle = `${actionButtonIdle} ${RECEPTION_ACTION_TONE.PARCIAL.idle}`;
const partialButtonActive = RECEPTION_ACTION_TONE.PARCIAL.active;

const secondaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800";

const primaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-3.5 py-2 text-[11px] font-semibold text-white shadow-md shadow-indigo-500/30 transition hover:from-indigo-700 hover:to-violet-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none";

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
    case RECEPTION_STATUS.PARCIAL:
      return "Parcial";
    case RECEPTION_STATUS.COMPLETADO:
      return "Listo";
    default:
      return RECEPTION_STATUS_LABELS[status];
  }
}

/**
 * Prioridad en lista recepcionista (menor = más arriba):
 * Rampa 1 → Rampa 2 → Extra → Carretillado → Fila → Parcial → sin estado.
 */
const RECEPTIONIST_NO_STATUS_RANK = 6;

function receptionistStatusPriority(
  status: ReceptionStatusId | undefined,
): number {
  switch (status) {
    case RECEPTION_STATUS.RAMPA_1:
      return 0;
    case RECEPTION_STATUS.RAMPA_2:
      return 1;
    case RECEPTION_STATUS.RAMPA_EXTRA:
      return 2;
    case RECEPTION_STATUS.CARRETILLADO:
      return 3;
    case RECEPTION_STATUS.EN_FILA:
      return 4;
    case RECEPTION_STATUS.PARCIAL:
      return 5;
    default:
      return RECEPTIONIST_NO_STATUS_RANK;
  }
}

function receptionQueueTimeMs(order: CollectionOrder): number {
  const queued = Date.parse(order.receptionQueuedAt || "");
  if (Number.isFinite(queued) && queued > 0) return queued;
  const updated = Date.parse(order.updatedAt || "");
  if (Number.isFinite(updated) && updated > 0) return updated;
  const created = Date.parse(order.createdAt || "");
  return Number.isFinite(created) ? created : 0;
}

/** Ordena para recepción: rampas por prioridad; en fila FIFO; sin estado al final. */
function sortOrdersForReceptionistList(
  orders: CollectionOrder[],
): CollectionOrder[] {
  return [...orders].sort((a, b) => {
    const pa = receptionistStatusPriority(a.receptionStatus);
    const pb = receptionistStatusPriority(b.receptionStatus);
    if (pa !== pb) return pa - pb;

    // Mismo estado: prioritarios arriba; luego el que llegó antes (FIFO).
    if (pa < RECEPTIONIST_NO_STATUS_RANK) {
      const ta = receptionQueueTimeMs(a);
      const tb = receptionQueueTimeMs(b);
      const byQueue = compareReceptionQueue(
        { priority: a.receptionPriority, priorityAt: a.receptionPriorityAt, sortOrder: ta },
        { priority: b.receptionPriority, priorityAt: b.receptionPriorityAt, sortOrder: tb },
      );
      if (byQueue !== 0) return byQueue;

      // Mismo camión: mantener OR juntas.
      const ga = a.receptionGroupId || "";
      const gb = b.receptionGroupId || "";
      if (ga && gb && ga === gb) {
        const na = parseCollectionOrderNumber(a.numero);
        const nb = parseCollectionOrderNumber(b.numero);
        if (na !== nb) return na - nb;
        return String(a.id).localeCompare(String(b.id));
      }
      if (ga !== gb) return ga.localeCompare(gb);
    }

    const na = parseCollectionOrderNumber(a.numero);
    const nb = parseCollectionOrderNumber(b.numero);
    if (na !== nb) return nb - na;
    return String(b.id).localeCompare(String(a.id));
  });
}

function formatShortTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("es-PA", {
    timeZone: "America/Panama",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/** Posición en fila por camión (las OR de un mismo camión comparten número). */
function buildQueuePositions(sorted: CollectionOrder[]): Map<string, number> {
  const positions = new Map<string, number>();
  const byGroup = new Map<string, number>();
  let next = 0;
  for (const o of sorted) {
    if (o.receptionStatus !== RECEPTION_STATUS.EN_FILA) continue;
    const gid = o.receptionGroupId?.trim();
    if (gid && byGroup.has(gid)) {
      positions.set(o.id, byGroup.get(gid)!);
      continue;
    }
    next += 1;
    positions.set(o.id, next);
    if (gid) byGroup.set(gid, next);
  }
  return positions;
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
  onCreateTruckGroup,
  onAddOrdersToTruckGroup,
  onTogglePriority,
  onMarkPartialDelivery,
  onResumePartialDelivery,
}: CollectionOrderReceptionistViewProps) {
  const [activeTab, setActiveTab] = useState<CollectionOrderListTab>("general");
  const [search, setSearch] = useState("");
  const [partialOrderId, setPartialOrderId] = useState<string | null>(null);
  const [partialInput, setPartialInput] = useState("");
  const [partialBusy, setPartialBusy] = useState(false);
  const partialOrder = partialOrderId
    ? (orders.find((o) => o.id === partialOrderId) ?? null)
    : null;
  const partialPending = partialOrder ? orderPendingBultos(partialOrder) : 0;
  const partialArrived = Math.round(Number(partialInput) || 0);
  const partialValid = partialArrived > 0 && partialArrived <= partialPending;

  const openPartialModal = (orderId: string) => {
    setPartialOrderId(orderId);
    setPartialInput("");
  };

  const submitPartial = async () => {
    if (!onMarkPartialDelivery || !partialOrder || !partialValid) return;
    setPartialBusy(true);
    try {
      await onMarkPartialDelivery(partialOrder.id, partialArrived);
      setPartialOrderId(null);
      setPartialInput("");
    } catch {
      /* alert en el módulo */
    } finally {
      setPartialBusy(false);
    }
  };
  /**
   * Abierto/cerrado elegido a mano por OR. Sin elección, Extra y Carretillado
   * arrancan abiertos (su botón está en el panel desplegable).
   */
  const [extrasOpenById, setExtrasOpenById] = useState<Record<string, boolean>>(
    {},
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [targetGroupId, setTargetGroupId] = useState<string | null>(null);
  const [unifyMode, setUnifyMode] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);

  const isExtrasOpen = (order: CollectionOrder): boolean => {
    const chosen = extrasOpenById[order.id];
    if (chosen !== undefined) return chosen;
    return (
      order.receptionStatus != null &&
      RECEPTION_SECONDARY_ACTIONS.includes(order.receptionStatus)
    );
  };

  const toggleExtras = (order: CollectionOrder) => {
    const open = isExtrasOpen(order);
    setExtrasOpenById((prev) => ({ ...prev, [order.id]: !open }));
  };

  const toggleSelected = (orderId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const selectTargetGroup = (groupId: string) => {
    setTargetGroupId((prev) => (prev === groupId ? null : groupId));
  };

  const setUnifyModeOn = (on: boolean) => {
    setUnifyMode(on);
    if (!on) {
      setSelectedIds(new Set());
      setTargetGroupId(null);
      setGroupModalOpen(false);
    }
  };

  const generalCount = countOrdersForCollectionListTab(orders, "general");
  const warehouseCount = countOrdersForCollectionListTab(orders, "warehouse");
  const linkedRaCount = countOrdersForCollectionListTab(orders, "linkedRa");
  const noInventoryCount = countOrdersForCollectionListTab(orders, "noInventory");
  const searchActive = search.trim().length > 0;
  const generalSorted = useMemo(
    () =>
      sortOrdersForReceptionistList(
        ordersForCollectionListTab(orders, "general"),
      ),
    [orders],
  );
  const queuePositions = useMemo(
    () => buildQueuePositions(generalSorted),
    [generalSorted],
  );
  const displayedOrders = useMemo(() => {
    // Solo en «En recepción»: fila/rampa arriba para no buscar hacia abajo.
    if (activeTab === "general") {
      return filterCollectionOrdersBySearch(generalSorted, search);
    }
    return filterCollectionOrdersBySearch(
      ordersForCollectionListTab(orders, activeTab),
      search,
    );
  }, [orders, activeTab, search, generalSorted]);

  const anyModalOpen = groupModalOpen || partialOrderId != null;
  useEffect(() => {
    if (!anyModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (partialBusy || groupBusy) return;
      setPartialOrderId(null);
      setGroupModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anyModalOpen, partialBusy, groupBusy]);

  /** Otras pestañas con coincidencias, para sugerir cuando aquí no hay resultados. */
  const searchOtherTabs = useMemo(() => {
    if (!searchActive) return [];
    return (
      [
        { tab: "general", label: "En recepción" },
        { tab: "warehouse", label: "En bodega" },
        { tab: "linkedRa", label: "Con RA" },
        { tab: "noInventory", label: "Sin inventario" },
      ] as const
    )
      .filter((t) => t.tab !== activeTab)
      .map((t) => ({
        ...t,
        count: filterCollectionOrdersBySearch(
          ordersForCollectionListTab(orders, t.tab),
          search,
        ).length,
      }))
      .filter((t) => t.count > 0);
  }, [orders, activeTab, search, searchActive]);

  const changeTab = (tab: CollectionOrderListTab) => {
    setActiveTab(tab);
    if (tab !== "general") setUnifyModeOn(false);
  };

  const unifyAvailable =
    !!(onCreateTruckGroup || onAddOrdersToTruckGroup) && activeTab === "general";

  const selectedList = useMemo(
    () => orders.filter((o) => selectedIds.has(o.id)),
    [orders, selectedIds],
  );

  const targetGroupOrders = useMemo(
    () =>
      targetGroupId
        ? orders.filter((o) => o.receptionGroupId === targetGroupId)
        : [],
    [orders, targetGroupId],
  );

  /** Camiones ya unificados (≥2 OR) para sumar una OR olvidada. */
  const existingTruckGroups = useMemo(() => {
    const map = new Map<string, CollectionOrder[]>();
    for (const o of orders) {
      const gid = o.receptionGroupId?.trim();
      if (!gid) continue;
      const list = map.get(gid) ?? [];
      list.push(o);
      map.set(gid, list);
    }
    return Array.from(map.entries())
      .filter(([, list]) => list.length > 1)
      .map(([groupId, list]) => {
        const numeros = list
          .map((o) => `#${o.numero ?? o.id.slice(0, 6)}`)
          .join(" · ");
        const providers = Array.from(
          new Set(
            list
              .map((o) => o.proveedor?.trim())
              .filter((p): p is string => !!p),
          ),
        );
        return {
          groupId,
          count: list.length,
          numeros,
          provider:
            providers.length === 0
              ? "Sin proveedor"
              : providers.length === 1
                ? providers[0]!
                : `${providers[0]} +${providers.length - 1}`,
        };
      });
  }, [orders]);

  const isAddingToExisting = !!targetGroupId && !!onAddOrdersToTruckGroup;

  const selectedProviderLabel = useMemo(() => {
    const source = isAddingToExisting
      ? [...targetGroupOrders, ...selectedList]
      : selectedList;
    const providers = Array.from(
      new Set(
        source
          .map((o) => o.proveedor?.trim())
          .filter((p): p is string => !!p),
      ),
    );
    if (providers.length === 0) return "Sin proveedor";
    if (providers.length === 1) return providers[0]!;
    return `${providers[0]} +${providers.length - 1}`;
  }, [isAddingToExisting, selectedList, targetGroupOrders]);

  const canConfirmAction = isAddingToExisting
    ? selectedList.length >= 1
    : selectedList.length >= 2;

  const submitTruckGroup = async () => {
    if (isAddingToExisting) {
      if (!onAddOrdersToTruckGroup || !targetGroupId || selectedList.length < 1) {
        return;
      }
      setGroupBusy(true);
      try {
        await onAddOrdersToTruckGroup({
          groupId: targetGroupId,
          orderIds: selectedList.map((o) => o.id),
        });
        setSelectedIds(new Set());
        setTargetGroupId(null);
        setUnifyMode(false);
        setGroupModalOpen(false);
      } catch {
        /* alert en el módulo */
      } finally {
        setGroupBusy(false);
      }
      return;
    }

    if (!onCreateTruckGroup || selectedList.length < 2) return;
    setGroupBusy(true);
    try {
      await onCreateTruckGroup({
        orderIds: selectedList.map((o) => o.id),
      });
      setSelectedIds(new Set());
      setTargetGroupId(null);
      setUnifyMode(false);
      setGroupModalOpen(false);
    } catch {
      /* alert en el módulo */
    } finally {
      setGroupBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full max-w-5xl mx-auto flex-1 flex-col bg-gradient-to-b from-indigo-50/40 via-transparent to-transparent px-2 py-3 sm:px-3 md:px-0 md:py-6 dark:from-indigo-950/20">
      {!standalone && onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="mb-2 inline-flex w-fit items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 sm:mb-4"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Volver a órdenes
        </button>
      ) : null}

      <header className="mb-3 shrink-0 rounded-2xl border border-indigo-300/70 bg-gradient-to-r from-[#1e2a5a] via-[#24356d] to-[#1e4f86] p-4 text-white shadow-xl shadow-indigo-500/25 dark:border-indigo-900/40 sm:mb-4 sm:rounded-3xl sm:p-5 md:p-6">
        <div className="flex min-h-10 items-center gap-2 text-indigo-100 sm:min-h-12">
          <UserCheck className="h-6 w-6 shrink-0 sm:h-8 sm:w-8" aria-hidden />
          <h1 className="min-w-0 truncate text-xl font-black uppercase tracking-tight text-white sm:text-2xl md:text-3xl">
            {standalone ? "Recepcionista" : "Vista recepcionista"}
          </h1>
        </div>
      </header>

      {onToggleRampOccupancy ? (
        <>
          <div className="mb-2 shrink-0 sm:hidden">
            <RampOccupancyControls
              occupancy={rampOccupancy}
              busyRamp={rampBusy}
              onToggle={onToggleRampOccupancy}
              compact
            />
          </div>
          <div className="mb-2 hidden shrink-0 sm:mb-4 sm:block">
            <RampOccupancyControls
              occupancy={rampOccupancy}
              busyRamp={rampBusy}
              onToggle={onToggleRampOccupancy}
            />
          </div>
        </>
      ) : null}

      <CollectionOrderListTabs
        active={activeTab}
        generalCount={generalCount}
        warehouseCount={warehouseCount}
        linkedRaCount={linkedRaCount}
        noInventoryCount={noInventoryCount}
        onChange={changeTab}
        trailing={
          !loading && orders.length > 0 ? (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <CollectionOrderListSearch value={search} onChange={setSearch} />
              {unifyAvailable ? (
                <button
                  type="button"
                  onClick={() => setUnifyModeOn(!unifyMode)}
                  aria-pressed={unifyMode}
                  title={
                    unifyMode
                      ? "Salir del modo unificar"
                      : "Unificar varias OR que llegaron en el mismo camión"
                  }
                  className={`group inline-flex h-8 items-center gap-2 rounded-lg p-1 text-[11px] font-semibold transition sm:h-9 lg:pr-3 ${
                    unifyMode
                      ? "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/30 ring-1 ring-indigo-500/60 hover:from-indigo-700 hover:to-violet-700"
                      : "border border-indigo-200 bg-white text-indigo-700 shadow-sm hover:border-indigo-300 hover:bg-indigo-50 dark:border-indigo-500/40 dark:bg-slate-900 dark:text-indigo-200 dark:hover:bg-indigo-950/40"
                  }`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition sm:h-7 sm:w-7 ${
                      unifyMode
                        ? "bg-white/20"
                        : "bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm"
                    }`}
                  >
                    <Truck className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <span className="hidden whitespace-nowrap lg:inline">
                    {unifyMode ? "Unificando" : "Unificar camión"}
                  </span>
                  {unifyMode && selectedIds.size > 0 ? (
                    <span className="rounded-full bg-white px-1.5 text-[10px] font-bold tabular-nums leading-4 text-indigo-700">
                      {selectedIds.size}
                    </span>
                  ) : null}
                  {unifyMode ? (
                    <X className="hidden h-3.5 w-3.5 opacity-80 lg:block" aria-hidden />
                  ) : null}
                </button>
              ) : null}
            </div>
          ) : null
        }
      />

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Cargando órdenes">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex animate-pulse items-center gap-3 rounded-xl border border-slate-200/80 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-40 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-3 w-64 max-w-full rounded bg-slate-100 dark:bg-slate-800" />
              </div>
              <div className="hidden h-12 w-[330px] rounded-xl bg-slate-100 dark:bg-slate-800 sm:block" />
            </div>
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
            <Truck className="h-6 w-6" aria-hidden />
          </span>
          <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
            No hay órdenes de recolección.
          </p>
        </div>
      ) : displayedOrders.length === 0 && searchActive ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-900">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
            <Search className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Sin resultados para «{search.trim()}»
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Probá con el número de OR, proveedor, cliente, marca o RA.
            </p>
          </div>
          {searchOtherTabs.length > 0 ? (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Hay coincidencias en:
              </span>
              {searchOtherTabs.map((t) => (
                <button
                  key={t.tab}
                  type="button"
                  onClick={() => changeTab(t.tab)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-indigo-950/40 dark:text-indigo-200"
                >
                  {t.label}
                  <span className="rounded-full bg-white px-1.5 text-[10px] tabular-nums text-indigo-600 dark:bg-indigo-900/60 dark:text-indigo-200">
                    {t.count}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : displayedOrders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
            <CheckCircle2 className="h-6 w-6" aria-hidden />
          </span>
          <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
            {activeTab === "general"
              ? "No hay órdenes en recepción."
              : activeTab === "warehouse"
                ? "No hay órdenes en bodega pendientes de RA."
                : activeTab === "linkedRa"
                  ? "No hay órdenes con RA asignado."
                  : "No hay órdenes sin inventario en bodega."}
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 sm:space-y-2">
          {displayedOrders.map((o) => {
            const hasOpenPartial = orderHasOpenPartialDelivery(o);
            const bultosTot = hasOpenPartial
              ? orderPendingBultos(o)
              : orderDisplayBultos(o);
            const isPriority = o.receptionPriority === true;
            const currentStatus = o.receptionStatus;
            const isBusy =
              busyOrderId === o.id ||
              busyOrderId === "__group__" ||
              (o.receptionGroupId != null &&
                busyOrderId === o.receptionGroupId);
            const inWarehouse = activeTab === "warehouse";
            const hasRa = orderHasLinkedRa(o);
            const queuePosition =
              activeTab === "general" ? queuePositions.get(o.id) : undefined;
            const queuedAtLabel =
              activeTab === "general" && currentStatus
                ? formatShortTime(o.receptionQueuedAt)
                : null;
            const consignee = o.cliente?.trim() || null;
            const isExpanded = isExtrasOpen(o);
            /** Estado activo cuyo botón quedó oculto al plegar «Más». */
            const hiddenActiveStatus =
              !isExpanded &&
              currentStatus != null &&
              RECEPTION_SECONDARY_ACTIONS.includes(currentStatus)
                ? currentStatus
                : null;
            const selectable =
              !!onCreateTruckGroup &&
              unifyMode &&
              activeTab === "general" &&
              canSelectForTruckGroup(o);
            const isSelected = selectedIds.has(o.id);
            const groupMateCount = o.receptionGroupId
              ? orders.filter((x) => x.receptionGroupId === o.receptionGroupId)
                  .length
              : 0;
            const isTargetGroup =
              !!targetGroupId &&
              o.receptionGroupId != null &&
              o.receptionGroupId === targetGroupId;
            const canPickAsTarget =
              !!onAddOrdersToTruckGroup &&
              unifyMode &&
              activeTab === "general" &&
              groupMateCount > 1 &&
              !!o.receptionGroupId;

            const renderStatusButton = (
              status: ReceptionStatusId,
              compact = false,
            ) => {
              const active = currentStatus === status;
              const tone = RECEPTION_ACTION_TONE[status];
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
                  onClick={() =>
                    status === RECEPTION_STATUS.EN_FILA &&
                    currentStatus === RECEPTION_STATUS.PARCIAL &&
                    onResumePartialDelivery
                      ? onResumePartialDelivery(o.id)
                      : onSetReceptionStatus(o.id, status)
                  }
                  className={receptionButtonClass(status, active, compact)}
                  aria-pressed={active}
                  title={RECEPTION_STATUS_LABELS[status]}
                >
                  {rampBadge ? (
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-black leading-none sm:h-[18px] sm:w-[18px] ${
                        active ? "bg-white/25 text-white" : tone.badge
                      }`}
                    >
                      {rampBadge}
                    </span>
                  ) : (
                    <Icon
                      className={`h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4 ${active ? "text-white" : tone.icon}`}
                      aria-hidden
                    />
                  )}
                  <span className="truncate">{label}</span>
                </button>
              );
            };

            return (
              <div
                key={o.id}
                className={`relative flex flex-col gap-1.5 overflow-hidden rounded-xl border py-2 pl-2.5 pr-2 text-left shadow-sm ring-1 ring-slate-900/[0.03] transition-shadow hover:shadow-md dark:ring-white/[0.04] sm:flex-row sm:items-center sm:gap-3 sm:py-2.5 sm:pl-3 sm:pr-2.5 ${
                  isSelected
                    ? "border-indigo-400 bg-indigo-50/80 ring-2 ring-indigo-300/70 dark:border-indigo-500 dark:bg-indigo-950/40"
                    : isTargetGroup
                      ? "border-sky-400 bg-sky-50/90 ring-sky-200 dark:border-sky-500 dark:bg-sky-950/40 dark:ring-sky-800"
                      : currentStatus
                      ? RECEPTION_COLUMN_THEME[currentStatus].card
                      : "border-slate-200/90 bg-white dark:border-slate-600/80 dark:bg-slate-900"
                } ${
                  isPriority && !inWarehouse
                    ? `${RECEPTION_PRIORITY_THEME.cardRing} ${RECEPTION_PRIORITY_THEME.cardBg}`
                    : ""
                }`}
              >
                <span
                  className={`pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b ${
                    isPriority && !inWarehouse
                      ? RECEPTION_PRIORITY_THEME.stripe
                      : currentStatus
                        ? RECEPTION_COLUMN_THEME[currentStatus].stripe
                        : "from-indigo-500 to-sky-500"
                  }`}
                />

                {selectable ? (
                  <label className="flex shrink-0 cursor-pointer items-center pl-1 sm:pl-0">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isBusy}
                      onChange={() => toggleSelected(o.id)}
                      className="h-5 w-5 cursor-pointer rounded-md border-slate-300 accent-indigo-600 focus:ring-indigo-500"
                      aria-label={`Seleccionar OR ${o.numero ?? o.id}`}
                    />
                  </label>
                ) : null}

                <div className="min-w-0 flex-1 pl-1">
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 sm:gap-x-2">
                    {queuePosition != null ? (
                      <span
                        className={`flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md px-1 text-[11px] font-black tabular-nums leading-none text-white shadow-sm ${
                          isPriority
                            ? RECEPTION_PRIORITY_THEME.queueBadge
                            : "bg-slate-800 dark:bg-slate-600"
                        }`}
                        title={`Posición ${queuePosition} en la fila`}
                        aria-label={`Posición ${queuePosition} en la fila`}
                      >
                        {queuePosition}
                      </span>
                    ) : null}
                    <p className="truncate text-sm font-black text-[#16263F] dark:text-slate-100 sm:text-[15px]">
                      Orden #{String(o.numero ?? "S/N")}
                    </p>
                    <span className="inline-flex shrink-0 items-baseline gap-0.5 rounded-md bg-violet-50 px-1 py-0.5 dark:bg-violet-950/40 sm:gap-1 sm:px-1.5">
                      <span className="text-[8px] font-black uppercase tracking-wide text-violet-500 dark:text-violet-300 sm:text-[9px]">
                        Bultos
                      </span>
                      <span className="text-xs font-black tabular-nums leading-none text-violet-600 dark:text-violet-200 sm:text-sm">
                        {bultosTot}
                      </span>
                    </span>
                    {isPriority && !inWarehouse ? (
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] sm:px-2 sm:text-[9px] ${RECEPTION_PRIORITY_THEME.badge}`}
                        title="Camión prioritario: pasa primero en la fila"
                      >
                        <Zap className="h-2.5 w-2.5 fill-current sm:h-3 sm:w-3" aria-hidden />
                        Prioridad
                      </span>
                    ) : null}
                    {hasOpenPartial && !inWarehouse ? (
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide sm:px-2 sm:text-[9px] ${RECEPTION_COLUMN_THEME.PARCIAL.badge}`}
                        title="Entrega parcial: el proveedor trae el resto después"
                      >
                        Llegaron {orderReceivedBultos(o)} de {orderDisplayBultos(o)} · Faltan{" "}
                        {orderPendingBultos(o)}
                      </span>
                    ) : null}
                    {groupMateCount > 1 ? (
                      canPickAsTarget ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() =>
                            selectTargetGroup(o.receptionGroupId!)
                          }
                          className={`rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide sm:px-2 sm:text-[9px] ${
                            isTargetGroup
                              ? "border-sky-600 bg-sky-600 text-white"
                              : "border-sky-200 bg-sky-50 text-sky-800 hover:border-sky-400 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
                          }`}
                          title="Elegir este camión para sumar OR"
                        >
                          {isTargetGroup
                            ? `✓ Camión elegido · ${groupMateCount} OR`
                            : `Camión · ${groupMateCount} OR`}
                        </button>
                      ) : (
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200 sm:px-2 sm:text-[9px]">
                          Camión · {groupMateCount} OR
                        </span>
                      )
                    ) : null}
                    {inWarehouse ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300 sm:px-2 sm:text-[9px]">
                        ● En bodega
                      </span>
                    ) : currentStatus ? (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide sm:px-2 sm:text-[9px] ${RECEPTION_COLUMN_THEME[currentStatus].badge}`}
                      >
                        ● {RECEPTION_STATUS_LABELS[currentStatus]}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] sm:gap-x-2 sm:text-[11px]">
                    {o.proveedor?.trim() ? (
                      <span className="min-w-0 max-w-full truncate font-semibold text-slate-600 dark:text-slate-300">
                        <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 sm:text-[9px]">
                          Prov.{" "}
                        </span>
                        {o.proveedor}
                      </span>
                    ) : null}
                    {consignee ? (
                      <span className="min-w-0 max-w-full truncate font-semibold text-slate-600 dark:text-slate-300">
                        <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 sm:text-[9px]">
                          Cliente{" "}
                        </span>
                        {consignee}
                      </span>
                    ) : null}
                    {queuedAtLabel ? (
                      <span
                        className="inline-flex shrink-0 items-center gap-1 font-semibold tabular-nums text-slate-400 dark:text-slate-500"
                        title="Hora de entrada a la fila"
                      >
                        <Clock3 className="h-3 w-3" aria-hidden />
                        {queuedAtLabel}
                      </span>
                    ) : null}
                    {inWarehouse ? (
                      hasRa ? (
                        <span className="rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300 sm:text-[9px]">
                          RA: {o.linkedRaNumbers!.join(", ")}
                        </span>
                      ) : (
                        <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300 sm:text-[9px]">
                          Pendiente RA
                        </span>
                      )
                    ) : null}
                  </div>
                </div>

                  <div className="flex w-full shrink-0 flex-col items-stretch gap-1.5 sm:w-[330px]">
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
                        <div className="grid grid-cols-5 gap-1 rounded-xl bg-slate-100/80 p-1 ring-1 ring-inset ring-slate-200/70 dark:bg-slate-800/60 dark:ring-slate-700/70">
                          {RECEPTION_PRIMARY_ACTIONS.map((status) =>
                            renderStatusButton(status),
                          )}
                          <button
                            type="button"
                            onClick={() => toggleExtras(o)}
                            aria-expanded={isExpanded}
                            title={
                              hiddenActiveStatus
                                ? `${RECEPTION_STATUS_LABELS[hiddenActiveStatus]} · ver opciones`
                                : "Rampa extra, carretillado, prioridad y entrega parcial"
                            }
                            className={`${actionButtonBase} h-11 flex-col gap-1 px-0.5 text-[8px] sm:h-12 sm:text-[9px] ${
                              isExpanded
                                ? "border-slate-300 bg-slate-200/80 text-slate-800 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                                : hiddenActiveStatus
                                  ? RECEPTION_ACTION_TONE[hiddenActiveStatus].active
                                  : `${actionButtonIdle} hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-slate-800`
                            }`}
                          >
                            {isExpanded ? (
                              <Minus className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" aria-hidden />
                            ) : (
                              <MoreHorizontal
                                className={`h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4 ${hiddenActiveStatus ? "text-white" : "text-slate-400"}`}
                                aria-hidden
                              />
                            )}
                            <span className="truncate">
                              {isExpanded
                                ? "Menos"
                                : hiddenActiveStatus
                                  ? receptionShortLabel(hiddenActiveStatus)
                                  : "Más"}
                            </span>
                          </button>
                        </div>

                        {isExpanded ? (
                          <div className="grid grid-cols-2 gap-1">
                            {RECEPTION_SECONDARY_ACTIONS.map((status) =>
                              renderStatusButton(status, true),
                            )}
                          </div>
                        ) : null}

                        {isExpanded &&
                        (onTogglePriority || onMarkPartialDelivery) ? (
                          <div className="grid grid-cols-2 gap-1">
                            {onTogglePriority ? (
                              <button
                                type="button"
                                disabled={
                                  isBusy ||
                                  currentStatus === RECEPTION_STATUS.PARCIAL
                                }
                                onClick={() => onTogglePriority(o.id)}
                                aria-pressed={isPriority}
                                title={
                                  isPriority
                                    ? "Quitar prioridad"
                                    : "Marcar camión prioritario: pasa primero en la fila"
                                }
                                className={`${receptionExtraButtonBase} ${
                                  isPriority ? priorityButtonActive : priorityButtonIdle
                                }`}
                              >
                                <Zap
                                  className={`h-3.5 w-3.5 shrink-0 fill-current ${isPriority ? "text-white" : "text-red-500"}`}
                                  aria-hidden
                                />
                                <span>{isPriority ? "Prioridad ✓" : "Prioridad"}</span>
                              </button>
                            ) : null}
                            {currentStatus === RECEPTION_STATUS.PARCIAL &&
                            onResumePartialDelivery ? (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => onResumePartialDelivery(o.id)}
                                title="El proveedor volvió con lo que faltaba: vuelve a la fila"
                                className={`${receptionExtraButtonBase} ${partialButtonActive}`}
                              >
                                <PackageCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                <span>Llegó el resto</span>
                              </button>
                            ) : onMarkPartialDelivery ? (
                              <button
                                type="button"
                                disabled={isBusy || orderDisplayBultos(o) <= 0}
                                onClick={() => openPartialModal(o.id)}
                                title={
                                  orderDisplayBultos(o) <= 0
                                    ? "La OR no tiene bultos esperados"
                                    : "Llegaron menos bultos de los esperados"
                                }
                                className={`${receptionExtraButtonBase} ${partialButtonIdle}`}
                              >
                                <PackageMinus
                                  className={`h-3.5 w-3.5 shrink-0 ${RECEPTION_ACTION_TONE.PARCIAL.icon}`}
                                  aria-hidden
                                />
                                <span>Parcial</span>
                              </button>
                            ) : null}
                          </div>
                        ) : null}

                        {currentStatus ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => onClearReceptionStatus(o.id)}
                            title="Quitar de fila, rampa y tablero de camiones"
                            className="inline-flex items-center justify-center gap-1.5 self-end rounded-md px-2 py-1 text-[10px] font-semibold text-slate-500 transition hover:bg-red-50 hover:text-red-600 active:scale-[0.98] disabled:opacity-50 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                          >
                            {isBusy ? (
                              <Loader2
                                className="h-3 w-3 shrink-0 animate-spin sm:h-3.5 sm:w-3.5"
                                aria-hidden
                              />
                            ) : (
                              <X className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" aria-hidden />
                            )}
                            <span className="sm:hidden">Quitar</span>
                            <span className="hidden sm:inline">Quitar del tablero</span>
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

      {(onCreateTruckGroup || onAddOrdersToTruckGroup) &&
      unifyMode &&
      activeTab === "general" ? (
        <div className="sticky bottom-2 z-20 mt-2 shrink-0 overflow-hidden rounded-2xl border border-indigo-200/80 bg-white/95 shadow-xl shadow-indigo-900/10 backdrop-blur dark:border-indigo-800/70 dark:bg-slate-900/95">
          <div className="flex items-center gap-2.5 bg-gradient-to-r from-indigo-50 via-violet-50 to-white px-3 py-2.5 dark:from-indigo-950/60 dark:via-violet-950/40 dark:to-slate-900">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/30">
              <Truck className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-slate-800 dark:text-slate-100">
                Unificar OR en un camión
              </p>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {isAddingToExisting
                  ? `Sumando a un camión de ${targetGroupOrders.length} OR`
                  : selectedIds.size === 0
                    ? "Marcá las OR que llegaron juntas en el mismo camión."
                    : `${selectedIds.size} OR seleccionada${selectedIds.size === 1 ? "" : "s"} · ${selectedProviderLabel}`}
              </p>
            </div>
            {selectedIds.size > 0 ? (
              <span className="shrink-0 rounded-full bg-indigo-600 px-2 py-0.5 text-[11px] font-bold tabular-nums text-white">
                {selectedIds.size}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setUnifyModeOn(false)}
              aria-label="Salir del modo unificar"
              title="Salir del modo unificar"
              className="shrink-0 rounded-md p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {selectedIds.size > 0 || isAddingToExisting ? (
          <div className="space-y-2.5 border-t border-indigo-100 p-3 dark:border-indigo-900/50">
          {selectedIds.size > 0 &&
          !isAddingToExisting &&
          onAddOrdersToTruckGroup &&
          existingTruckGroups.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Sumar {selectedIds.size === 1 ? "esta OR" : `estas ${selectedIds.size} OR`} a un
                camión que ya existe
              </p>
              <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto">
                {existingTruckGroups.map((g) => (
                  <button
                    key={g.groupId}
                    type="button"
                    disabled={busyOrderId != null}
                    onClick={() => {
                      setTargetGroupId(g.groupId);
                      setGroupModalOpen(true);
                    }}
                    className="group flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-left shadow-sm transition hover:border-sky-300 hover:bg-sky-50/70 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-sky-700 dark:hover:bg-sky-950/40"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-600 dark:bg-sky-900/50 dark:text-sky-300">
                      <Truck className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold text-slate-800 dark:text-slate-100">
                        {g.provider}
                      </span>
                      <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {g.numeros} · {g.count} OR
                      </span>
                    </span>
                    <span className="shrink-0 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700 transition group-hover:border-sky-600 group-hover:bg-sky-600 group-hover:text-white dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
                      Sumar aquí
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {isAddingToExisting ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Camión elegido ({targetGroupOrders.length} OR)
                {selectedIds.size > 0
                  ? ` · +${selectedIds.size} para sumar`
                  : " · marcá la OR olvidada"}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedIds(new Set());
                    setTargetGroupId(null);
                  }}
                  className={secondaryButtonClass}
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  disabled={!canConfirmAction || busyOrderId != null}
                  onClick={() => setGroupModalOpen(true)}
                  className={primaryButtonClass}
                >
                  <Truck className="h-3.5 w-3.5" aria-hidden />
                  Confirmar suma
                </button>
              </div>
            </div>
          ) : null}

          {!isAddingToExisting && selectedIds.size > 0 ? (
            <div
              className={`flex flex-wrap items-center justify-between gap-2 ${
                onAddOrdersToTruckGroup && existingTruckGroups.length > 0
                  ? "border-t border-slate-100 pt-2.5 dark:border-slate-700"
                  : ""
              }`}
            >
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                {selectedIds.size >= 2
                  ? `Camión nuevo · ${selectedIds.size} OR · ${selectedProviderLabel}`
                  : existingTruckGroups.length > 0
                    ? "O marcá otra OR suelta para crear un camión nuevo"
                    : "Marcá al menos 2 OR para crear el camión"}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedIds(new Set());
                    setTargetGroupId(null);
                  }}
                  className={secondaryButtonClass}
                >
                  Limpiar
                </button>
                {onCreateTruckGroup ? (
                  <button
                    type="button"
                    disabled={selectedIds.size < 2 || busyOrderId != null}
                    onClick={() => setGroupModalOpen(true)}
                    className={primaryButtonClass}
                  >
                    <Truck className="h-3.5 w-3.5" aria-hidden />
                    Crear camión nuevo
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          </div>
          ) : null}
        </div>
      ) : null}

      {groupModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-3 backdrop-blur-sm sm:items-center"
          onClick={(e) => {
            if (e.target === e.currentTarget && !groupBusy) setGroupModalOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="truck-group-title"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          >
            <h3
              id="truck-group-title"
              className="text-base font-black text-[#16263F] dark:text-slate-100"
            >
              {selectedProviderLabel}
            </h3>
            <p className="mt-0.5 text-[10px] font-black uppercase tracking-wide text-slate-400">
              {isAddingToExisting
                ? `Sumar ${selectedList.length} OR · queda en ${
                    targetGroupOrders.length + selectedList.length
                  } OR`
                : `1 camión · ${selectedList.length} OR`}
            </p>
            {isAddingToExisting && targetGroupOrders.length > 0 ? (
              <div className="mt-3">
                <p className="mb-1 text-[9px] font-black uppercase tracking-wide text-slate-400">
                  Ya en el camión
                </p>
                <ul className="max-h-28 space-y-1 overflow-y-auto rounded-xl border border-sky-100 bg-sky-50/80 p-2.5 dark:border-sky-900 dark:bg-sky-950/40">
                  {targetGroupOrders.map((o) => (
                    <li
                      key={o.id}
                      className="flex items-baseline justify-between gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200"
                    >
                      <span>
                        OR{" "}
                        <span className="font-black tabular-nums">
                          #{o.numero ?? o.id.slice(0, 6)}
                        </span>
                      </span>
                      <span className="tabular-nums font-black text-violet-700 dark:text-violet-300">
                        {orderDisplayBultos(o)} bult
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className={isAddingToExisting ? "mt-2" : "mt-3"}>
              {isAddingToExisting ? (
                <p className="mb-1 text-[9px] font-black uppercase tracking-wide text-slate-400">
                  Se suman ahora
                </p>
              ) : null}
              <ul className="max-h-48 space-y-1.5 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/50">
                {selectedList.map((o) => (
                  <li
                    key={o.id}
                    className="flex items-baseline justify-between gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200"
                  >
                    <span>
                      OR{" "}
                      <span className="font-black tabular-nums">
                        #{o.numero ?? o.id.slice(0, 6)}
                      </span>
                    </span>
                    <span className="tabular-nums font-black text-violet-700 dark:text-violet-300">
                      {orderDisplayBultos(o)} bult
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="mt-2 text-right text-xs font-black text-slate-600 dark:text-slate-300">
              Total{" "}
              {(isAddingToExisting
                ? [...targetGroupOrders, ...selectedList]
                : selectedList
              ).reduce((s, o) => s + orderDisplayBultos(o), 0)}{" "}
              bultos
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={groupBusy}
                onClick={() => setGroupModalOpen(false)}
                className={`${secondaryButtonClass} flex-1 py-2.5`}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={groupBusy || !canConfirmAction}
                onClick={() => void submitTruckGroup()}
                className={`${primaryButtonClass} flex-1 py-2.5`}
              >
                {groupBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Truck className="h-3.5 w-3.5" aria-hidden />
                )}
                {groupBusy
                  ? "Guardando…"
                  : isAddingToExisting
                    ? "Confirmar suma"
                    : "Enviar a fila"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {partialOrder ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-3 backdrop-blur-sm sm:items-center"
          onClick={(e) => {
            if (e.target === e.currentTarget && !partialBusy) setPartialOrderId(null);
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="partial-delivery-title"
            className="w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onSubmit={(e) => {
              e.preventDefault();
              void submitPartial();
            }}
          >
            <div className="flex items-start gap-3 border-b border-cyan-100 bg-gradient-to-r from-cyan-50 to-white px-4 py-3 dark:border-cyan-900/40 dark:from-cyan-950/40 dark:to-slate-900">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-600 to-cyan-700 text-white shadow-md shadow-cyan-600/30">
                <PackageMinus className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h3
                  id="partial-delivery-title"
                  className="text-base font-black text-[#16263F] dark:text-slate-100"
                >
                  Entrega parcial · OR #{partialOrder.numero ?? partialOrder.id.slice(0, 6)}
                </h3>
                {partialOrder.proveedor?.trim() ? (
                  <p className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {partialOrder.proveedor}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                disabled={partialBusy}
                onClick={() => setPartialOrderId(null)}
                aria-label="Cerrar"
                className="shrink-0 rounded-md p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="p-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "Esperados", value: orderDisplayBultos(partialOrder), tone: "text-slate-800 dark:text-slate-100" },
                { label: "Ya llegaron", value: orderReceivedBultos(partialOrder), tone: "text-emerald-700 dark:text-emerald-300" },
                { label: "Pendientes", value: partialPending, tone: "text-cyan-700 dark:text-cyan-300" },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-xl border border-slate-100 bg-slate-50 px-2 py-2 dark:border-slate-700 dark:bg-slate-950/50"
                >
                  <p className={`text-lg font-black tabular-nums leading-none ${s.tone}`}>
                    {s.value}
                  </p>
                  <p className="mt-1 text-[9px] font-bold uppercase tracking-wide text-slate-400">
                    {s.label}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              {(() => {
                const total = Math.max(1, orderDisplayBultos(partialOrder));
                const before = orderReceivedBultos(partialOrder);
                const now = Math.min(partialArrived, partialPending);
                return (
                  <div className="flex h-full">
                    <div
                      className="h-full bg-emerald-500 transition-all"
                      style={{ width: `${(before / total) * 100}%` }}
                    />
                    <div
                      className="h-full bg-cyan-600 transition-all"
                      style={{ width: `${(now / total) * 100}%` }}
                    />
                  </div>
                );
              })()}
            </div>

            <label className="mt-4 block text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
              ¿Cuántos bultos llegaron ahora?
              <div className="mt-1 flex gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={partialPending}
                  autoFocus
                  value={partialInput}
                  onChange={(e) => setPartialInput(e.target.value)}
                  placeholder="0"
                  className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-lg font-black tabular-nums text-slate-900 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => setPartialInput(String(partialPending))}
                  className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-[10px] font-black uppercase tracking-wide text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300"
                  title="Llegó todo lo pendiente"
                >
                  Todo ({partialPending})
                </button>
              </div>
            </label>

            {partialArrived > 0 ? (
              partialArrived > partialPending ? (
                <p className="mt-2 text-xs font-bold text-red-600 dark:text-red-400">
                  No puede ser mayor que los {partialPending} pendientes.
                </p>
              ) : partialArrived === partialPending ? (
                <p className="mt-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                  Llegó todo: la OR se marcará como Listo.
                </p>
              ) : (
                <p className="mt-2 text-xs font-bold text-cyan-700 dark:text-cyan-300">
                  Faltan {partialPending - partialArrived} bultos. Quedará en «Parcial / Pendiente»
                  hasta que el proveedor traiga el resto.
                </p>
              )
            ) : null}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={partialBusy}
                onClick={() => setPartialOrderId(null)}
                className={`${secondaryButtonClass} flex-1 py-2.5`}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={partialBusy || !partialValid}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-700 to-cyan-600 px-3.5 py-2.5 text-[11px] font-semibold text-white shadow-md shadow-cyan-600/30 transition hover:from-cyan-800 hover:to-cyan-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                {partialBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <PackageCheck className="h-3.5 w-3.5" aria-hidden />
                )}
                {partialBusy
                  ? "Guardando…"
                  : partialArrived > 0 && partialArrived === partialPending
                    ? "Registrar y marcar Listo"
                    : "Registrar"}
              </button>
            </div>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
