"use client";

import React, { useCallback, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Check,
  CheckCircle2,
  ChevronRight,
  ChevronsUp,
  Container,
  Edit,
  GripVertical,
  ListChecks,
  Loader2,
  Lock,
  LockOpen,
  MoreHorizontal,
  MoreVertical,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  deleteContainerLoad,
  fetchContainerLoads,
  normalizeContainerLoadRa,
  reorderContainerLoads,
  setContainerLoadStatus,
  updateContainerLoad,
} from "@/lib/containerLoads";
import {
  CONTAINER_LOAD_STATE_CHIP,
  CONTAINER_LOAD_STATE_LABELS,
  DEFAULT_NO_INVENTORY_REASON,
  buildTasksByRa,
  compareContainerLoadWorkOrder,
  describeRaConflicts,
  findRaConflicts,
  summarizeContainerLoad,
  type ContainerLoadItemState,
  type ContainerLoadItemView,
  type ContainerLoadSummary,
} from "@/lib/containerLoadStatus";
import { ContainerLoadRaPicker } from "@/components/control-panel/ContainerLoadRaPicker";
import type { ContainerLoad, ContainerLoadItem } from "@/lib/types/containerLoad";
import type { Task } from "@/lib/types/task";
import { ContainerLoadImportModal } from "@/components/control-panel/ContainerLoadImportModal";
import { ContainerLoadItemEditModal } from "@/components/control-panel/ContainerLoadItemEditModal";

export type ContainerLoadCardViewMode = "pending" | "completed" | "rectification";

export type RenderContainerLoadTaskCard = (
  task: Task,
  opts: { viewMode: ContainerLoadCardViewMode; disabled: boolean; isNext: boolean },
) => React.ReactNode;

type Props = {
  tasks: Task[];
  loads: ContainerLoad[];
  setLoads: React.Dispatch<React.SetStateAction<ContainerLoad[]>>;
  loading: boolean;
  error: string | null;
  canManage: boolean;
  userEmail?: string | null;
  /** Tarjeta de RA igual a la de las otras pestañas (presencia, reloj y acciones del padre). */
  renderTaskCard: RenderContainerLoadTaskCard;
  /** Controlado por el padre para conservar el cargue abierto al volver de un RA. */
  selectedLoadId?: string | null;
  onSelectLoad?: (id: string | null) => void;
};

type DetailFilter = "all" | "pending" | "completed" | "rectification";

const FILTER_LABELS: Record<DetailFilter, string> = {
  all: "Todos",
  pending: "Pendientes",
  completed: "Completados",
  rectification: "Rectificación",
};

function filterForState(state: ContainerLoadItemState): Exclude<DetailFilter, "all"> {
  if (state === "completed" || state === "not_required") return "completed";
  if (state === "rectification") return "rectification";
  return "pending";
}

function cardViewMode(state: ContainerLoadItemState): ContainerLoadCardViewMode {
  if (state === "completed") return "completed";
  if (state === "rectification") return "rectification";
  return "pending";
}

function ProgressRing({ summary }: { summary: ContainerLoadSummary }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const done = summary.total > 0 ? summary.ready / summary.total : 0;
  const working =
    summary.total > 0 ? (summary.ready + summary.inProgress) / summary.total : 0;
  const allDone = summary.total > 0 && summary.notInventoried === 0;
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="6"
          className={
            summary.total === 0 || allDone
              ? "stroke-slate-100 dark:stroke-slate-800"
              : "stroke-red-100 dark:stroke-red-950/60"
          }
        />
        {working > done ? (
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${working * c} ${c}`}
            className="stroke-blue-300 dark:stroke-blue-700"
          />
        ) : null}
        {done > 0 ? (
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${done * c} ${c}`}
            className="stroke-emerald-500 transition-all"
          />
        ) : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        {allDone ? (
          <Check className="h-6 w-6 text-emerald-600" strokeWidth={3} />
        ) : (
          <>
            <span className="text-sm font-black tabular-nums text-[#16263F] dark:text-slate-100">
              {summary.ready}/{summary.total}
            </span>
            <span className="mt-0.5 text-[8px] font-bold uppercase tracking-wider text-slate-400">
              listos
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ summary }: { summary: ContainerLoadSummary }) {
  const pct = summary.total > 0 ? (summary.ready / summary.total) * 100 : 0;
  const inPct = summary.total > 0 ? (summary.inProgress / summary.total) * 100 : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700">
      <div className="flex h-full">
        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        <div className="h-full bg-blue-400 transition-all" style={{ width: `${inPct}%` }} />
      </div>
    </div>
  );
}

