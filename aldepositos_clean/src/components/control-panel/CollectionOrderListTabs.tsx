"use client";

import React from "react";
import { Package, Warehouse } from "lucide-react";
import type { CollectionOrderListTab } from "@/lib/collectionOrderListTabs";

type CollectionOrderListTabsProps = {
  active: CollectionOrderListTab;
  generalCount: number;
  warehouseCount: number;
  onChange: (tab: CollectionOrderListTab) => void;
};

export function CollectionOrderListTabs({
  active,
  generalCount,
  warehouseCount,
  onChange,
}: CollectionOrderListTabsProps) {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onChange("general")}
        className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition ${
          active === "general"
            ? "bg-[#16263F] text-white shadow-md"
            : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        }`}
      >
        <Package className="h-4 w-4" aria-hidden />
        En recepción
        <span
          className={`rounded-full px-2 py-0.5 text-[9px] tabular-nums ${
            active === "general" ? "bg-white/20" : "bg-slate-100 dark:bg-slate-800"
          }`}
        >
          {generalCount}
        </span>
      </button>
      <button
        type="button"
        onClick={() => onChange("warehouse")}
        className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition ${
          active === "warehouse"
            ? "bg-emerald-700 text-white shadow-md"
            : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        }`}
      >
        <Warehouse className="h-4 w-4" aria-hidden />
        En bodega
        <span
          className={`rounded-full px-2 py-0.5 text-[9px] tabular-nums ${
            active === "warehouse" ? "bg-white/20" : "bg-slate-100 dark:bg-slate-800"
          }`}
        >
          {warehouseCount}
        </span>
      </button>
    </div>
  );
}
