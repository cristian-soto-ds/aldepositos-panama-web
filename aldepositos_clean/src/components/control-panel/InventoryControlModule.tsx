"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Keyboard,
  Loader2,
  PauseCircle,
  Play,
  Ruler,
  X,
} from "lucide-react";
import type { Task } from "@/lib/types/task";
import { releaseInventoryPause } from "@/lib/inventorySessionTiming";
import { resolvePausedInventoryOperatorLabel } from "@/lib/inventoryOperatorsAllowlist";
import { INVENTARIADORES } from "@/lib/inventariadoresRoster";
import {
  fetchInventoryControlSettings,
  setKeyboardOperatorEnabled,
  subscribeInventoryControlSettings,
  type InventoryControlSettings,
  defaultInventoryControlSettings,
} from "@/lib/inventoryControlSettings";
import { formatRaFieldLabel } from "@/lib/collectionOrderToTask";

type InventoryControlModuleProps = {
  tasks: Task[];
  onUpdateTask: (task: Task) => void | Promise<void>;
};

function formatRelative(iso: string | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffSec < 60) return "hace un momento";
  const min = Math.round(diffSec / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} d`;
}

function ResumeAllConfirmModal({
  open,
  count,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  count: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay flex items-end justify-center bg-slate-900/55 backdrop-blur-[2px] sm:items-center"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-all-title"
        className="modal-panel w-full max-w-md overflow-hidden border border-slate-200 bg-white shadow-2xl dark:border-slate-600 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-teal-50 px-5 py-4 dark:border-slate-700 dark:from-emerald-950/40 dark:to-teal-950/30">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/30">
              <Play className="h-5 w-5" strokeWidth={2.5} aria-hidden />
            </div>
            <div>
              <h2
                id="resume-all-title"
                className="text-base font-black uppercase tracking-wide text-[#16263F] dark:text-slate-100"
              >
                Quitar todas las pausas
              </h2>
              <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Quedarán libres, sin badge En curso (como un RA pendiente).
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-white/80 disabled:opacity-50 dark:hover:bg-slate-800"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-5">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            ¿Quitar la pausa de{" "}
            <span className="font-black text-[#16263F] dark:text-white">{count}</span>{" "}
            inventario{count === 1 ? "" : "s"}?
          </p>
        </div>

        <div className="flex gap-2 border-t border-slate-100 bg-slate-50/80 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/50">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="flex-1 rounded-xl border-2 border-slate-200 bg-white py-3 text-xs font-black uppercase tracking-wider text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 py-3 text-xs font-black uppercase tracking-wider text-white shadow-md shadow-emerald-600/25 transition hover:from-emerald-700 hover:to-teal-700 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

export function InventoryControlModule({
  tasks,
  onUpdateTask,
}: InventoryControlModuleProps) {
  const [settings, setSettings] = useState<InventoryControlSettings>(
    defaultInventoryControlSettings,
  );
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [resumeAllOpen, setResumeAllOpen] = useState(false);
  const [resumeAllBusy, setResumeAllBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const reloadSettings = useCallback(async () => {
    const next = await fetchInventoryControlSettings();
    setSettings(next);
    setSettingsLoading(false);
  }, []);

  useEffect(() => {
    void reloadSettings();
    return subscribeInventoryControlSettings(() => {
      void reloadSettings();
    });
  }, [reloadSettings]);

  const pausedTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.status === "paused" && !t.dispatched)
        .slice()
        .sort((a, b) => {
          const ta = a.inventoryPausedAt ?? a.updatedAt ?? "";
          const tb = b.inventoryPausedAt ?? b.updatedAt ?? "";
          return tb.localeCompare(ta);
        }),
    [tasks],
  );

  const handleResumeOne = async (task: Task) => {
    setActionError(null);
    setResumingId(task.id);
    try {
      const next = releaseInventoryPause(task);
      await Promise.resolve(onUpdateTask(next));
    } catch (e) {
      console.error(e);
      setActionError("No se pudo quitar la pausa. Revisá la conexión e intentá de nuevo.");
    } finally {
      setResumingId(null);
    }
  };

  const handleResumeAll = async () => {
    setActionError(null);
    setResumeAllBusy(true);
    try {
      for (const task of pausedTasks) {
        const next = releaseInventoryPause(task);
        await Promise.resolve(onUpdateTask(next));
      }
      setResumeAllOpen(false);
    } catch (e) {
      console.error(e);
      setActionError("Algunas pausas no se pudieron quitar. Revisá Supabase.");
    } finally {
      setResumeAllBusy(false);
    }
  };

  const handleToggleKeyboard = async (operatorId: string, enabled: boolean) => {
    setActionError(null);
    setTogglingId(operatorId);
    try {
      const next = await setKeyboardOperatorEnabled(operatorId, enabled);
      setSettings(next);
    } catch (e) {
      console.error(e);
      setActionError("No se pudo guardar el permiso de teclado.");
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-1 flex-col gap-4 overflow-y-auto px-2 py-3 sm:px-3 md:px-0 md:py-6">
      <header className="shrink-0 rounded-2xl border border-indigo-300/70 bg-gradient-to-r from-[#1e2a5a] via-[#24356d] to-[#1e4f86] p-4 text-white shadow-xl shadow-indigo-500/20 sm:rounded-3xl sm:p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15">
            <PauseCircle className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-black uppercase tracking-tight sm:text-2xl">
              Control de inventarios
            </h1>
            <p className="mt-0.5 text-sm font-medium text-indigo-100/90">
              Quitá pausas y habilitá teclado cuando la cinta no esté disponible.
            </p>
          </div>
        </div>
      </header>

      {actionError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
          {actionError}
        </div>
      ) : null}

      {/* Pausas */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-black uppercase tracking-wider text-[#16263F] dark:text-slate-100">
              Inventarios en pausa
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {pausedTasks.length} RA{pausedTasks.length === 1 ? "" : "s"} pausada
              {pausedTasks.length === 1 ? "" : "s"}
            </p>
          </div>
          {pausedTasks.length > 0 ? (
            <button
              type="button"
              onClick={() => setResumeAllOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
            >
              <Play className="h-3.5 w-3.5" />
              Quitar todas
            </button>
          ) : null}
        </div>

        {pausedTasks.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-slate-200 px-4 py-10 text-center dark:border-slate-700">
            <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
              No hay inventarios en pausa.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {pausedTasks.map((t) => {
              const who = resolvePausedInventoryOperatorLabel(t);
              const busy = resumingId === t.id;
              return (
                <li
                  key={t.id}
                  className="flex flex-col gap-2 rounded-xl border border-amber-200/80 bg-amber-50/40 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/40 dark:bg-amber-950/20"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-[#16263F] dark:text-slate-100">
                      RA {t.ra || "—"}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-600 dark:text-slate-300">
                      {formatRaFieldLabel(t.mainClient)} · {formatRaFieldLabel(t.brand)}
                    </p>
                    <p className="mt-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                      {who ? `En pausa — ${who}` : "En pausa"}
                      {" · "}
                      {formatRelative(t.inventoryPausedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleResumeOne(t)}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    Quitar pausa
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Teclado */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5">
        <div className="mb-1 flex items-center gap-2">
          <Keyboard className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          <h2 className="text-sm font-black uppercase tracking-wider text-[#16263F] dark:text-slate-100">
            Medidas con teclado
          </h2>
        </div>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          Activá inventariadores que puedan escribir Largo / Ancho / Alto con el teclado del
          celular (sin cinta Reekon). El resto sigue con cinta.
        </p>

        {settingsLoading ? (
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando permisos…
          </p>
        ) : (
          <ul className="space-y-2">
            {INVENTARIADORES.map((op) => {
              const enabled = settings.keyboardOperatorIds.includes(op.id);
              const busy = togglingId === op.id;
              return (
                <li
                  key={op.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3 dark:border-slate-600 dark:bg-slate-800/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-[#16263F] dark:text-slate-100">
                      {op.name}
                    </p>
                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      {enabled ? (
                        <span className="inline-flex items-center gap-1 text-violet-700 dark:text-violet-300">
                          <Keyboard className="h-3 w-3" />
                          Puede teclear medidas
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Ruler className="h-3 w-3" />
                          Solo cinta Reekon
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    disabled={busy}
                    onClick={() => void handleToggleKeyboard(op.id, !enabled)}
                    className={`relative h-8 w-14 shrink-0 rounded-full transition disabled:opacity-50 ${
                      enabled ? "bg-violet-600" : "bg-slate-300 dark:bg-slate-600"
                    }`}
                  >
                    <span
                      className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${
                        enabled ? "left-7" : "left-1"
                      }`}
                    />
                    {busy ? (
                      <Loader2 className="absolute inset-0 m-auto h-3.5 w-3.5 animate-spin text-white" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ResumeAllConfirmModal
        open={resumeAllOpen}
        count={pausedTasks.length}
        busy={resumeAllBusy}
        onCancel={() => setResumeAllOpen(false)}
        onConfirm={() => void handleResumeAll()}
      />
    </div>
  );
}
