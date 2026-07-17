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
      className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-slate-400 dark:text-slate-500"
      title={`Última actualización ${rel}`}
    >
      <Clock className="h-3 w-3" />
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
      className={`group flex cursor-pointer flex-col gap-2 rounded-xl border p-3 shadow-sm transition-all hover:border-blue-200 hover:shadow-md dark:hover:border-blue-800 sm:p-4 ${
        viewMode === "priority"
          ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20"
          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <h3
            className={`shrink-0 text-lg font-black tabular-nums leading-none sm:text-xl ${
              viewMode === "priority"
                ? "text-red-700 dark:text-red-300"
                : "text-[#16263F] dark:text-slate-100"
            }`}
          >
            RA {t.ra}
          </h3>
          {showPaused ? (
            <span
              className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[9px] font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200"
              title={`Inventario en pausa · ${pausedInventariador}`}
            >
              En pausa · {pausedInventariador}
            </span>
          ) : activeInventariador ? (
            <span
              className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
              title={`Inventario en curso por ${activeInventariador}`}
            >
              En curso · {activeInventariador}
            </span>
          ) : null}
          {viewMode === "completed" && completedBy ? (
            <span
              className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200"
              title="Inventariador que capturó medidas y peso"
            >
              Por {completedBy}
            </span>
          ) : null}
          <LastUpdatedLabel at={t.updatedAt} nowMs={nowMs} />
        </div>
        <div
          className={`flex shrink-0 flex-col items-center rounded-lg border px-3 py-1 text-center ${
            viewMode === "priority"
              ? "border-red-200 bg-red-100 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
              : "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200"
          }`}
        >
          <span className="text-[9px] font-semibold leading-none">Bultos</span>
          <span className="text-lg font-bold tabular-nums leading-tight">
            {t.expectedBultos > 0 ? t.expectedBultos : "—"}
          </span>
        </div>
      </div>

      <InventoryLiveOperators operators={liveWorkers} />

      <div
        className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2 dark:border-slate-700"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-1 sm:grid-cols-2 sm:gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
              Proveedor
            </p>
            <p className="truncate text-xs font-semibold text-[#16263F] dark:text-slate-100 sm:text-sm">
              {formatRaFieldLabel(t.provider)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
              Marca
            </p>
            <p className="truncate text-xs font-semibold text-[#16263F] dark:text-slate-100 sm:text-sm">
              {formatRaFieldLabel(t.brand)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
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
          <span className="hidden items-center justify-center rounded-lg bg-slate-50 p-1.5 text-slate-400 group-hover:text-blue-500 sm:flex dark:bg-slate-800/60">
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
