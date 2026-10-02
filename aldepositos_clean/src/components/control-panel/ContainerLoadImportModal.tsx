"use client";

import React, { useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  FileSpreadsheet,
  ListChecks,
  Loader2,
  Lock,
  Sparkles,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  containerLoadGridToText,
  parseContainerLoadExcel,
} from "@/lib/parseContainerLoadExcel";
import {
  createContainerLoad,
  fetchContainerLoads,
  normalizeContainerLoadRa,
} from "@/lib/containerLoads";
import {
  CONTAINER_LOAD_STATE_CHIP,
  CONTAINER_LOAD_STATE_LABELS,
  DEFAULT_NO_INVENTORY_REASON,
  containerLoadItemState,
  describeRaConflicts,
  findRaConflicts,
} from "@/lib/containerLoadStatus";
import { ALDEGPT_TERRA_DISPLAY_NAME } from "@/lib/aldeGptTerraBrand";
import type { ContainerLoad, ContainerLoadItem } from "@/lib/types/containerLoad";
import type { Task } from "@/lib/types/task";
import { ContainerLoadRaPicker } from "@/components/control-panel/ContainerLoadRaPicker";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (load: ContainerLoad) => void;
  tasks: Task[];
  tasksByRa: Map<string, Task>;
  loads: ContainerLoad[];
  onLoadsRefreshed: (loads: ContainerLoad[]) => void;
  userEmail?: string | null;
};

async function analyzeWithTerra(grid: string[][]): Promise<{
  name: string;
  items: ContainerLoadItem[];
}> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Sesión expirada. Volvé a iniciar sesión.");
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      message: containerLoadGridToText(grid),
      history: [],
      extractMode: "containerLoad",
      model: "terra",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    name?: string;
    items?: ContainerLoadItem[];
  };
  if (!res.ok) throw new Error(data.error || `Error ${res.status} al analizar.`);
  return { name: data.name ?? "", items: data.items ?? [] };
}

