"use client";

import React, { memo } from "react";
import {
  ArrowRight,
  Clock,
  Edit,
  Trash2,
} from "lucide-react";
import { InventoryLiveOperators } from "@/components/control-panel/InventoryLiveOperators";
import {
  resolveActiveInventoryOperatorLabel,
  resolveInventoryActivityAt,
  resolveLiveInventoryOperator,
  resolvePausedInventoryOperatorLabel,
} from "@/lib/inventoryOperatorsAllowlist";
import { inventoryCompletedByLabel } from "@/lib/taskContributors";
import { formatRaFieldLabel } from "@/lib/collectionOrderToTask";
import { formatRelativeTime } from "@/lib/relativeTime";
import type { LiveOperatorOnRa } from "@/lib/presenceByRa";
import type { Task } from "@/lib/types/task";

export type RaTaskCardProps = {
  task: Task;
  viewMode: "pending" | "completed" | "priority";
  liveWorkers: LiveOperatorOnRa[];
  /** Epoch ms del reloj compartido (fuerza refresh de "hace X"). */
  nowMs: number;
  onSelect: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (taskId: string) => void;
};

function LastUpdatedLabel({
  at,
  nowMs,
}: {
  at?: string;
  nowMs: number;
}) {
  const rel = formatRelativeTime(at, nowMs);
  if (!rel) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 text-[9px] font-medium text-slate-400 dark:text-slate-500 sm:gap-1 sm:text-[10px]"
      title={`Última actualización ${rel}`}
    >
      <Clock className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
      {rel}
    </span>
  );
}

