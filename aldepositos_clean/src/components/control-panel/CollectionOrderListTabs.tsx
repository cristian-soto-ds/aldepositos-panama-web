"use client";

import React from "react";
import { CircleOff, Link2, Package, Warehouse } from "lucide-react";
import type { CollectionOrderListTab } from "@/lib/collectionOrderListTabs";

type CollectionOrderListTabsProps = {
  active: CollectionOrderListTab;
  generalCount: number;
  warehouseCount: number;
  linkedRaCount: number;
  noInventoryCount: number;
  onChange: (tab: CollectionOrderListTab) => void;
};

const tabBase =
  "inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[9px] font-black uppercase tracking-wide transition sm:flex-none sm:gap-2 sm:rounded-xl sm:px-4 sm:py-2.5 sm:text-[10px] sm:tracking-widest";

export function CollectionOrderListTabs({
  active,
  generalCount,
  warehouseCount,
  linkedRaCount,
  noInventoryCount,
  onChange,
}: CollectionOrderListTabsProps) {
  return (
    <div className="mb-2 grid grid-cols-4 gap-1 sm:mb-4 sm:flex sm:flex-wrap sm:gap-2">
      <button
        type="button"
        onClick={() => onChange("general")}
        className={`${tabBase} ${
          active === "general"
            ? "bg-[#16263F] text-white shadow-md"
            : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        }`}
      >
        <Package className="hidden h-3.5 w-3.5 shrink-0 sm:block sm:h-4 sm:w-4" aria-hidden />
        <span className="truncate sm:hidden">Recepción</span>
        <span className="hidden truncate sm:inline">En recepción</span>
        <span
          className={`shrink-0 rounded-full px-1 py-0.5 text-[8px] tabular-nums sm:px-2 sm:text-[9px] ${
            active === "general" ? "bg-white/20" : "bg-slate-100 dark:bg-slate-800"
          }`}
        >
          {generalCount}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onChange("warehouse")}
        className={`${tabBase} ${
          active === "warehouse"
            ? "bg-emerald-700 text-white shadow-md"
            : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        }`}
      >
        <Warehouse className="hidden h-3.5 w-3.5 shrink-0 sm:block sm:h-4 sm:w-4" aria-hidden />
        <span className="truncate sm:hidden">Bodega</span>
        <span className="hidden truncate sm:inline">En bodega</span>
        <span
          className={`shrink-0 rounded-full px-1 py-0.5 text-[8px] tabular-nums sm:px-2 sm:text-[9px] ${
            active === "warehouse" ? "bg-white/20" : "bg-slate-100 dark:bg-slate-800"
          }`}
        >
          {warehouseCount}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onChange("linkedRa")}
        className={`${tabBase} ${
          active === "linkedRa"
            ? "bg-blue-700 text-white shadow-md"
            : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        }`}
      >
        <Link2 className="hidden h-3.5 w-3.5 shrink-0 sm:block sm:h-4 sm:w-4" aria-hidden />
        <span className="truncate">Con RA</span>
        <span
          className={`shrink-0 rounded-full px-1 py-0.5 text-[8px] tabular-nums sm:px-2 sm:text-[9px] ${
            active === "linkedRa" ? "bg-white/20" : "bg-slate-100 dark:bg-slate-800"
          }`}
        >
          {linkedRaCount}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onChange("noInventory")}
        className={`${tabBase} ${
          active === "noInventory"
            ? "bg-amber-700 text-white shadow-md"
            : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        }`}
      >
        <CircleOff className="hidden h-3.5 w-3.5 shrink-0 sm:block sm:h-4 sm:w-4" aria-hidden />
        <span className="truncate max-sm:text-[8px]">Sin inventario</span>
        <span
          className={`shrink-0 rounded-full px-1 py-0.5 text-[8px] tabular-nums sm:px-2 sm:text-[9px] ${
            active === "noInventory" ? "bg-white/20" : "bg-slate-100 dark:bg-slate-800"
          }`}
        >
          {noInventoryCount}
        </span>
      </button>
    </div>
  );
}