export function ContainerLoadImportModal({
  open,
  onClose,
  onCreated,
  tasks,
  tasksByRa,
  loads,
  onLoadsRefreshed,
  userEmail,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [excelItems, setExcelItems] = useState<ContainerLoadItem[]>([]);
  const [manualItems, setManualItems] = useState<ContainerLoadItem[]>([]);
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState<"parse" | "terra" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<"local" | "terra" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [noInventoryRas, setNoInventoryRas] = useState<Set<string>>(() => new Set());

  /** Excel primero (orden del cargue) y después los elegidos a mano. */
  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: ContainerLoadItem[] = [];
    const markedBy = userEmail?.toLowerCase() || undefined;
    for (const it of [...excelItems, ...manualItems]) {
      const key = normalizeContainerLoadRa(it.ra);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        ...it,
        ra: key,
        position: out.length + 1,
        ...(noInventoryRas.has(key)
          ? {
              noInventoryRequired: true,
              noInventoryReason: DEFAULT_NO_INVENTORY_REASON,
              noInventoryMarkedBy: markedBy,
            }
          : {}),
      });
    }
    return out;
  }, [excelItems, manualItems, noInventoryRas, userEmail]);

  const toggleNoInventory = (ra: string) => {
    setNoInventoryRas((prev) => {
      const next = new Set(prev);
      if (next.has(ra)) next.delete(ra);
      else next.add(ra);
      return next;
    });
  };

  const blocked = useMemo(
    () =>
      findRaConflicts(
        loads,
        items.map((it) => it.ra),
      ),
    [loads, items],
  );
  const allowedItems = useMemo(
    () =>
      items
        .filter((it) => !blocked.has(it.ra))
        .map((it, i) => ({ ...it, position: i + 1 })),
    [items, blocked],
  );

  const counts = useMemo(() => {
    let missing = 0;
    let ready = 0;
    let notRequired = 0;
    for (const it of allowedItems) {
      const st = containerLoadItemState(tasksByRa.get(it.ra) ?? null, it);
      if (st === "missing") missing += 1;
      if (st === "completed") ready += 1;
      if (st === "not_required") {
        ready += 1;
        notRequired += 1;
      }
    }
    return { missing, notRequired, todo: allowedItems.length - ready };
  }, [allowedItems, tasksByRa]);

  const reset = () => {
    setName("");
    setFileName(null);
    setExcelItems([]);
    setManualItems([]);
    setGrid(null);
    setWarnings([]);
    setError(null);
    setSource(null);
    setPickerOpen(false);
    setNoInventoryRas(new Set());
    if (fileRef.current) fileRef.current.value = "";
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const removeItem = (ra: string) => {
    setExcelItems((prev) => prev.filter((it) => normalizeContainerLoadRa(it.ra) !== ra));
    setManualItems((prev) => prev.filter((it) => normalizeContainerLoadRa(it.ra) !== ra));
  };

  const runTerra = async (g: string[][]) => {
    setBusy("terra");
    setError(null);
    try {
      const out = await analyzeWithTerra(g);
      setExcelItems(out.items);
      setSource("terra");
      setName((prev) => prev || out.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo analizar con Terra.");
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy("parse");
    setError(null);
    setExcelItems([]);
    setWarnings([]);
    setFileName(file.name);
    try {
      const parsed = await parseContainerLoadExcel(file);
      setGrid(parsed.grid);
      setWarnings(parsed.warnings);
      setName((prev) => prev || parsed.suggestedName);
      if (parsed.headerFound && parsed.items.length > 0) {
        setExcelItems(parsed.items);
        setSource("local");
        setBusy(null);
        return;
      }
      setBusy(null);
      await runTerra(parsed.grid);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo.");
    }
  };

  const save = async () => {
    if (!name.trim()) {
      setError("Poné un nombre al cargue (ej. LG-232 CONSOLIDADO 23).");
      return;
    }
    if (allowedItems.length === 0) {
      setError(
        items.length > 0
          ? "Todos los RA están bloqueados porque ya están en otro cargue abierto."
          : "Adjuntá el Excel o seleccioná RA a mano.",
      );
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const fresh = await fetchContainerLoads();
      onLoadsRefreshed(fresh);
      const late = findRaConflicts(
        fresh,
        allowedItems.map((it) => it.ra),
      );
      if (late.size > 0) {
        throw new Error(
          `Bloqueado: ${describeRaConflicts(late)} se agregó a otro cargue mientras armabas este. Revisá la lista y volvé a guardar.`,
        );
      }
      const load = await createContainerLoad({
        name,
        items: allowedItems,
        sourceFileName: fileName,
        createdByEmail: userEmail,
      });
      reset();
      onCreated(load);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el cargue.");
    } finally {
      setBusy(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-3xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
              Nuevo cargue de contenedor
            </p>
            <h2 className="text-lg font-black text-[#16263F] dark:text-slate-50">
              Relación de cargue
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">
              Nombre del cargue
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="LG-232 CONSOLIDADO 23 · DO-02 PONCHO"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold uppercase text-[#16263F] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            />
          </label>

          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => fileRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm font-bold text-slate-600 transition hover:border-blue-400 hover:bg-blue-50/50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-300"
            >
              {busy === "parse" || busy === "terra" ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-5 w-5" />
              )}
              {busy === "terra"
                ? `${ALDEGPT_TERRA_DISPLAY_NAME} está analizando el cargue…`
                : busy === "parse"
                  ? "Leyendo Excel…"
                  : fileName
                    ? `${fileName} · cambiar archivo`
                    : "Adjuntar Excel de la relación de cargue"}
            </button>
            {grid && source === "local" ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void runTerra(grid)}
                className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold text-violet-700 hover:underline disabled:opacity-50 dark:text-violet-300"
              >
                <Sparkles className="h-3.5 w-3.5" />
                ¿El orden no se ve bien? Reanalizar con {ALDEGPT_TERRA_DISPLAY_NAME}
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setPickerOpen(true)}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-[#16263F] transition hover:border-blue-400 hover:bg-blue-50/50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              <ListChecks className="h-5 w-5" />
              Seleccionar RA manualmente
              {manualItems.length > 0 ? ` (${manualItems.length})` : ""}
            </button>
          </div>

          <ContainerLoadRaPicker
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onConfirm={(ras) => {
              setPickerOpen(false);
              setManualItems((prev) => [
                ...prev,
                ...ras.map((ra) => ({ position: 0, ra })),
              ]);
            }}
            tasks={tasks}
            loads={loads}
            excludeRas={items.map((it) => it.ra)}
          />

          {error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {error}
            </p>
          ) : null}

          {warnings.length > 0 ? (
            <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}

          {items.length > 0 ? (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {allowedItems.length} RA
                </span>
                {blocked.size > 0 ? (
                  <span className="rounded-full bg-slate-800 px-2.5 py-1 text-white dark:bg-slate-200 dark:text-slate-900">
                    {blocked.size} bloqueados (ya en otro cargue)
                  </span>
                ) : null}
                <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700 dark:bg-red-950/50 dark:text-red-300">
                  {counts.todo} por inventariar
                </span>
                {counts.missing > 0 ? (
                  <span
                    className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                    title="Todavía no existen en el sistema: se podrán inventariar cuando se les asigne la OR."
                  >
                    {counts.missing} esperando OR
                  </span>
                ) : null}
                {counts.notRequired > 0 ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                    {counts.notRequired} listos sin inventario
                  </span>
                ) : null}
                <span className="text-slate-400">
                  {[
                    source === "terra"
                      ? `Analizado por ${ALDEGPT_TERRA_DISPLAY_NAME}`
                      : source === "local"
                        ? "Leído del Excel"
                        : null,
                    manualItems.length > 0 ? "con RA elegidos a mano" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <p className="mb-2 text-[11px] font-medium text-slate-500">
                Orden de arriba (fondo del contenedor, se inventaría primero) hacia abajo (cierra el contenedor).
                Tocá <CheckCircle2 className="inline h-3.5 w-3.5 align-text-bottom text-emerald-600" /> en un RA que no hace falta inventariar (p. ej. solo tiene RA, sin OR) para dejarlo listo en verde.
              </p>
              <ol className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                {items.map((it) => {
                  const task = tasksByRa.get(it.ra) ?? null;
                  const st = containerLoadItemState(task, it);
                  const other = blocked.get(it.ra);
                  const pos = allowedItems.find((a) => a.ra === it.ra)?.position;
                  const marked = st === "not_required";
                  return (
                    <li
                      key={it.ra}
                      className={`flex items-center gap-3 px-3 py-2 ${
                        other
                          ? "bg-slate-50 opacity-60 dark:bg-slate-800/40"
                          : marked
                            ? "bg-emerald-50/70 dark:bg-emerald-950/20"
                            : ""
                      }`}
                    >
                      <span className="w-7 shrink-0 text-center text-sm font-black tabular-nums text-slate-400">
                        {other ? <Lock className="mx-auto h-4 w-4" /> : pos}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-black text-[#16263F] dark:text-slate-100">
                          RA {it.ra}
                        </p>
                        {task ? (
                          <p className="truncate text-[11px] text-slate-500">
                            {it.proveedor || task.provider || "—"}
                            {it.expedidor ? ` · ${it.expedidor}` : ""}
                          </p>
                        ) : null}
                        {other ? (
                          <p className="mt-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-300">
                            Bloqueado: ya está en «{other}». No se agregará.
                          </p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-[11px] font-bold tabular-nums text-slate-500">
                        {it.bultos ?? "—"} bult.
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${CONTAINER_LOAD_STATE_CHIP[st]}`}
                      >
                        {CONTAINER_LOAD_STATE_LABELS[st]}
                      </span>
                      {st !== "completed" && !other ? (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => toggleNoInventory(it.ra)}
                          className={`shrink-0 rounded-lg p-1 transition disabled:opacity-40 ${
                            marked
                              ? "text-emerald-600 hover:bg-emerald-100 dark:hover:bg-emerald-950/40"
                              : "text-slate-300 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/40"
                          }`}
                          title={
                            marked
                              ? "Quitar «listo»: hay que inventariarlo"
                              : "Marcar listo: no requiere inventario"
                          }
                          aria-label={`Marcar RA ${it.ra} como listo sin inventario`}
                          aria-pressed={marked}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => removeItem(it.ra)}
                        className="shrink-0 rounded-lg p-1 text-slate-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/40"
                        aria-label={`Quitar RA ${it.ra}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700">
          <button
            type="button"
            onClick={close}
            disabled={busy !== null}
            className="rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy !== null || allowedItems.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-[#16263F] px-5 py-2.5 text-xs font-black uppercase tracking-wide text-white disabled:opacity-50"
          >
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Crear cargue
          </button>
        </div>
      </div>
    </div>
  );
}
