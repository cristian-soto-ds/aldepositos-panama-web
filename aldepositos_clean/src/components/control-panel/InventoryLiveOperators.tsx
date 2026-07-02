"use client";

import React from "react";
import { UserRound } from "lucide-react";
import {
  PRESENCE_MODULE_LABELS,
  type LiveOperatorOnRa,
} from "@/lib/presenceByRa";

type InventoryLiveOperatorsProps = {
  operators: LiveOperatorOnRa[];
};

function operatorSubtitle(op: LiveOperatorOnRa): string {
  const key = String(op.userKey ?? "").trim();
  if (key.includes("@")) return key;
  return PRESENCE_MODULE_LABELS[op.module];
}

export function InventoryLiveOperators({ operators }: InventoryLiveOperatorsProps) {
  if (operators.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">
        En línea ahora
      </p>
      <div className="flex flex-col gap-1.5">
        {operators.map((op) => (
          <div
            key={`${op.userKey}-${op.module}`}
            className="flex items-center gap-2.5 rounded-2xl border border-slate-200/90 bg-slate-50/95 p-2 dark:border-slate-600/80 dark:bg-slate-800/50 sm:gap-3 sm:p-2.5"
            title={`${op.name} · ${PRESENCE_MODULE_LABELS[op.module]}`}
          >
            <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full border border-slate-200/90 bg-white dark:border-slate-600 dark:bg-slate-900 sm:h-10 sm:w-10">
              {op.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={op.avatarUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-slate-400 dark:text-slate-500">
                  <UserRound className="h-4 w-4 sm:h-[18px] sm:w-[18px]" aria-hidden />
                </div>
              )}
              <span
                className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-slate-50 bg-emerald-500 dark:border-slate-800"
                aria-hidden
              />
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-black text-[#16263F] dark:text-slate-100 sm:text-xs">
                {op.name}
              </p>
              <p className="truncate text-[10px] font-semibold text-slate-500 dark:text-slate-400 sm:text-[11px]">
                {operatorSubtitle(op)}
              </p>
            </div>

            <span className="shrink-0 rounded-xl border border-slate-200/90 bg-white px-2 py-1 text-[8px] font-black uppercase tracking-wide text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 sm:text-[9px]">
              {PRESENCE_MODULE_LABELS[op.module]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
