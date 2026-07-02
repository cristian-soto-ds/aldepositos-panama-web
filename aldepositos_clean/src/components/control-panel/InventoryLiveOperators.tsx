"use client";

import React from "react";
import { UserRound } from "lucide-react";
import {
  PRESENCE_MODULE_LABELS,
  type LiveOperatorOnRa,
} from "@/lib/presenceByRa";

type InventoryLiveOperatorsProps = {
  operators: LiveOperatorOnRa[];
  /** Fila compacta dentro de la tarjeta de lista. */
  compact?: boolean;
};

export function InventoryLiveOperators({
  operators,
  compact = false,
}: InventoryLiveOperatorsProps) {
  if (operators.length === 0) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 border border-sky-200/90 bg-sky-50/90 dark:border-sky-800/50 dark:bg-sky-950/30 ${
        compact ? "rounded-lg px-2 py-1.5" : "rounded-xl px-2.5 py-2"
      }`}
      title={operators
        .map((op) => `${op.name} (${PRESENCE_MODULE_LABELS[op.module]})`)
        .join(", ")}
    >
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-sky-700 dark:text-sky-300">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-500 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
        </span>
        En línea
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        {operators.map((op) => (
          <span
            key={`${op.userKey}-${op.module}`}
            className="inline-flex max-w-full items-center gap-1 text-[10px] font-bold text-sky-950 dark:text-sky-100 sm:text-[11px]"
          >
            {op.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={op.avatarUrl}
                alt=""
                className="h-4 w-4 shrink-0 rounded-full object-cover ring-1 ring-sky-200"
              />
            ) : (
              <UserRound className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-hidden />
            )}
            <span className="truncate">{op.name}</span>
            <span className="shrink-0 font-semibold text-sky-600/90 dark:text-sky-400">
              ({PRESENCE_MODULE_LABELS[op.module]})
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