function RaTaskCardInner({
  task: t,
  viewMode,
  liveWorkers,
  nowMs,
  onSelect,
  onEdit,
  onDelete,
}: RaTaskCardProps) {
  const liveOp = resolveLiveInventoryOperator(liveWorkers);
  const activeInventariador = resolveActiveInventoryOperatorLabel(t, liveWorkers);
  const pausedInventariador = resolvePausedInventoryOperatorLabel(t);
  const completedBy = inventoryCompletedByLabel(t);
  const showPaused = t.status === "paused" && !liveOp && !!pausedInventariador;
  const providerLabel = formatRaFieldLabel(t.provider);
  const brandLabel = formatRaFieldLabel(t.brand);
  const expected = t.expectedBultos > 0 ? t.expectedBultos : 0;
  const captured = Math.max(0, t.currentBultos || 0);
  const showCaptureProgress = captured > 0 || (t.completeRowCount ?? 0) > 0;
  const capturedWeight = t.capturedWeight ?? 0;
  const bultosLabel = showCaptureProgress
    ? expected > 0
      ? `${captured}/${expected}`
      : String(captured)
    : expected > 0
      ? String(expected)
      : "—";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(t)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(t);
        }
      }}
      className={`group flex cursor-pointer flex-col gap-1.5 rounded-xl border px-3 py-2.5 shadow-sm transition-all hover:border-blue-200 hover:shadow-md dark:hover:border-blue-800 sm:gap-2 sm:rounded-xl sm:p-4 ${
        viewMode === "priority"
          ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20"
          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
      }`}
    >
      <div className="flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5 sm:gap-2">
          <h3
            className={`shrink-0 text-sm font-black tabular-nums leading-none sm:text-xl ${
              viewMode === "priority"
                ? "text-red-700 dark:text-red-300"
                : "text-[#16263F] dark:text-slate-100"
            }`}
          >
            RA {t.ra}
          </h3>
          {showPaused ? (
            <span
              className="max-w-[9.5rem] truncate rounded-full bg-slate-200 px-1.5 py-px text-[8px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200 sm:max-w-none sm:px-2 sm:py-0.5 sm:text-[9px]"
              title={`Inventario en pausa · ${pausedInventariador}`}
            >
              En pausa · {pausedInventariador}
            </span>
          ) : activeInventariador ? (
            <span
              className="max-w-[9.5rem] truncate rounded-full bg-amber-100 px-1.5 py-px text-[8px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200 sm:max-w-none sm:px-2 sm:py-0.5 sm:text-[9px]"
              title={`Inventario en curso por ${activeInventariador}`}
            >
              En curso · {activeInventariador}
            </span>
          ) : null}
          {viewMode === "completed" && completedBy ? (
            <span
              className="max-w-[9.5rem] truncate rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[8px] font-semibold text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200 sm:max-w-none sm:px-2 sm:py-0.5 sm:text-[9px]"
              title="Inventariador que capturó medidas y peso"
            >
              Por {completedBy}
            </span>
          ) : null}
          <LastUpdatedLabel at={resolveInventoryActivityAt(t)} nowMs={nowMs} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div
            className={`flex min-w-[3.25rem] flex-col items-center rounded-md border px-1.5 py-0.5 text-center sm:min-w-0 sm:rounded-lg sm:px-3 sm:py-1 ${
              viewMode === "priority"
                ? "border-red-200 bg-red-100 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
                : "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200"
            }`}
            title={
              showCaptureProgress
                ? `Capturados ${captured} de ${expected || "—"} bultos${
                    capturedWeight > 0 ? ` · ${capturedWeight} kg` : ""
                  }${
                    (t.completeRowCount ?? 0) > 0
                      ? ` · ${t.completeRowCount}/${t.rowCount ?? t.completeRowCount} líneas`
                      : ""
                  }`
                : "Bultos declarados"
            }
          >
            <span className="text-[7px] font-semibold leading-none sm:text-[9px]">
              Bultos
            </span>
            <span className="text-sm font-bold tabular-nums leading-tight sm:text-lg">
              {bultosLabel}
            </span>
            {capturedWeight > 0 ? (
              <span className="text-[8px] font-semibold tabular-nums leading-none text-current/80 sm:text-[9px]">
                {capturedWeight} kg
              </span>
            ) : null}
          </div>
          <div
            className="flex shrink-0 items-center sm:hidden"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(t);
              }}
              title={viewMode === "completed" ? "Editar medidas" : "Editar orden"}
              className="flex items-center justify-center rounded-md p-1 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950/45"
            >
              <Edit className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(t.id);
              }}
              className="flex items-center justify-center rounded-md p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
      <InventoryLiveOperators operators={liveWorkers} />

      {/* Móvil: proveedor · marca en una sola línea */}
      <p className="truncate text-[11px] font-semibold leading-tight text-[#16263F] dark:text-slate-100 sm:hidden">
        <span className="font-medium text-slate-400 dark:text-slate-500">
          Prov.{" "}
        </span>
        {providerLabel}
        <span className="mx-1 font-normal text-slate-300 dark:text-slate-600">
          ·
        </span>
        <span className="font-medium text-slate-400 dark:text-slate-500">
          Marca{" "}
        </span>
        {brandLabel}
      </p>

      {/* Desktop / tablet: layout original con acciones */}
      <div
        className="hidden items-center justify-between gap-2 border-t border-slate-100 pt-2 dark:border-slate-700 sm:flex"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
              Proveedor
            </p>
            <p className="truncate text-sm font-semibold text-[#16263F] dark:text-slate-100">
              {providerLabel}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
              Marca
            </p>
            <p className="truncate text-sm font-semibold text-[#16263F] dark:text-slate-100">
              {brandLabel}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(t);
            }}
            title={viewMode === "completed" ? "Editar medidas" : "Editar orden"}
            className="flex items-center justify-center rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950/45"
          >
            <Edit className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(t.id);
            }}
            className="flex items-center justify-center rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <span className="flex items-center justify-center rounded-lg bg-slate-50 p-1.5 text-slate-400 group-hover:text-blue-500 dark:bg-slate-800/60">
            <ArrowRight className="h-4 w-4" />
          </span>
        </div>
      </div>
    </div>
  );
}

function liveWorkersKey(ops: LiveOperatorOnRa[]): string {
  if (ops.length === 0) return "";
  return ops.map((o) => `${o.userKey}:${o.module}:${o.avatarUrl ?? ""}`).join("|");
}

export const RaTaskCard = memo(RaTaskCardInner, (prev, next) => {
  return (
    prev.task === next.task &&
    prev.viewMode === next.viewMode &&
    prev.nowMs === next.nowMs &&
    prev.onSelect === next.onSelect &&
    prev.onEdit === next.onEdit &&
    prev.onDelete === next.onDelete &&
    liveWorkersKey(prev.liveWorkers) === liveWorkersKey(next.liveWorkers)
  );
});
