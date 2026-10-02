"use client";

import React, { useState } from "react";
import { CheckCircle2, Edit3, X } from "lucide-react";
import { DEFAULT_NO_INVENTORY_REASON } from "@/lib/containerLoadStatus";
import type { ContainerLoadItem } from "@/lib/types/containerLoad";
import type { Task } from "@/lib/types/task";

type Props = {
  item: ContainerLoadItem | null;
  task: Task | null;
  busy: boolean;
  userEmail?: string | null;
  onClose: () => void;
  onSave: (next: ContainerLoadItem) => void;
};

const labelClass =
  "text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400";
const inputBase =
  "w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-[#16263F] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-100";

function parseAmount(raw: string): number | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}

const numText = (n: number | undefined) => (n != null ? String(n) : "");

export function ContainerLoadItemEditModal({
  item,
  task,
  busy,
  userEmail,
  onClose,
  onSave,
}: Props) {
  // Montado con `key` por RA: el formulario no se reinicia con los refrescos en vivo.
  const [cliente, setCliente] = useState(item?.cliente ?? "");
  const [proveedor, setProveedor] = useState(item?.proveedor ?? "");
  const [marca, setMarca] = useState(item?.marca ?? "");
  const [expedidor, setExpedidor] = useState(item?.expedidor ?? "");
  const [bultos, setBultos] = useState(numText(item?.bultos));
  const [cbm, setCbm] = useState(numText(item?.cbm));
  const [peso, setPeso] = useState(numText(item?.peso));
  const [notas, setNotas] = useState(
    [item?.seguimiento, item?.notas].filter(Boolean).join(" · "),
  );
  const [noInventory, setNoInventory] = useState(item?.noInventoryRequired === true);

  if (!item) return null;

  const taskCompleted = task?.status === "completed";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: ContainerLoadItem = {
      ...item,
      cliente: cliente.trim() || undefined,
      proveedor: proveedor.trim() || undefined,
      marca: marca.trim() || undefined,
      expedidor: expedidor.trim() || undefined,
      bultos: parseAmount(bultos),
      cbm: parseAmount(cbm),
      peso: parseAmount(peso),
      seguimiento: undefined,
      notas: notas.trim() || undefined,
      noInventoryRequired: noInventory || undefined,
      noInventoryReason: noInventory
        ? item.noInventoryReason || DEFAULT_NO_INVENTORY_REASON
        : undefined,
      noInventoryMarkedBy: noInventory
        ? item.noInventoryRequired
          ? item.noInventoryMarkedBy
          : userEmail?.toLowerCase() || undefined
        : undefined,
    };
    onSave(next);
  };

  return (
    <div className="modal-overlay flex animate-fade items-end justify-center bg-[#16263F]/60 backdrop-blur-sm sm:items-center">
      <div className="modal-panel flex w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 sm:rounded-[2rem]">
        <div className="flex shrink-0 items-center justify-between bg-[#16263F] p-5 text-white md:p-6">
          <h3 className="flex items-center gap-2 text-lg font-black tracking-tight md:gap-3 md:text-xl">
            <Edit3 className="icon-md text-blue-400" /> Editar RA
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-slate-400 transition-colors hover:text-white disabled:opacity-50"
            aria-label="Cerrar"
          >
            <X className="icon-lg" />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 space-y-4 overflow-y-auto p-5 md:p-8">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Número de RA">
              <input
                value={item.ra}
                readOnly
                className={`${inputBase} cursor-default font-bold text-slate-500 dark:text-slate-400`}
              />
            </Field>
            <Field label="Cliente / Consignatario">
              <input
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
                placeholder="Ej: LOGI TRADING"
                className={`${inputBase} font-bold`}
              />
            </Field>
            <Field label="Proveedor">
              <input
                value={proveedor}
                onChange={(e) => setProveedor(e.target.value)}
                placeholder="Nombre del proveedor"
                className={`${inputBase} text-sm`}
              />
            </Field>
            <Field label="Marca">
              <input
                value={marca}
                onChange={(e) => setMarca(e.target.value)}
                placeholder="Marca o # de seguimiento"
                className={`${inputBase} text-sm`}
              />
            </Field>
            <Field label="Expedidor">
              <input
                value={expedidor}
                onChange={(e) => setExpedidor(e.target.value)}
                placeholder="Ej: EFRAIN ROJAS"
                className={`${inputBase} text-sm`}
              />
            </Field>
            <Field label="Inventario">
              <button
                type="button"
                disabled={taskCompleted}
                onClick={() => setNoInventory((v) => !v)}
                className={`flex w-full items-center gap-2 rounded-xl border p-3 text-left text-sm font-bold transition disabled:opacity-50 ${
                  noInventory
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
                    : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
                }`}
              >
                <CheckCircle2
                  className={`h-4 w-4 shrink-0 ${noInventory ? "text-emerald-600" : "text-slate-300"}`}
                />
                {noInventory ? "Listo · sin inventario" : "Requiere inventario"}
              </button>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-4 pt-2">
            <Field label="Bultos">
              <input
                type="number"
                value={bultos}
                onChange={(e) => setBultos(e.target.value)}
                placeholder="0"
                className={`${inputBase} no-spinners font-black text-blue-600 dark:text-blue-400`}
              />
            </Field>
            <Field label="Volumen (m³)">
              <input
                type="number"
                step="0.01"
                value={cbm}
                onChange={(e) => setCbm(e.target.value)}
                placeholder="0.00"
                className={`${inputBase} no-spinners text-sm`}
              />
            </Field>
            <Field label="Peso (kg)">
              <input
                type="number"
                step="0.01"
                value={peso}
                onChange={(e) => setPeso(e.target.value)}
                placeholder="0.0"
                className={`${inputBase} no-spinners text-sm`}
              />
            </Field>
          </div>

          <div className="space-y-1 pt-2">
            <label className={labelClass}>Notas adicionales</label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Observaciones de la carga..."
              rows={2}
              className={`${inputBase} text-sm`}
            />
          </div>

          <div className="flex gap-3 border-t border-slate-100 pt-4 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 rounded-xl border border-slate-200 bg-white py-3 text-xs font-bold uppercase tracking-widest text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-xl bg-[#16263F] py-3 text-xs font-bold uppercase tracking-widest text-white shadow-lg transition-colors hover:bg-blue-900 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? "Guardando…" : "Guardar RA"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
