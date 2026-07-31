"use client";

import { ArrowLeft, Boxes, FileText, Layers, Package } from "lucide-react";
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
    hint: "Trabajá con las referencias del pedido (las que ves arriba).",
    icon: FileText,
  },
  {
    id: "without",
    label: "Sin referencias",
    hint: "Si en el bulto físico no viene la etiqueta/código: numeración automática y solo medidas/peso.",
    icon: Boxes,
  },
  {
    id: "palletized",
    label: "Paletizado",
    hint: "Agrupá por paleta y peso de paleta (aunque hayas visto refs arriba).",
    icon: Layers,
  },
];

export type ModePickerPreviewRow = {
  id: string;
  referencia?: string;
  descripcion?: string;
  bultos?: string | number;
  reempaque?: boolean;
};

type InventariadorModePickerProps = {
  raLabel: string;
  /** Referencias ya cargadas (p. ej. desde la OR) para verlas antes de elegir modo. */
  previewRows?: ModePickerPreviewRow[];
  onSelect: (mode: ReferenceCaptureMode) => void;
  onBack: () => void;
};

function previewLabel(row: ModePickerPreviewRow, index: number): string {
  const ref = String(row.referencia ?? "").trim();
  if (ref) return ref;
  return `Línea ${index + 1}`;
}

export function InventariadorModePicker({
  raLabel,
  previewRows = [],
  onSelect,
  onBack,
}: InventariadorModePickerProps) {
  const refs = previewRows.filter((r) => {
    const ref = String(r.referencia ?? "").trim();
    const desc = String(r.descripcion ?? "").trim();
    const bultos = String(r.bultos ?? "").trim();
    return ref.length > 0 || desc.length > 0 || bultos.length > 0 || r.reempaque === true;
  });
  const hasRefs = refs.length > 0;

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
            Revisá las referencias y elegí cómo inventariar
          </p>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-[#16263F] dark:text-slate-200" />
              <p className="text-xs font-black uppercase tracking-wide text-[#16263F] dark:text-slate-100">
                Referencias del pedido
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {hasRefs ? refs.length : 0}
            </span>
          </div>

          {hasRefs ? (
            <ul className="max-h-[40vh] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
              {refs.map((row, index) => {
                const desc = String(row.descripcion ?? "").trim();
                const bultos = String(row.bultos ?? "").trim();
                return (
                  <li
                    key={row.id || `ref-${index}`}
                    className="flex items-start justify-between gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-[#16263F] dark:text-slate-100">
                        {previewLabel(row, index)}
                        {row.reempaque ? (
                          <span className="ml-1.5 text-[10px] font-semibold text-slate-400">
                            reempaque
                          </span>
                        ) : null}
                      </p>
                      {desc ? (
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">
                          {desc}
                        </p>
                      ) : null}
                    </div>
                    {bultos ? (
                      <span className="shrink-0 rounded-lg bg-violet-50 px-2 py-1 text-[10px] font-black tabular-nums text-violet-800 dark:bg-violet-950/50 dark:text-violet-200">
                        {bultos} bulto{bultos === "1" ? "" : "s"}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-3 py-4 text-center text-xs font-medium text-slate-500 dark:text-slate-400">
              Este RA aún no trae referencias cargadas. Podés inventariar sin
              ellas o con numeración automática.
            </p>
          )}
        </section>

        <p className="text-center text-[11px] text-slate-500 dark:text-slate-400">
          Elegí el tipo según lo que viste arriba. Queda fijo para este RA.
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
