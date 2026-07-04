"use client";

import React, { useEffect, useState } from "react";
import { Cloud, CloudOff, Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { formatRelativeTime } from "@/lib/relativeTime";

export type AutosaveState =
  | "idle"
  | "saving"
  | "saved"
  | "error"
  | "retrying"
  | "offline";

export type SyncStatus = {
  state: AutosaveState;
  lastSavedAt: number | null;
  pendingCount: number;
  isOnline: boolean;
};

/**
 * Indicador de sincronización: estado del guardado, hora de la última
 * confirmación del servidor, conexión (online/offline) y cambios en cola.
 */
export function SyncStatusBadge({
  status,
  className = "",
}: {
  status: SyncStatus;
  className?: string;
}) {
  const { state, lastSavedAt, pendingCount, isOnline } = status;
  // Re-render periódico para refrescar el "hace X" sin depender del padre.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceTick((v) => v + 1), 15000);
    return () => clearInterval(id);
  }, []);

  const offline = !isOnline || state === "offline";
  const savedAgo = formatRelativeTime(lastSavedAt);

  let tone: string;
  let icon: React.ReactNode;
  let label: string;

  if (offline) {
    tone =
      "border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300";
    icon = <WifiOff className="icon-sm" />;
    label = "Sin conexión";
  } else if (state === "saving") {
    tone =
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200";
    icon = <Loader2 className="icon-sm animate-spin" />;
    label = "Guardando…";
  } else if (state === "retrying") {
    tone =
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200";
    icon = <RefreshCw className="icon-sm animate-spin" />;
    label = "Reintentando…";
  } else if (state === "error") {
    tone =
      "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200";
    icon = <CloudOff className="icon-sm" />;
    label = "Error al guardar";
  } else if (pendingCount > 0) {
    tone =
      "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300";
    icon = <Cloud className="icon-sm" />;
    label = "Sin guardar";
  } else {
    tone =
      "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200";
    icon = <Cloud className="icon-sm" />;
    label = savedAgo ? `Guardado ${savedAgo}` : "Guardado";
  }

  const title = offline
    ? "Sin conexión: los cambios se guardarán al reconectar"
    : savedAgo
      ? `Última sincronización ${savedAgo}`
      : label;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-xl border px-2.5 py-2 text-[11px] font-semibold sm:gap-1.5 sm:px-3 sm:text-xs ${tone} ${className}`}
      title={title}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      {pendingCount > 0 && !offline ? (
        <span className="ml-0.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-black/10 px-1 text-[10px] font-bold tabular-nums dark:bg-white/10">
          {pendingCount}
        </span>
      ) : null}
      {isOnline ? (
        <Wifi className="hidden h-3 w-3 text-emerald-500 sm:inline" />
      ) : null}
    </span>
  );
}
