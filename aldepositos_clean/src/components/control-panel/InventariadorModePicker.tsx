"use client";

import { ArrowLeft, Boxes, FileText, Layers } from "lucide-react";
import type { ReferenceCaptureMode } from "@/lib/quickInventoryTypes";

const OPTIONS: {
  id: ReferenceCaptureMode;
  label: string;
  hint: string;
  icon: typeof FileText;
}[] = [
  {
    id: "with",
    label: "Con referencias",
    hint: "Usá las referencias del packing list o catálogo.",
    icon: FileText,
  },
  {
    id: "without",
    label: "Sin referencias",
    hint: "Numeración automática; solo medidas y peso.",
    icon: Boxes,
  },
  {
    id: "palletized",
    label: "Paletizado",
    hint: "Agrupá por paleta y peso de paleta.",
    icon: Layers,
  },
];

type InventariadorModePickerProps = {
  raLabel: string;
  onSelect: (mode: ReferenceCaptureMode) => void;
  onBack: () => void;
};

export function InventariadorModePicker({
  raLabel,
  onSelect,
  onBack,
}: InventariadorModePickerProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-3 dark:border-slate-700 dark:bg-slate-900">
        <button
          type="button"
          onClick={onBack}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-slate-800"
          aria-label="Volver"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-[#16263F] dark:text-slate-100">
            RA-{raLabel}
          </p>
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Elegí cómo vas a inventariar
          </p>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3 overflow-y-auto px-4 py-6">
        <p className="text-center text-sm text-slate-600 dark:text-slate-300">
          Esta elección queda fija para este RA. Las medidas se guardan solas
          mientras capturás.
        </p>
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
              className="flex w-full items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition active:scale-[0.99] dark:border-slate-600 dark:bg-slate-900"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#16263F] text-white">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-bold text-[#16263F] dark:text-slate-100">
                  {opt.label}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                  {opt.hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
