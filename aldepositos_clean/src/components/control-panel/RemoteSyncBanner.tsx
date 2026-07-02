"use client";

import { RefreshCw } from "lucide-react";

type RemoteSyncBannerProps = {
  onApply: () => void;
};

export function RemoteSyncBanner({ onApply }: RemoteSyncBannerProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <span>Otro operador guardó cambios. Actualizá para verlos en vivo.</span>
      <button
        type="button"
        onClick={onApply}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 font-semibold text-amber-900 transition hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/60 dark:hover:bg-amber-900/50"
      >
        <RefreshCw className="icon-sm" />
        Ver cambios
      </button>
    </div>
  );
}