function MissingRaCard({ row }: { row: ContainerLoadItemView }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-dashed border-slate-300 bg-white/60 px-3 py-2.5 dark:border-slate-600 dark:bg-slate-900/40 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-black tabular-nums leading-none text-slate-400 sm:text-xl">
          RA {row.item.ra}
        </h3>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[9px] font-bold sm:text-[10px] ${CONTAINER_LOAD_STATE_CHIP.missing}`}
          >
            {CONTAINER_LOAD_STATE_LABELS.missing}
          </span>
          <div className="flex min-w-[3.25rem] flex-col items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-center text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300 sm:rounded-lg sm:px-3 sm:py-1">
            <span className="text-[7px] font-semibold leading-none sm:text-[9px]">Bultos</span>
            <span className="text-sm font-bold tabular-nums leading-tight sm:text-lg">
              {row.item.bultos != null ? row.item.bultos : "—"}
            </span>
          </div>
        </div>
      </div>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        <Lock className="h-3 w-3 shrink-0" aria-hidden />
        Todavía no se puede inventariar: se habilita cuando se le asigne la OR.
      </p>
    </div>
  );
}

/** Misma estructura que `RaTaskCard` (tono completado) para un RA listo sin inventario. */
function NotRequiredRaCard({
  row,
  onEdit,
}: {
  row: ContainerLoadItemView;
  onEdit?: () => void;
}) {
  const provider = row.item.proveedor || row.task?.provider || "—";
  const brand = row.item.marca || row.task?.brand || "—";
  const bultos = row.item.bultos ?? (row.task?.expectedBultos || undefined);
  const editButton = (size: "sm" | "md") =>
    onEdit ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        title="Editar RA"
        className={`flex items-center justify-center text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950/45 ${
          size === "sm" ? "rounded-md p-1" : "rounded-lg p-1.5"
        }`}
      >
        <Edit className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
      </button>
    ) : null;

  return (
    <div
      className="flex flex-col gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/20 sm:gap-2 sm:p-4"
      title={row.item.noInventoryReason || DEFAULT_NO_INVENTORY_REASON}
    >
      <div className="flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 sm:gap-2">
          <h3 className="shrink-0 text-sm font-black tabular-nums leading-none text-[#16263F] dark:text-slate-100 sm:text-xl">
            RA {row.item.ra}
          </h3>
          <span
            className={`inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-px text-[8px] font-bold sm:gap-1 sm:px-2 sm:py-0.5 sm:text-[9px] ${CONTAINER_LOAD_STATE_CHIP.not_required}`}
          >
            <Check className="h-2.5 w-2.5 sm:h-3 sm:w-3" strokeWidth={3} aria-hidden />
            {CONTAINER_LOAD_STATE_LABELS.not_required}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="flex min-w-[3.25rem] flex-col items-center rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-center text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200 sm:min-w-0 sm:rounded-lg sm:px-3 sm:py-1">
            <span className="text-[7px] font-semibold leading-none sm:text-[9px]">Bultos</span>
            <span className="text-sm font-bold tabular-nums leading-tight sm:text-lg">
              {bultos != null ? bultos : "—"}
            </span>
          </div>
          <div className="flex shrink-0 items-center sm:hidden">{editButton("sm")}</div>
        </div>
      </div>

      <p className="truncate text-[11px] font-semibold leading-tight text-[#16263F] dark:text-slate-100 sm:hidden">
        <span className="font-medium text-slate-400 dark:text-slate-500">Prov. </span>
        {provider}
        <span className="mx-1 font-normal text-slate-300 dark:text-slate-600">·</span>
        <span className="font-medium text-slate-400 dark:text-slate-500">Marca </span>
        {brand}
      </p>

      <div className="hidden items-center justify-between gap-2 border-t border-emerald-200/70 pt-2 dark:border-emerald-900/50 sm:flex">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">Proveedor</p>
            <p className="truncate text-sm font-semibold text-[#16263F] dark:text-slate-100">
              {provider}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">Marca</p>
            <p className="truncate text-sm font-semibold text-[#16263F] dark:text-slate-100">
              {brand}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">{editButton("md")}</div>
      </div>
    </div>
  );
}

export function ContainerLoadsTab({
  tasks,
  loads,
  setLoads,
  loading,
  error,
  canManage,
  userEmail,
  renderTaskCard,
  selectedLoadId,
  onSelectLoad,
}: Props) {
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const selectedId = selectedLoadId !== undefined ? selectedLoadId : localSelectedId;
  const setSelectedId = onSelectLoad ?? setLocalSelectedId;
  const [showClosed, setShowClosed] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newRa, setNewRa] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [arranging, setArranging] = useState(false);
  const [detailFilter, setDetailFilter] = useState<DetailFilter>("all");
  const [detailQuery, setDetailQuery] = useState("");
  const [orderingLoads, setOrderingLoads] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [rowMenuRa, setRowMenuRa] = useState<string | null>(null);
  const [editingRa, setEditingRa] = useState<string | null>(null);

  const tasksByRa = useMemo(() => buildTasksByRa(tasks), [tasks]);

  const summaries = useMemo(
    () => loads.map((l) => summarizeContainerLoad(l, tasksByRa)),
    [loads, tasksByRa],
  );
  const openSummaries = summaries
    .filter((s) => s.load.status === "open")
    .sort((a, b) => compareContainerLoadWorkOrder(a.load, b.load));
  const closedSummaries = summaries.filter((s) => s.load.status === "closed");
  const selected = summaries.find((s) => s.load.id === selectedId) ?? null;
  /** Primer cargue abierto (en orden) que todavía tiene RA sin inventariar. */
  const firstToDoId =
    openSummaries.find((s) => s.notInventoried > 0)?.load.id ?? null;

  const replaceLoad = useCallback(
    (next: ContainerLoad) => {
      setLoads((prev) => {
        const idx = prev.findIndex((l) => l.id === next.id);
        if (idx === -1) return [next, ...prev];
        const copy = [...prev];
        copy[idx] = next;
        return copy;
      });
    },
    [setLoads],
  );

  const runAction = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  }, []);

  const saveItems = useCallback(
    (load: ContainerLoad, items: ContainerLoadItem[]) =>
      runAction(async () => {
        replaceLoad({ ...load, items });
        replaceLoad(await updateContainerLoad(load.id, { items }));
      }),
    [replaceLoad, runAction],
  );

  /** Relee los cargues del servidor y falla si algún RA ya está en otro cargue abierto. */
  const ensureNoConflicts = useCallback(
    async (ras: string[], loadId: string): Promise<ContainerLoad[]> => {
      const local = findRaConflicts(loads, ras, loadId);
      if (local.size > 0) {
        throw new Error(
          `Bloqueado: ${describeRaConflicts(local)} ya está en otro cargue abierto.`,
        );
      }
      const fresh = await fetchContainerLoads();
      setLoads(fresh);
      const remote = findRaConflicts(fresh, ras, loadId);
      if (remote.size > 0) {
        throw new Error(
          `Bloqueado: ${describeRaConflicts(remote)} ya está en otro cargue abierto.`,
        );
      }
      return fresh;
    },
    [loads, setLoads],
  );

  const addRas = (load: ContainerLoad, rawRas: string[]) =>
    runAction(async () => {
      const inLoad = new Set(load.items.map((it) => normalizeContainerLoadRa(it.ra)));
      const keys = [
        ...new Set(rawRas.map(normalizeContainerLoadRa).filter(Boolean)),
      ].filter((k) => !inLoad.has(k));
      if (keys.length === 0) {
        throw new Error("Esos RA ya están en este cargue.");
      }
      const fresh = await ensureNoConflicts(keys, load.id);
      const current = fresh.find((l) => l.id === load.id);
      if (!current) throw new Error("El cargue ya no existe.");
      if (current.status !== "open") {
        throw new Error("El cargue está cerrado. Reabrilo para agregar RA.");
      }
      const have = new Set(current.items.map((it) => normalizeContainerLoadRa(it.ra)));
      const items = [
        ...current.items,
        ...keys.filter((k) => !have.has(k)).map((ra) => ({ position: 0, ra })),
      ].map((it, i) => ({ ...it, position: i + 1 }));
      replaceLoad(await updateContainerLoad(load.id, { items }));
    });

  const moveItem = (load: ContainerLoad, index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= load.items.length) return;
    const items = [...load.items];
    [items[index], items[target]] = [items[target], items[index]];
    void saveItems(
      load,
      items.map((it, i) => ({ ...it, position: i + 1 })),
    );
  };

  const removeItem = (load: ContainerLoad, ra: string) => {
    if (!window.confirm(`¿Quitar el RA ${ra} de este cargue? Volverá a su pestaña de Inventarios.`)) {
      return;
    }
    void saveItems(
      load,
      load.items.filter((it) => it.ra !== ra).map((it, i) => ({ ...it, position: i + 1 })),
    );
  };

  const replaceItem = (load: ContainerLoad, next: ContainerLoadItem) =>
    saveItems(
      load,
      load.items.map((it) => (it.ra === next.ra ? next : it)),
    );

  const toggleNoInventory = (load: ContainerLoad, row: ContainerLoadItemView) => {
    const item = row.item;
    if (item.noInventoryRequired) {
      void replaceItem(load, {
        ...item,
        noInventoryRequired: undefined,
        noInventoryReason: undefined,
        noInventoryMarkedBy: undefined,
      });
      return;
    }
    if (
      row.state === "in_progress" &&
      !window.confirm(
        `El RA ${item.ra} tiene un inventario en proceso. ¿Marcarlo como listo sin inventario igual?`,
      )
    ) {
      return;
    }
    void replaceItem(load, {
      ...item,
      noInventoryRequired: true,
      noInventoryReason: item.noInventoryReason || DEFAULT_NO_INVENTORY_REASON,
      noInventoryMarkedBy: userEmail?.toLowerCase() || undefined,
    });
    setEditingRa(item.ra);
  };

  const addItem = (load: ContainerLoad) => {
    const ra = normalizeContainerLoadRa(newRa);
    if (!ra) return;
    if (load.items.some((it) => it.ra === ra)) {
      setActionError(`El RA ${ra} ya está en este cargue.`);
      return;
    }
    setNewRa("");
    void addRas(load, [ra]);
  };

  const toggleStatus = (summary: ContainerLoadSummary) => {
    const load = summary.load;
    if (load.status === "open") {
      const msg =
        summary.notInventoried > 0
          ? `Este cargue tiene ${summary.notInventoried} RA sin inventariar.\n\nSi lo cerrás, esos RA vuelven a su pestaña de Inventarios. ¿Cerrar de todas formas?`
          : `¿Cerrar el cargue «${load.name}»?`;
      if (!window.confirm(msg)) return;
      setArranging(false);
      void runAction(async () => {
        replaceLoad(await setContainerLoadStatus(load.id, "closed"));
      });
      return;
    }
    void runAction(async () => {
      try {
        await ensureNoConflicts(
          load.items.map((it) => it.ra),
          load.id,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        throw new Error(
          `No se puede reabrir. ${msg} Quitá esos RA de este cargue o del otro y volvé a intentar.`,
        );
      }
      replaceLoad(await setContainerLoadStatus(load.id, "open"));
    });
  };

  const removeLoad = (load: ContainerLoad) => {
    if (
      !window.confirm(
        `¿Eliminar el cargue «${load.name}»? Los RA no se borran; vuelven a su pestaña de Inventarios.`,
      )
    ) {
      return;
    }
    void runAction(async () => {
      await deleteContainerLoad(load.id);
      setLoads((prev) => prev.filter((l) => l.id !== load.id));
      setSelectedId(null);
    });
  };

  const rename = (load: ContainerLoad) => {
    const name = renaming?.trim();
    if (!name || name === load.name) {
      setRenaming(null);
      return;
    }
    void runAction(async () => {
      replaceLoad(await updateContainerLoad(load.id, { name }));
      setRenaming(null);
    });
  };

  const moveLoadTo = (from: number, to: number) => {
    if (from === to || to < 0 || to >= openSummaries.length) return;
    const ids = openSummaries.map((s) => s.load.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    const orderById = new Map(ids.map((id, i) => [id, i + 1]));
    setLoads((prev) =>
      prev.map((l) =>
        orderById.has(l.id) ? { ...l, sortOrder: orderById.get(l.id)! } : l,
      ),
    );
    void runAction(async () => {
      try {
        await reorderContainerLoads(ids);
      } catch (e) {
        setLoads(await fetchContainerLoads());
        throw e;
      }
    });
  };

  const leaveDetail = () => {
    setSelectedId(null);
    setRenaming(null);
    setActionError(null);
    setArranging(false);
    setMenuOpen(false);
    setRowMenuRa(null);
    setEditingRa(null);
    setDetailFilter("all");
    setDetailQuery("");
  };

  const importModal = canManage ? (
    <ContainerLoadImportModal
      open={importOpen}
      onClose={() => setImportOpen(false)}
      onCreated={(load) => {
        replaceLoad(load);
        setImportOpen(false);
        setSelectedId(load.id);
      }}
      tasks={tasks}
      tasksByRa={tasksByRa}
      loads={loads}
      onLoadsRefreshed={setLoads}
      userEmail={userEmail}
    />
  ) : null;

  if (selected) {
    const load = selected.load;
    const isOpen = load.status === "open";
    const editable = canManage && isOpen;
    const isArranging = editable && arranging;
    const filterCounts: Record<DetailFilter, number> = {
      all: selected.total,
      pending: selected.pending + selected.inProgress + selected.missing,
      completed: selected.ready,
      rectification: selected.rectification,
    };
    const editingRow = editingRa
      ? selected.rows.find((r) => r.item.ra === editingRa) ?? null
      : null;
    const q = detailQuery.trim().toLowerCase();
    const visibleRows = isArranging
      ? selected.rows
      : selected.rows.filter((row) => {
          if (detailFilter !== "all" && filterForState(row.state) !== detailFilter) {
            return false;
          }
          if (!q) return true;
          return [
            row.item.ra,
            row.item.proveedor,
            row.item.expedidor,
            row.task?.provider,
            row.task?.brand,
            row.task?.mainClient,
          ]
            .map((v) => String(v ?? "").toLowerCase())
            .join(" ")
            .includes(q);
        });

    return (
      <div className="space-y-3 pr-2 sm:space-y-4 sm:pr-3">
        {importModal}
        {editable ? (
          <ContainerLoadItemEditModal
            key={editingRa ?? "none"}
            item={editingRow?.item ?? null}
            task={editingRow?.task ?? null}
            busy={busy}
            userEmail={userEmail}
            onClose={() => setEditingRa(null)}
            onSave={(next) => {
              setEditingRa(null);
              void replaceItem(load, next);
            }}
          />
        ) : null}

        <section className="rounded-xl border border-slate-200/80 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900 sm:px-4">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={leaveDetail}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Volver a la lista de cargues"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="min-w-0 flex-1">
            {renaming !== null ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={renaming}
                  onChange={(e) => setRenaming(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") rename(load);
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-lg font-black text-[#16263F] outline-none focus:border-blue-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-50"
                />
                <button
                  type="button"
                  onClick={() => rename(load)}
                  className="rounded-lg bg-emerald-600 p-1.5 text-white"
                  aria-label="Guardar nombre"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setRenaming(null)}
                  className="rounded-lg bg-slate-200 p-1.5 text-slate-600 dark:bg-slate-700 dark:text-slate-200"
                  aria-label="Cancelar"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <h2 className="min-w-0 break-words text-base font-black leading-tight text-[#16263F] dark:text-slate-50 sm:text-lg">
                  {load.name}
                </h2>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold ${
                    isOpen
                      ? "text-blue-600 dark:text-blue-400"
                      : "text-slate-400"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${isOpen ? "bg-blue-500" : "bg-slate-400"}`}
                    aria-hidden
                  />
                  {isOpen ? "Abierto" : "Cerrado"}
                </span>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {canManage ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => toggleStatus(selected)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition disabled:opacity-50 ${
                    isOpen
                      ? "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      : "border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                  }`}
                >
                  {isOpen ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                  <span className="hidden sm:inline">{isOpen ? "Cerrar cargue" : "Reabrir"}</span>
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMenuOpen((v) => !v)}
                    title="Más opciones"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {menuOpen ? (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setMenuOpen(false)}
                        aria-hidden
                      />
                      <div className="absolute right-0 z-50 mt-1.5 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            setRenaming(load.name);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          <Edit className="h-3.5 w-3.5" />
                          Renombrar
                        </button>
                        {isOpen ? (
                          <button
                            type="button"
                            onClick={() => {
                              setMenuOpen(false);
                              setArranging((v) => !v);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            <ArrowUpDown className="h-3.5 w-3.5" />
                            {arranging ? "Terminar de ordenar" : "Ordenar / agregar RA"}
                          </button>
                        ) : null}
                        <div className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            removeLoad(load);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Eliminar cargue
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-10 text-[11px] text-slate-500 dark:text-slate-400">
          <div className="flex min-w-[8rem] flex-1 items-center gap-2">
            <div className="min-w-0 flex-1">
              <ProgressBar summary={selected} />
            </div>
            <span className="shrink-0 font-semibold tabular-nums">
              <span className="font-black text-slate-700 dark:text-slate-200">
                {selected.ready}/{selected.total}
              </span>{" "}
              listos
            </span>
          </div>
          {selected.inProgress > 0 ? (
            <span className="tabular-nums">
              <span className="font-bold text-blue-600 dark:text-blue-400">
                {selected.inProgress}
              </span>{" "}
              en proceso
            </span>
          ) : null}
          {isOpen ? (
            <span className="tabular-nums">
              {selected.nextRa ? (
                <>
                  Siguiente{" "}
                  <span className="font-black text-blue-600 dark:text-blue-400">
                    RA {selected.nextRa}
                  </span>
                </>
              ) : (
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  Todo inventariado
                </span>
              )}
            </span>
          ) : null}
        </div>

        {canManage ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-10 text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
            <span>
              Bultos{" "}
              <span className="font-bold text-slate-600 dark:text-slate-300">
                {selected.totals.bultos.toLocaleString("es-PA")}
              </span>
            </span>
            <span aria-hidden>·</span>
            <span>
              Peso{" "}
              <span className="font-bold text-slate-600 dark:text-slate-300">
                {selected.totals.peso.toLocaleString("es-PA", { maximumFractionDigits: 2 })} kg
              </span>
            </span>
            <span aria-hidden>·</span>
            <span>
              Cubicaje{" "}
              <span className="font-bold text-slate-600 dark:text-slate-300">
                {selected.totals.cbm.toLocaleString("es-PA", { maximumFractionDigits: 2 })} m³
              </span>
            </span>
          </div>
        ) : null}
        </section>

        {actionError ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {actionError}
          </p>
        ) : null}

        {isArranging ? (
          <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900/50 dark:bg-blue-950/20">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-blue-900 dark:text-blue-200">
                Arriba = fondo del contenedor (se inventaría primero) · Abajo = cierre.
              </p>
              <button
                type="button"
                onClick={() => setArranging(false)}
                className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700"
              >
                Listo
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                addItem(load);
              }}
              className="flex flex-wrap gap-2"
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => setPickerOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-[#16263F] hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              >
                <ListChecks className="h-4 w-4" />
                Seleccionar RA
              </button>
              <input
                value={newRa}
                onChange={(e) => setNewRa(e.target.value)}
                placeholder="Escribir RA"
                inputMode="numeric"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-[#16263F] outline-none focus:border-blue-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={busy || !newRa.trim()}
                className="inline-flex items-center gap-1 rounded-lg bg-[#16263F] px-3 text-xs font-bold text-white disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Agregar
              </button>
            </form>
            <ContainerLoadRaPicker
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              onConfirm={(ras) => {
                setPickerOpen(false);
                void addRas(load, ras);
              }}
              tasks={tasks}
              loads={loads}
              currentLoadId={load.id}
              excludeRas={load.items.map((it) => it.ra)}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
              {(Object.keys(FILTER_LABELS) as DetailFilter[]).map((key) => {
                const active = detailFilter === key;
                if (key === "rectification" && filterCounts.rectification === 0 && !active) {
                  return null;
                }
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setDetailFilter(key)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition sm:text-xs ${
                      active
                        ? "bg-white text-[#16263F] shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-white dark:ring-slate-700"
                        : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    {FILTER_LABELS[key]}
                    <span
                      className={`rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums ${
                        key === "completed" && filterCounts.completed > 0
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : key === "rectification"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                            : "bg-slate-200/80 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {filterCounts[key]}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-400/20 dark:border-slate-600 dark:bg-slate-900 sm:w-52 sm:shrink-0 sm:rounded-xl sm:px-3 sm:py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-slate-400 sm:h-4 sm:w-4" aria-hidden />
              <input
                type="search"
                value={detailQuery}
                onChange={(e) => setDetailQuery(e.target.value)}
                placeholder="Buscar"
                className="min-w-0 flex-1 bg-transparent text-[11px] font-semibold text-[#16263F] outline-none placeholder:text-slate-400 dark:text-slate-100 sm:text-xs"
                aria-label="Buscar en el cargue"
              />
              {detailQuery.trim() ? (
                <button
                  type="button"
                  onClick={() => setDetailQuery("")}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                  title="Limpiar búsqueda"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </div>
          </div>
        )}

        {visibleRows.length === 0 ? (
          <div className="rounded-[2rem] border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-500 md:p-16">
            {selected.total === 0
              ? "Este cargue todavía no tiene RA."
              : "Ningún RA coincide con el filtro o la búsqueda."}
          </div>
        ) : (
          <ol className="grid grid-cols-1 gap-3 py-1 pr-1 sm:gap-4">
            {visibleRows.map((row) => {
              const index = selected.rows.indexOf(row);
              const highlightNext = row.isNext && isOpen;
              const disabled = !canManage && row.state === "completed";
              const isReady = row.state === "completed" || row.state === "not_required";
              const showRowMenu = editable && !isArranging;
              const rowMenuOpen = rowMenuRa === row.item.ra;
              return (
                <li key={row.item.ra} className="flex items-stretch gap-2 sm:gap-3">
                  <span
                    title="Orden en el contenedor: arriba = fondo (se inventaría primero), abajo = cierre"
                    className={`flex w-6 shrink-0 items-start justify-center pt-3 text-xs font-black tabular-nums sm:w-8 sm:pt-5 sm:text-sm ${
                      highlightNext
                        ? "text-blue-600 dark:text-blue-400"
                        : isReady
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-slate-300 dark:text-slate-600"
                    }`}
                  >
                    {row.item.position}
                  </span>
                  <div
                    className={`min-w-0 flex-1 rounded-xl ${
                      highlightNext ? "ring-2 ring-blue-400/70" : ""
                    }`}
                  >
                    {row.state === "not_required" ? (
                      <NotRequiredRaCard
                        row={row}
                        onEdit={showRowMenu ? () => setEditingRa(row.item.ra) : undefined}
                      />
                    ) : row.task ? (
                      renderTaskCard(row.task, {
                        viewMode: cardViewMode(row.state),
                        disabled,
                        isNext: highlightNext,
                      })
                    ) : (
                      <MissingRaCard row={row} />
                    )}
                  </div>
                  {showRowMenu ? (
                    <div className="relative shrink-0 pt-2 sm:pt-3.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRowMenuRa(rowMenuOpen ? null : row.item.ra)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        title="Opciones del RA en el cargue"
                        aria-label={`Opciones del RA ${row.item.ra}`}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                      {rowMenuOpen ? (
                        <>
                          <div
                            className="fixed inset-0 z-40"
                            onClick={() => setRowMenuRa(null)}
                            aria-hidden
                          />
                          <div className="absolute right-0 z-50 mt-1 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                            {row.state !== "completed" ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setRowMenuRa(null);
                                  toggleNoInventory(load, row);
                                }}
                                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 ${
                                  row.item.noInventoryRequired
                                    ? "text-slate-700 dark:text-slate-200"
                                    : "text-emerald-700 dark:text-emerald-300"
                                }`}
                              >
                                {row.item.noInventoryRequired ? (
                                  <RotateCcw className="h-3.5 w-3.5" />
                                ) : (
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                )}
                                {row.item.noInventoryRequired
                                  ? "Quitar «listo», volver a pendiente"
                                  : "Marcar listo (no requiere inventario)"}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => {
                                setRowMenuRa(null);
                                setEditingRa(row.item.ra);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                            >
                              <Edit className="h-3.5 w-3.5" />
                              Editar datos en el cargue
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {isArranging ? (
                    <div className="flex shrink-0 flex-col items-center justify-center gap-0.5">
                      <button
                        type="button"
                        disabled={busy || index === 0}
                        onClick={() => moveItem(load, index, -1)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-800"
                        aria-label="Subir"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => removeItem(load, row.item.ra)}
                        className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 dark:hover:bg-red-950/40"
                        aria-label="Quitar RA del cargue"
                      >
                        <X className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={busy || index === selected.rows.length - 1}
                        onClick={() => moveItem(load, index, 1)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-800"
                        aria-label="Bajar"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}

        {canManage && !isOpen ? (
          <p className="px-1 text-[11px] font-semibold text-slate-400">
            Cargue cerrado: reabrilo para agregar, quitar u ordenar RA.
          </p>
        ) : null}
      </div>
    );
  }

  const list = showClosed ? closedSummaries : openSummaries;

  return (
    <div className="space-y-4">
      {importModal}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {[
            { key: false, label: `Abiertos (${openSummaries.length})` },
            { key: true, label: `Cerrados (${closedSummaries.length})` },
          ].map((opt) => (
            <button
              key={String(opt.key)}
              type="button"
              onClick={() => setShowClosed(opt.key)}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition ${
                showClosed === opt.key
                  ? "bg-white text-[#16263F] shadow-sm dark:bg-slate-700 dark:text-white"
                  : "text-slate-500"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {canManage ? (
          <div className="ml-auto flex items-center gap-2">
            {!showClosed && openSummaries.length > 1 ? (
              <button
                type="button"
                onClick={() => setOrderingLoads((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-[11px] font-black uppercase tracking-wide transition ${
                  orderingLoads
                    ? "bg-blue-600 text-white shadow-sm"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                }`}
              >
                {orderingLoads ? <Check className="h-4 w-4" /> : <ArrowUpDown className="h-4 w-4" />}
                {orderingLoads ? "Listo" : "Ordenar cargues"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#16263F] px-4 py-2.5 text-[11px] font-black uppercase tracking-wide text-white shadow-sm"
            >
              <Plus className="h-4 w-4" />
              Nuevo cargue
            </button>
          </div>
        ) : null}
      </div>

      {!showClosed && openSummaries.length > 1 && !(canManage && orderingLoads) ? (
        <p className="-mt-1 text-[11px] font-medium text-slate-500">
          Inventariá los cargues en este orden: primero el 1, después el 2, y así.
        </p>
      ) : null}

      {actionError && !selected ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {actionError}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {error}
        </p>
      ) : null}

      {loading && loads.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm font-bold text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          Cargando cargues…
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-3xl border-2 border-dashed border-slate-200 py-16 text-center dark:border-slate-700">
          <Container className="h-10 w-10 text-slate-300" />
          <p className="text-sm font-bold text-slate-500">
            {showClosed ? "No hay cargues cerrados." : "No hay cargues abiertos."}
          </p>
          {!showClosed && canManage ? (
            <p className="max-w-sm text-xs text-slate-400">
              Creá un cargue con la relación de cargue en Excel o eligiendo los RA a mano.
              Sus RA salen de todas las pestañas (Pendientes, Prioridad, Completados y
              Rectificación) y se ven solo en el cargue, en el orden del contenedor.
            </p>
          ) : null}
        </div>
      ) : canManage && orderingLoads && !showClosed ? (
        <div className="mx-auto max-w-2xl space-y-3">
          <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
            Arrastrá los cargues para cambiar el orden, o elegí la posición en el número.
            El <span className="font-black">1</span> es el que se inventaría primero. Los
            cambios se guardan solos.
          </div>
          <ol className="space-y-2">
            {openSummaries.map((s, index) => {
              const done = s.total > 0 && s.notInventoried === 0;
              const isDragging = dragIndex === index;
              const isDropTarget =
                dragIndex !== null && dragOverIndex === index && dragIndex !== index;
              return (
                <li
                  key={s.load.id}
                  draggable={!busy}
                  onDragStart={(e) => {
                    setDragIndex(index);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", s.load.id);
                  }}
                  onDragOver={(e) => {
                    if (dragIndex === null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dragOverIndex !== index) setDragOverIndex(index);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null) moveLoadTo(dragIndex, index);
                    setDragIndex(null);
                    setDragOverIndex(null);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setDragOverIndex(null);
                  }}
                  className={`flex items-center gap-3 rounded-2xl border bg-white px-3 py-3 transition dark:bg-slate-900 ${
                    isDragging ? "opacity-40" : ""
                  } ${
                    isDropTarget
                      ? "border-blue-400 ring-2 ring-blue-400/30"
                      : "border-slate-200 dark:border-slate-700"
                  }`}
                >
                  <GripVertical
                    className="h-5 w-5 shrink-0 cursor-grab text-slate-300 active:cursor-grabbing"
                    aria-hidden
                  />
                  <label className="relative shrink-0" title="Cambiar posición">
                    <span className="sr-only">Posición de {s.load.name}</span>
                    <select
                      value={index}
                      disabled={busy}
                      onChange={(e) => moveLoadTo(index, Number(e.target.value))}
                      className={`h-10 w-14 cursor-pointer appearance-none rounded-xl text-center text-base font-black tabular-nums text-white outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-60 ${
                        done
                          ? "bg-emerald-500"
                          : s.load.id === firstToDoId
                            ? "bg-blue-600"
                            : "bg-[#16263F] dark:bg-slate-600"
                      }`}
                    >
                      {openSummaries.map((o, i) => (
                        <option key={o.load.id} value={i} className="bg-white text-slate-900">
                          {i + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-black leading-snug text-[#16263F] dark:text-slate-50">
                      {s.load.name}
                    </p>
                    <p
                      className={`mt-0.5 text-[11px] font-bold ${
                        done
                          ? "text-emerald-600 dark:text-emerald-400"
                          : s.total === 0
                            ? "text-slate-400"
                            : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {s.total === 0
                        ? "Sin RA todavía"
                        : done
                          ? "Todo inventariado"
                          : `${s.notInventoried} de ${s.total} sin inventariar`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={busy || index === 0}
                      onClick={() => moveLoadTo(index, 0)}
                      className="hidden rounded-lg border border-slate-200 px-2 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-30 sm:inline-flex sm:items-center sm:gap-1 dark:border-slate-700 dark:hover:bg-slate-800"
                      title="Poner primero"
                    >
                      <ChevronsUp className="h-3.5 w-3.5" />
                      Primero
                    </button>
                    <button
                      type="button"
                      disabled={busy || index === 0}
                      onClick={() => moveLoadTo(index, index - 1)}
                      className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-30 dark:border-slate-700 dark:hover:bg-slate-800"
                      aria-label="Subir"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={busy || index === openSummaries.length - 1}
                      onClick={() => moveLoadTo(index, index + 1)}
                      className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:opacity-30 dark:border-slate-700 dark:hover:bg-slate-800"
                      aria-label="Bajar"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setOrderingLoads(false)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-[11px] font-black uppercase tracking-wide text-white shadow-sm"
            >
              <Check className="h-4 w-4" />
              Listo
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-x-4 gap-y-5 px-2 pb-2 pt-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((s, index) => {
            const done = s.total > 0 && s.notInventoried === 0;
            const isOpenLoad = s.load.status === "open";
            const isFirst = isOpenLoad && s.load.id === firstToDoId;
            const showOrder = isOpenLoad && openSummaries.length > 1;
            return (
              <div
                key={s.load.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(s.load.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedId(s.load.id);
                  }
                }}
                className={`group relative flex cursor-pointer items-center gap-4 rounded-2xl border bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-900 ${
                  isFirst
                    ? "border-blue-300 ring-2 ring-blue-400/30 dark:border-blue-800"
                    : "border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600"
                }`}
              >
                {showOrder ? (
                  <span
                    className={`absolute -left-2 -top-2 flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-black tabular-nums shadow-sm ring-2 ring-white dark:ring-slate-950 ${
                      done
                        ? "bg-emerald-500 text-white"
                        : isFirst
                          ? "bg-blue-600 text-white"
                          : "bg-[#16263F] text-white dark:bg-slate-600"
                    }`}
                    title={`Orden de trabajo: ${index + 1}`}
                  >
                    {index + 1}
                  </span>
                ) : null}
                <ProgressRing summary={s} />
                <div className="min-w-0 flex-1">
                  {isFirst && openSummaries.length > 1 ? (
                    <p className="mb-0.5 text-[10px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-400">
                      Hacer primero
                    </p>
                  ) : null}
                  <h3 className="break-words text-base font-black leading-snug text-[#16263F] dark:text-slate-50">
                    {s.load.name}
                  </h3>
                  {s.total === 0 ? (
                    <p className="mt-1 text-xs font-semibold text-slate-400">Sin RA todavía</p>
                  ) : done ? (
                    <p className="mt-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      Todo inventariado
                    </p>
                  ) : (
                    <p className="mt-1 text-xs font-bold text-red-600 dark:text-red-400">
                      {s.notInventoried} sin inventariar
                    </p>
                  )}
                  {s.load.status === "open" && s.nextRa ? (
                    <p className="mt-2 inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      Siguiente
                      <span className="font-black text-[#16263F] dark:text-slate-100">
                        RA {s.nextRa}
                      </span>
                    </p>
                  ) : null}
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
