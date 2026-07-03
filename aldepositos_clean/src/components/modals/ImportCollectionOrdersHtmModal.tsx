"use client";

import React, { useEffect, useMemo, useState } from "react";
import { FileCode, Loader2, Upload, X } from "lucide-react";
import type { CollectionOrder } from "@/lib/types/collectionOrder";
import type { ParsedOrHtmRow } from "@/lib/parseCollectionOrdersHtm";
import {
  classifyHtmCollectionOrders,
  collectionOrdersFromHtmRows,
  normalizeOrNumero,
  parseCollectionOrdersFromHtm,
} from "@/lib/parseCollectionOrdersHtm";

type ImportCollectionOrdersHtmModalProps = {
  open: boolean;
  existingOrders: CollectionOrder[];
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (orders: CollectionOrder[]) => void | Promise<void>;
};

export function ImportCollectionOrdersHtmModal({
  open,
  existingOrders,
  busy = false,
  onCancel,
  onConfirm,
}: ImportCollectionOrdersHtmModalProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedOrHtmRow[]>([]);
  const [clienteGlobal, setClienteGlobal] = useState<string | undefined>();
  const [reading, setReading] = useState(false);

  useEffect(() => {
    if (!open) {
      setFileName(null);
      setParseError(null);
      setParsedRows([]);
      setClienteGlobal(undefined);
      setReading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy && !reading) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, reading, onCancel]);

  const existingNumeros = useMemo(() => {
    const set = new Set<string>();
    for (const o of existingOrders) {
      const n = normalizeOrNumero(o.numero);
      if (n) set.add(n);
    }
    return set;
  }, [existingOrders]);

  const previewOrders = useMemo(
    () => collectionOrdersFromHtmRows(parsedRows, clienteGlobal),
    [parsedRows, clienteGlobal],
  );

  const { toCreate, toUpdate, unchangedNumeros } = useMemo(
    () => classifyHtmCollectionOrders(previewOrders, existingOrders),
    [previewOrders, existingOrders],
  );

  const createNumeros = useMemo(
    () => new Set(toCreate.map((o) => normalizeOrNumero(o.numero))),
    [toCreate],
  );
  const updateNumeros = useMemo(
    () => new Set(toUpdate.map((o) => normalizeOrNumero(o.numero))),
    [toUpdate],
  );
  const actionableCount = toCreate.length + toUpdate.length;

  const onPickFile: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setReading(true);
    setParseError(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        const result = parseCollectionOrdersFromHtm(text);
        if (result.error) {
          setParseError(result.error);
          setParsedRows([]);
          setClienteGlobal(undefined);
        } else {
          setParsedRows(result.orders);
          setClienteGlobal(result.clienteGlobal);
        }
      } catch {
        setParseError("Error al procesar el archivo HTM.");
        setParsedRows([]);
      } finally {
        setReading(false);
      }
    };
    reader.onerror = () => {
      setParseError("No se pudo leer el archivo.");
      setReading(false);
    };
    reader.readAsText(file, "utf-8");
  };

  if (!open) return null;

  return (
    <div
      className="modal-overlay flex items-end justify-center bg-slate-900/55 backdrop-blur-[2px] sm:items-center"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy && !reading) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-htm-title"
        className="modal-panel flex max-h-[min(92vh,720px)] w-full max-w-2xl flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl dark:border-slate-600 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-teal-50 px-5 py-4 dark:border-slate-700 dark:from-emerald-950/40 dark:to-teal-950/30">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-700 text-white shadow-lg">
              <FileCode className="h-5 w-5" strokeWidth={2.5} aria-hidden />
            </div>
            <div>
              <h2
                id="import-htm-title"
                className="text-base font-black uppercase tracking-wide text-[#16263F] dark:text-slate-100"
              >
                Importar órdenes desde HTM
              </h2>
              <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Reporte Magaya «CARGA POR LLEGAR»: número OR, consignatario, proveedor, piezas, peso y volumen
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy || reading}
            onClick={onCancel}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-white/80 disabled:opacity-50 dark:hover:bg-slate-800"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/50 px-4 py-8 text-center transition hover:bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/35">
            {reading ? (
              <Loader2 className="h-8 w-8 animate-spin text-emerald-700" />
            ) : (
              <Upload className="h-8 w-8 text-emerald-700 dark:text-emerald-300" />
            )}
            <span className="text-xs font-black uppercase tracking-widest text-emerald-900 dark:text-emerald-200">
              {fileName ? fileName : "Seleccionar archivo .htm / .html"}
            </span>
            <span className="max-w-sm text-[11px] text-slate-500 dark:text-slate-400">
              Misma información que el Excel de RAs, pero para crear órdenes de recolección
              antes de vincularlas al RA.
            </span>
            <input
              type="file"
              accept=".htm,.html,text/html"
              className="hidden"
              disabled={busy || reading}
              onChange={onPickFile}
            />
          </label>

          {parseError ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              {parseError}
            </p>
          ) : null}

          {clienteGlobal ? (
            <p className="text-xs font-bold text-slate-600 dark:text-slate-400">
              Consignatario global detectado:{" "}
              <span className="text-[#16263F] dark:text-slate-100">{clienteGlobal}</span>
            </p>
          ) : null}

          {previewOrders.length > 0 ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-600">
              <p className="border-b border-slate-100 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:border-slate-700">
                Vista previa ({previewOrders.length})
              </p>
              <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                {previewOrders.map((o) => {
                  const n = normalizeOrNumero(o.numero);
                  const isNew = createNumeros.has(n);
                  const isUpdate = updateNumeros.has(n);
                  const isExisting = existingNumeros.has(n);
                  const line = o.lines[0];
                  const bultos = o.expectedBultos ?? line?.bultos ?? 0;
                  return (
                    <li key={o.id} className="px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-black text-[#16263F] dark:text-slate-100">
                          OR #{o.numero}
                        </span>
                        {isNew ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                            Nueva
                          </span>
                        ) : isUpdate ? (
                          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-black uppercase text-blue-800 dark:bg-blue-950/50 dark:text-blue-200">
                            Se actualizará
                          </span>
                        ) : isExisting ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            Sin cambios
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                            Duplicada en archivo
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        {o.proveedor || "—"} → {o.cliente || "—"}
                      </p>
                      <p className="text-[11px] font-bold text-slate-500">
                        {bultos} bultos · {o.expedidor ? o.expedidor : "sin expedidor"}
                      </p>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-slate-100 px-3 py-2 text-[11px] font-semibold dark:border-slate-700">
                <span className="text-emerald-700 dark:text-emerald-300">
                  {toCreate.length} nueva(s)
                </span>
                {" · "}
                <span className="text-blue-700 dark:text-blue-300">
                  {toUpdate.length} a actualizar
                </span>
                {" · "}
                <span className="text-slate-500">
                  {unchangedNumeros.length} sin cambios
                </span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-4 dark:border-slate-700">
          <button
            type="button"
            disabled={busy || reading}
            onClick={onCancel}
            className="rounded-xl border border-slate-200 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || reading || actionableCount === 0}
            onClick={() => void onConfirm(previewOrders)}
            className="rounded-xl bg-emerald-700 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white shadow-md hover:brightness-110 disabled:opacity-50"
          >
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Guardando…
              </span>
            ) : actionableCount === 0 && previewOrders.length > 0 ? (
              "Sin cambios que aplicar"
            ) : toCreate.length > 0 && toUpdate.length > 0 ? (
              `Aplicar (${toCreate.length} nuevas · ${toUpdate.length} cambios)`
            ) : toUpdate.length > 0 ? (
              `Actualizar ${toUpdate.length} orden(es)`
            ) : (
              `Crear ${toCreate.length} orden(es)`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
