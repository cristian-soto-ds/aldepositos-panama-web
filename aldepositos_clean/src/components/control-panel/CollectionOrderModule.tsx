"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  HandHelping,
  Plus,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import type { Task } from "@/lib/types/task";
import type { CollectionOrder, CollectionOrderLine } from "@/lib/types/collectionOrder";
import {
  deleteCollectionOrderById,
  insertCollectionOrder,
  updateCollectionOrder,
} from "@/lib/collectionOrders";
import { useSupabaseCollectionOrders } from "@/hooks/useSupabaseCollectionOrders";
import { parseReferenciasFromExcel } from "@/lib/importReferenciasExcel";
import {
  buildMeasurePatchFromCatalog,
  getReferenceCatalogItem,
  mergeCatalogIntoImportedRows,
  normalizePartNumber,
} from "@/lib/referenceCatalog";
import {
  countInventarioCsvRows,
  downloadInventarioCsv,
} from "@/lib/exportInventarioCsv";
import { InventoryCsvExportModal } from "@/components/modals/InventoryCsvExportModal";
import { TransferCollectionToRaModal } from "@/components/modals/TransferCollectionToRaModal";
import { adaptMeasureDataForModule } from "@/lib/taskUtils";
import {
  applyPesoTotalToLine,
  applyUnidadesTotalesToLine,
  collectionLinesToDetailedMeasureData,
  lineHasData,
  pesoTotalFromLine,
  unidadesTotalesFromLine,
} from "@/lib/collectionLineUtils";

const generateId = () => Math.random().toString(36).slice(2, 11);
const CATALOG_DEBOUNCE_MS = 500;

function sanitizeIntegerInput(raw: string): string {
  const digitsOnly = raw.replace(/\D+/g, "");
  return digitsOnly;
}

function sanitizeDecimalInput(raw: string, maxDecimals = 2): string {
  const normalized = raw.replace(",", ".").replace(/[^0-9.]/g, "");
  const [intPart = "", ...rest] = normalized.split(".");
  const decimalPart = rest.join("").slice(0, maxDecimals);
  if (!normalized.includes(".")) return intPart;
  return `${intPart}.${decimalPart}`;
}

function formatWeight(value: string | number | undefined): string {
  if (value === "" || value === undefined || value === null) return "";
  const n = parseFloat(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return "";
  return n.toFixed(2);
}

const emptyLine = (): CollectionOrderLine => ({
  id: generateId(),
  referencia: "",
  descripcion: "",
  bultos: "",
  unidadesPorBulto: "",
  pesoPorBulto: "",
  l: "",
  w: "",
  h: "",
});

function newDraftOrder(): CollectionOrder {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    numero: "",
    cliente: "",
    proveedor: "",
    notes: "",
    lines: [emptyLine()],
    status: "draft",
    linkedRaNumbers: [],
    createdAt: now,
    updatedAt: now,
  };
}

function parseOrderNumber(n: string | undefined): number {
  const raw = String(n ?? "").trim();
  if (!raw) return 0;
  const onlyDigits = raw.replace(/\D+/g, "");
  if (!onlyDigits) return 0;
  const val = parseInt(onlyDigits, 10);
  return Number.isFinite(val) ? val : 0;
}

type CollectionOrderModuleProps = {
  tasks: Task[];
  onUpdateTask: (task: Task) => void | Promise<void>;
  userEmail: string | null;
};

export function CollectionOrderModule({
  tasks,
  onUpdateTask,
  userEmail,
}: CollectionOrderModuleProps) {
  const { orders, setOrders, reloadOrders, ordersLoading } =
    useSupabaseCollectionOrders({ enabled: !!userEmail });

  const [editing, setEditing] = useState<CollectionOrder | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const [unresolvedRefByRow, setUnresolvedRefByRow] = useState<
    Record<string, boolean>
  >({});
  const [unitsMode, setUnitsMode] = useState<"per_bundle" | "total">("per_bundle");
  const [weightMode, setWeightMode] = useState<"per_bundle" | "total">("per_bundle");

  const referenciasExcelRef = useRef<HTMLInputElement>(null);
  const catalogDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const catalogSeqRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const d = catalogDebounceRef;
    return () => {
      Object.values(d.current).forEach(clearTimeout);
    };
  }, []);

  const openNew = () => {
    setEditing(newDraftOrder());
    setUnresolvedRefByRow({});
  };

  const openEdit = (o: CollectionOrder) => {
    setEditing(
      JSON.parse(JSON.stringify(o)) as CollectionOrder,
    );
    setUnresolvedRefByRow({});
  };

  const backToList = () => {
    setEditing(null);
    setUnresolvedRefByRow({});
    void reloadOrders();
  };

  const updateEditing = (patch: Partial<CollectionOrder>) => {
    setEditing((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const updateLine = (lineId: string, patch: Partial<CollectionOrderLine>) => {
    setEditing((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        lines: prev.lines.map((row) =>
          row.id === lineId ? { ...row, ...patch } : row,
        ),
      };
    });
  };

  const runCatalogLookup = useCallback(async (rowId: string, rawReferencia: string) => {
    const key = normalizePartNumber(rawReferencia);
    if (!key) {
      setUnresolvedRefByRow((prev) => {
        if (!(rowId in prev)) return prev;
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
      return;
    }
    const seq = (catalogSeqRef.current[rowId] = (catalogSeqRef.current[rowId] ?? 0) + 1);
    const item = await getReferenceCatalogItem(key);
    if (catalogSeqRef.current[rowId] !== seq) return;
    if (!item) {
      setUnresolvedRefByRow((prev) => ({ ...prev, [rowId]: true }));
      return;
    }
    setUnresolvedRefByRow((prev) => {
      if (!(rowId in prev)) return prev;
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
    const patch = buildMeasurePatchFromCatalog("detailed", item);
    setEditing((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        lines: prev.lines.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
      };
    });
  }, []);

  const scheduleCatalogLookup = (rowId: string, raw: string) => {
    const prevT = catalogDebounceRef.current[rowId];
    if (prevT) clearTimeout(prevT);
    catalogDebounceRef.current[rowId] = setTimeout(() => {
      delete catalogDebounceRef.current[rowId];
      void runCatalogLookup(rowId, raw);
    }, CATALOG_DEBOUNCE_MS);
  };

  const addRow = () => {
    setEditing((prev) =>
      prev ? { ...prev, lines: [...prev.lines, emptyLine()] } : prev,
    );
  };

  const deleteRow = (lineId: string) => {
    setUnresolvedRefByRow((prev) => {
      if (!(lineId in prev)) return prev;
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
    setEditing((prev) => {
      if (!prev) return prev;
      const next = prev.lines.filter((r) => r.id !== lineId);
      return {
        ...prev,
        lines: next.length > 0 ? next : [emptyLine()],
      };
    });
  };

  const saveOrder = async () => {
    if (!editing) return;
    const maxExisting = Math.max(
      0,
      ...orders.map((o) => parseOrderNumber(o.numero)),
    );
    const suggested = String(maxExisting + 1);
    const numeroRaw = String(editing.numero ?? "").trim();
    const numero = numeroRaw || suggested;
    const payload: CollectionOrder = {
      ...editing,
      numero,
      updatedAt: new Date().toISOString(),
    };
    const exists = orders.some((o) => o.id === payload.id);
    setSaveBusy(true);
    try {
      if (exists) await updateCollectionOrder(payload);
      else await insertCollectionOrder(payload);
      setOrders((prev) => {
        const rest = prev.filter((o) => o.id !== payload.id);
        return [payload, ...rest];
      });
      setEditing(payload);
       
      alert(`Orden guardada. Número: ${numero}.`);
    } catch (e) {
      console.error(e);
       
      alert(
        "No se pudo guardar. ¿Aplicaste la migración SQL `collection_orders` en Supabase?",
      );
    } finally {
      setSaveBusy(false);
    }
  };

  const deleteOrder = async (o: CollectionOrder) => {
     
    if (!confirm(`¿Eliminar la orden de recolección (${o.cliente || "sin cliente"})?`)) return;
    try {
      await deleteCollectionOrderById(o.id);
      setOrders((prev) => prev.filter((x) => x.id !== o.id));
      if (editing?.id === o.id) setEditing(null);
    } catch (e) {
      console.error(e);
       
      alert("No se pudo eliminar en Supabase.");
    }
  };

  const onExcelImport: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !editing) return;
    setImportBusy(true);
    try {
      const { rows, sourceColumnLabel, error } = await parseReferenciasFromExcel(file);
      if (error) {
         
        alert(error);
        return;
      }
      if (rows.length === 0) {
         
        alert("No hay filas para importar.");
        return;
      }
      const existing = new Set(
        editing.lines
          .map((r) => String(r.referencia ?? "").trim().toUpperCase())
          .filter(Boolean),
      );
      const additions: CollectionOrderLine[] = [];
      let skipped = 0;
      for (const r of rows) {
        const ref = r.referencia.trim();
        if (!ref) continue;
        const k = ref.toUpperCase();
        if (existing.has(k)) {
          skipped += 1;
          continue;
        }
        existing.add(k);
        additions.push({
          id: generateId(),
          referencia: ref,
          descripcion: "",
          bultos: r.bultos !== undefined ? String(r.bultos) : "",
          unidadesPorBulto: "",
          pesoPorBulto: "",
          l: "",
          w: "",
          h: "",
        });
      }
      if (additions.length === 0) {
         
        alert(skipped ? "Todas las referencias ya estaban en la tabla." : "Nada que añadir.");
        return;
      }
      void mergeCatalogIntoImportedRows("detailed", additions)
        .then(({ rows: enriched, catalogMatched }) => {
          setEditing((prev) =>
            prev
              ? { ...prev, lines: [...prev.lines, ...enriched] }
              : prev,
          );
           
          alert(
            `Añadidas ${enriched.length} fila(s). Columna: «${sourceColumnLabel}».` +
              (skipped ? ` Omitidas ${skipped} duplicada(s).` : "") +
              (catalogMatched > 0 ? ` ${catalogMatched} en catálogo.` : ""),
          );
        })
        .catch((err) => {
          console.error(err);
          setEditing((prev) =>
            prev ? { ...prev, lines: [...prev.lines, ...additions] } : prev,
          );
           
          alert("Import sin catálogo (error de red). Revisa la conexión.");
        });
    } catch (err) {
      console.error(err);
       
      alert("No se pudo leer el archivo.");
    } finally {
      setImportBusy(false);
    }
  };

  const transferLinesCount =
    editing?.lines.filter(lineHasData).length ?? 0;

  const confirmTransfer = async (taskId: string, merge: "append" | "replace") => {
    if (!editing) return;
    const lines = editing.lines.filter(lineHasData);
    if (lines.length === 0) {
       
      alert("No hay líneas con datos para enviar.");
      return;
    }
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
       
      alert("RA no encontrado.");
      return;
    }
    setTransferBusy(true);
    try {
      const existsInDb = orders.some((o) => o.id === editing.id);
      const baseOrder: CollectionOrder = {
        ...editing,
        updatedAt: new Date().toISOString(),
      };
      if (!existsInDb) {
        await insertCollectionOrder(baseOrder);
        setOrders((prev) => [baseOrder, ...prev.filter((o) => o.id !== baseOrder.id)]);
      } else {
        await updateCollectionOrder(baseOrder);
        setOrders((prev) => [baseOrder, ...prev.filter((o) => o.id !== baseOrder.id)]);
      }
      setEditing(baseOrder);

      const detailed = collectionLinesToDetailedMeasureData(lines).map((row) => ({
        ...row,
        id: generateId(),
      }));
      const targetType = (task.type as string) || "quick";
      const adapted = adaptMeasureDataForModule(detailed, "detailed", targetType);
      const prevData = (task.measureData || []) as Record<string, unknown>[];
      const nextMeasure: unknown[] =
        merge === "replace" ? adapted : [...prevData, ...adapted];
      const updatedTask: Task = {
        ...task,
        measureData: nextMeasure,
      };
      await Promise.resolve(onUpdateTask(updatedTask));
      const ra = String(task.ra ?? "").trim();
      const linked = Array.from(
        new Set([...(baseOrder.linkedRaNumbers || []), ra].filter(Boolean)),
      );
      const nextOrder: CollectionOrder = {
        ...baseOrder,
        status: "sent",
        linkedRaNumbers: linked,
        updatedAt: new Date().toISOString(),
      };
      try {
        await updateCollectionOrder(nextOrder);
      } catch (e) {
        console.warn("RA actualizado; aviso: no se guardó el vínculo en la orden:", e);
      }
      setEditing(nextOrder);
      setOrders((prev) => {
        const rest = prev.filter((o) => o.id !== nextOrder.id);
        return [nextOrder, ...rest];
      });
      setTransferOpen(false);
       
      alert(`Medidas enviadas al RA-${ra}.`);
    } catch (e) {
      console.error(e);
       
      alert(
        "No se pudo completar la operación. Revisa la tabla `collection_orders` en Supabase y la conexión.",
      );
    } finally {
      setTransferBusy(false);
    }
  };

  /* ——— Lista ——— */
  if (!editing) {
    return (
      <div className="flex h-full min-h-0 w-full max-w-5xl mx-auto flex-1 flex-col bg-gradient-to-b from-indigo-50/40 via-transparent to-transparent px-2 py-4 md:px-0 md:py-6 dark:from-indigo-950/20">
        <header className="mb-6 shrink-0 rounded-3xl border border-indigo-300/70 bg-gradient-to-r from-[#1e2a5a] via-[#24356d] to-[#1e4f86] p-5 text-white shadow-2xl shadow-indigo-500/30 dark:border-indigo-900/40 md:p-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-indigo-100">
                <HandHelping className="h-8 w-8" />
                <h1 className="text-2xl font-black uppercase tracking-tight text-white md:text-3xl">
                  Orden de recolección
                </h1>
              </div>
              <p className="mt-2 max-w-2xl text-sm font-semibold text-indigo-100/95">
                Anotá qué se va a traer del proveedor. Después podés pasar estas líneas al RA de
                almacén con medidas y cantidades. Misma importación Excel y CSV que en ingreso
                detallado.
              </p>
            </div>
            <button
              type="button"
              onClick={openNew}
              className="flex items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-xs font-black uppercase tracking-widest text-[#1b2d58] shadow-xl transition hover:scale-[1.01] hover:bg-indigo-50"
            >
              <Plus className="h-5 w-5" /> Nueva orden
            </button>
          </div>
        </header>

        {ordersLoading ? (
          <p className="text-sm font-bold text-slate-500">Cargando…</p>
        ) : orders.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
            <p className="font-bold text-slate-500 dark:text-slate-400">
              No hay órdenes aún. Creá una para empezar.
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {orders.map((o) => (
              <div
                key={o.id}
                className="group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-600 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-indigo-500 to-sky-500 opacity-70" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-[#16263F] dark:text-slate-100">
                    #${String(o.numero ?? "S/N")} · {o.cliente || "Sin cliente"} ·{" "}
                    <span className="font-bold text-slate-600 dark:text-slate-400">
                      {o.proveedor || "Sin proveedor"}
                    </span>
                  </p>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    {o.lines.filter(lineHasData).length} línea(s) ·{" "}
                    <span
                      className={
                        o.status === "sent"
                          ? "rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300"
                          : "rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300"
                      }
                    >
                      {o.status === "sent" ? "Enviada al almacén" : "Borrador"}
                    </span>
                    {o.linkedRaNumbers && o.linkedRaNumbers.length > 0 && (
                      <> · RA: {o.linkedRaNumbers.join(", ")}</>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEdit(o)}
                    className="rounded-xl border-2 border-slate-200 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Abrir
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteOrder(o)}
                    className="rounded-xl border-2 border-red-100 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:text-red-400"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* ——— Editor ——— */
  const e = editing;
  const totalLines = e.lines.length;
  const linesWithData = e.lines.filter(lineHasData).length;
  const linkedRaCount = e.linkedRaNumbers?.length ?? 0;
  const maxExistingNumber = Math.max(0, ...orders.map((o) => parseOrderNumber(o.numero)));
  const suggestedNumber = String(maxExistingNumber + 1);

  return (
    <>
      <div className="flex h-full min-h-0 w-full max-w-[1600px] mx-auto flex-1 flex-col overflow-hidden bg-gradient-to-b from-indigo-50/40 via-transparent to-transparent px-2 py-2 md:px-0 md:py-3 dark:from-indigo-950/20">
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 rounded-2xl border border-[#1f3467]/20 bg-gradient-to-r from-white via-slate-50 to-white p-2 shadow-lg shadow-indigo-100/60 backdrop-blur-sm dark:border-indigo-900/40 dark:bg-slate-900/90 dark:shadow-black/20">
          <button
            type="button"
            onClick={backToList}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 shadow-sm hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
          >
            <ArrowLeft className="h-4 w-4" /> Lista
          </button>
          <button
            type="button"
            onClick={() => setCsvOpen(true)}
            title="CSV (delimitado por comas)"
            className="flex items-center gap-2 rounded-xl border-2 border-cyan-400/80 bg-cyan-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-cyan-900 shadow-sm hover:bg-cyan-100 dark:border-cyan-500/50 dark:bg-cyan-950/35 dark:text-cyan-100"
          >
            <Download className="h-4 w-4" /> Descargar CSV
          </button>
          <button
            type="button"
            disabled={saveBusy}
            onClick={() => void saveOrder()}
            className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#1f3467] to-[#0f172a] px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white shadow-md hover:brightness-110 disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> Guardar borrador
          </button>
          <button
            type="button"
            disabled={transferLinesCount === 0}
            onClick={() => setTransferOpen(true)}
            className="ml-auto flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white shadow-md hover:brightness-110 disabled:opacity-50"
          >
            <Send className="h-4 w-4" /> Pasar al RA
          </button>
        </div>

        <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
          Paso 1 · Datos del encabezado · Paso 2 · Líneas · Paso 3 · Pasar al RA
        </p>

        <div className="mb-3 grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-white to-indigo-50/60 px-3 py-2 shadow-sm dark:border-indigo-900/50 dark:from-slate-900 dark:to-indigo-950/20">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Líneas totales
            </p>
            <p className="mt-1 text-lg font-black tabular-nums text-[#16263F] dark:text-slate-100">
              {totalLines}
            </p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
              Líneas con datos
            </p>
            <p className="mt-1 text-lg font-black tabular-nums text-emerald-800 dark:text-emerald-200">
              {linesWithData}
            </p>
          </div>
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 px-3 py-2 shadow-sm dark:border-indigo-900/40 dark:bg-indigo-950/20">
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700 dark:text-indigo-300">
              RA vinculados
            </p>
            <p className="mt-1 text-lg font-black tabular-nums text-indigo-800 dark:text-indigo-200">
              {linkedRaCount}
            </p>
          </div>
        </div>

        <div className="mb-3 grid shrink-0 gap-3 rounded-2xl border-2 border-indigo-200 bg-white p-4 shadow-md dark:border-indigo-900/45 dark:bg-slate-900 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase text-slate-500">
              Número de orden
            </label>
            <input
              value={e.numero ?? ""}
              onChange={(ev) => updateEditing({ numero: ev.target.value })}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-[#16263F] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              placeholder={`Ej. ${suggestedNumber}`}
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase text-slate-500">
              Cliente / consignatario
            </label>
            <input
              value={e.cliente}
              onChange={(ev) => updateEditing({ cliente: ev.target.value })}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-[#16263F] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              placeholder="Nombre del cliente"
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-black uppercase text-slate-500">
              Proveedor
            </label>
            <input
              value={e.proveedor}
              onChange={(ev) => updateEditing({ proveedor: ev.target.value })}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-[#16263F] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              placeholder="Proveedor o naviera"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[10px] font-black uppercase text-slate-500">
              Notas (opcional)
            </label>
            <input
              value={e.notes ?? ""}
              onChange={(ev) => updateEditing({ notes: ev.target.value })}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"
              placeholder="Instrucciones para quien recolecta…"
            />
          </div>
        </div>

        <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Puedes capturar <strong>Unidades</strong> y <strong>Peso</strong> por bulto o totales.
            Si capturas el total, el sistema divide automáticamente entre bultos. Si la referencia
            no existe en catálogo se resalta en rojo.
          </p>
          <div className="flex flex-wrap gap-2">
            <div className="rounded-full border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-600 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setUnitsMode("per_bundle")}
                className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                  unitsMode === "per_bundle"
                    ? "bg-[#16263F] text-white"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-100"
                }`}
              >
                Unidades por bulto
              </button>
              <button
                type="button"
                onClick={() => setUnitsMode("total")}
                className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                  unitsMode === "total"
                    ? "bg-indigo-600 text-white"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-100"
                }`}
              >
                Unidades totales
              </button>
            </div>
            <div className="rounded-full border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-600 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setWeightMode("per_bundle")}
                className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                  weightMode === "per_bundle"
                    ? "bg-[#16263F] text-white"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-100"
                }`}
              >
                Peso por bulto
              </button>
              <button
                type="button"
                onClick={() => setWeightMode("total")}
                className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                  weightMode === "total"
                    ? "bg-amber-600 text-white"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-100"
                }`}
              >
                Peso total
              </button>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-[0_12px_34px_-20px_rgba(79,70,229,0.45)] dark:border-indigo-900/45 dark:bg-slate-900">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[1320px] border-collapse text-center text-sm">
              <thead className="sticky top-0 z-10 border-b border-indigo-200 bg-gradient-to-r from-white via-indigo-50/70 to-sky-50/70 text-[9px] font-black uppercase tracking-widest text-slate-600 shadow-sm backdrop-blur-sm dark:border-indigo-900/40 dark:from-slate-800 dark:via-indigo-950/25 dark:to-slate-800 dark:text-slate-300">
                <tr>
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">Referencia</th>
                  <th className="px-2 py-2">Descripción</th>
                  <th className="px-2 py-2">Bultos</th>
                  <th className="px-2 py-2">Und/bulto</th>
                  <th className="px-2 py-2 bg-slate-50/80 dark:bg-slate-800/60">Tot und</th>
                  <th className="px-2 py-2 text-indigo-700 dark:text-indigo-300">Und captura</th>
                  <th className="px-2 py-2">Peso/b (kg)</th>
                  <th className="px-2 py-2 bg-slate-50/80 dark:bg-slate-800/60">Peso tot</th>
                  <th className="px-2 py-2">L</th>
                  <th className="px-2 py-2">W</th>
                  <th className="px-2 py-2">H</th>
                  <th className="px-2 py-2 bg-slate-50/80 dark:bg-slate-800/60">CBM/Bulto</th>
                  <th className="px-2 py-2 bg-blue-50/90 text-blue-700 dark:bg-blue-950/45 dark:text-blue-300">Cubicaje tot</th>
                  <th className="px-2 py-2 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {e.lines.map((row, idx) => {
                  const totUnd = unidadesTotalesFromLine(row);
                  const pesoTot = pesoTotalFromLine(row);
                  const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
                  const und = parseFloat(String(row.unidadesPorBulto ?? 0)) || 0;
                  const totalUnd = bultos * und;
                  const l = parseFloat(String(row.l ?? 0)) || 0;
                  const w = parseFloat(String(row.w ?? 0)) || 0;
                  const h = parseFloat(String(row.h ?? 0)) || 0;
                  const cbmBulto = (l * w * h) / 1_000_000;
                  const cubicajeTot = cbmBulto * bultos;
                  const refUnknown =
                    unresolvedRefByRow[row.id] === true &&
                    String(row.referencia ?? "").trim().length > 0;
                  return (
                    <tr key={row.id} className="odd:bg-white even:bg-slate-50/60 transition-colors hover:bg-sky-50/70 dark:odd:bg-slate-900 dark:even:bg-slate-800/40 dark:hover:bg-sky-900/20">
                      <td className="px-2 py-1 text-center text-slate-400">{idx + 1}</td>
                      <td className="px-2 py-1">
                        <input
                          value={row.referencia ?? ""}
                          onChange={(ev) => {
                            const v = ev.target.value;
                            updateLine(row.id, { referencia: v });
                            if (!v.trim()) {
                              setUnresolvedRefByRow((prev) => {
                                if (!(row.id in prev)) return prev;
                                const next = { ...prev };
                                delete next[row.id];
                                return next;
                              });
                            }
                            scheduleCatalogLookup(row.id, v);
                          }}
                          onBlur={(ev) => {
                            const t = catalogDebounceRef.current[row.id];
                            if (t) {
                              clearTimeout(t);
                              delete catalogDebounceRef.current[row.id];
                            }
                            void runCatalogLookup(row.id, ev.target.value);
                          }}
                          className={`w-full rounded-lg border px-2 py-1 text-center text-xs font-bold transition ${
                            refUnknown
                              ? "border-red-300 bg-red-50/70 text-red-800 ring-1 ring-red-200 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200"
                              : "border-slate-200 dark:border-slate-600 dark:bg-slate-950"
                          }`}
                          title={refUnknown ? "Referencia nueva/no identificada en catálogo" : undefined}
                          placeholder="Ref."
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          value={row.descripcion ?? ""}
                          onChange={(ev) =>
                            updateLine(row.id, { descripcion: ev.target.value })
                          }
                          className="w-full rounded-lg border border-slate-200 px-2 py-1 text-center text-xs dark:border-slate-600 dark:bg-slate-950"
                          placeholder="Desc."
                        />
                      </td>
                      <td className="px-2 py-1 w-20">
                        <input
                          type="number"
                          value={row.bultos ?? ""}
                          onChange={(ev) =>
                            updateLine(row.id, { bultos: sanitizeIntegerInput(ev.target.value) })
                          }
                          inputMode="numeric"
                          step={1}
                          className="no-spinners w-full rounded-lg border border-slate-200 px-1 py-1 text-center text-xs font-black dark:border-slate-600 dark:bg-slate-950"
                        />
                      </td>
                      <td className="px-2 py-1 w-20">
                        <input
                          type="number"
                          value={row.unidadesPorBulto ?? ""}
                          disabled={unitsMode === "total"}
                          onChange={(ev) =>
                            updateLine(row.id, {
                              unidadesPorBulto: sanitizeIntegerInput(ev.target.value),
                            })
                          }
                          inputMode="numeric"
                          step={1}
                          className={`no-spinners w-full rounded-lg border px-1 py-1 text-center text-xs transition dark:bg-slate-950 ${
                            unitsMode === "total"
                              ? "border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-500"
                              : "border-slate-200 dark:border-slate-600"
                          }`}
                        />
                      </td>
                      <td className="bg-slate-50/80 px-2 py-1 text-center text-sm font-black text-[#16263F] dark:bg-slate-800/60 dark:text-slate-100">
                        {Math.round(totalUnd)}
                      </td>
                      <td className="px-2 py-1 w-24 bg-slate-50/70 dark:bg-slate-800/60">
                        <input
                          type="number"
                          disabled={unitsMode === "per_bundle"}
                          title="Si llenas unidades totales, al salir recalcula und/bulto con los bultos actuales"
                          defaultValue={totUnd > 0 ? String(Math.round(totUnd)) : ""}
                          key={`undtot-${row.id}-${row.bultos}-${row.unidadesPorBulto}-${unitsMode}`}
                          onBlur={(ev) => {
                            if (unitsMode !== "total") return;
                            const next = applyUnidadesTotalesToLine(
                              row,
                              sanitizeIntegerInput(ev.target.value),
                            );
                            setEditing((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    lines: prev.lines.map((r) =>
                                      r.id === row.id ? next : r,
                                    ),
                                  }
                                : prev,
                            );
                          }}
                          className={`no-spinners w-full rounded-lg border px-1 py-1 text-center text-xs font-bold transition ${
                            unitsMode === "total"
                              ? "border-indigo-200 bg-indigo-50/60 dark:border-indigo-800 dark:bg-indigo-950/25"
                              : "border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-500"
                          }`}
                          placeholder="Tot."
                          step={1}
                        />
                      </td>
                      <td className="px-2 py-1 w-24">
                        <input
                          type="number"
                          value={row.pesoPorBulto ?? ""}
                          disabled={weightMode === "total"}
                          onChange={(ev) =>
                            updateLine(row.id, {
                              pesoPorBulto: sanitizeDecimalInput(ev.target.value, 2),
                            })
                          }
                          onBlur={(ev) =>
                            updateLine(row.id, {
                              pesoPorBulto: formatWeight(ev.target.value),
                            })
                          }
                          inputMode="decimal"
                          step={0.01}
                          className={`no-spinners w-full rounded-lg border px-1 py-1 text-center text-xs transition dark:bg-slate-950 ${
                            weightMode === "total"
                              ? "border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-500"
                              : "border-slate-200 dark:border-slate-600"
                          }`}
                        />
                      </td>
                      <td className="px-2 py-1 w-24 bg-slate-50/70 dark:bg-slate-800/60">
                        <input
                          type="number"
                          title="Al salir del campo recalcula peso por bulto con los bultos actuales"
                          disabled={weightMode === "per_bundle"}
                          defaultValue={pesoTot > 0 ? pesoTot.toFixed(2) : ""}
                          key={`pesotot-${row.id}-${row.bultos}-${row.pesoPorBulto}-${weightMode}`}
                          onBlur={(ev) => {
                            if (weightMode !== "total") return;
                            const next = applyPesoTotalToLine(
                              row,
                              sanitizeDecimalInput(ev.target.value, 2),
                            );
                            setEditing((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    lines: prev.lines.map((r) =>
                                      r.id === row.id ? next : r,
                                    ),
                                  }
                                : prev,
                            );
                          }}
                          className={`no-spinners w-full rounded-lg border px-1 py-1 text-center text-xs font-bold transition ${
                            weightMode === "total"
                              ? "border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/30"
                              : "border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-500"
                          }`}
                          placeholder="Tot."
                          inputMode="decimal"
                          step={0.01}
                        />
                      </td>
                      <td className="px-2 py-1 w-16">
                        <input
                          type="number"
                          value={row.l ?? ""}
                          onChange={(ev) => updateLine(row.id, { l: ev.target.value })}
                          className="no-spinners w-full rounded border px-1 py-0.5 text-xs dark:bg-slate-950"
                        />
                      </td>
                      <td className="px-2 py-1 w-16">
                        <input
                          type="number"
                          value={row.w ?? ""}
                          onChange={(ev) => updateLine(row.id, { w: ev.target.value })}
                          className="no-spinners w-full rounded border px-1 py-0.5 text-xs dark:bg-slate-950"
                        />
                      </td>
                      <td className="px-2 py-1 w-16">
                        <input
                          type="number"
                          value={row.h ?? ""}
                          onChange={(ev) => updateLine(row.id, { h: ev.target.value })}
                          className="no-spinners w-full rounded border px-1 py-0.5 text-xs dark:bg-slate-950"
                        />
                      </td>
                      <td className="bg-slate-50/80 px-2 py-1 text-center text-xs font-black text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                        {cbmBulto.toFixed(2)}
                      </td>
                      <td className="bg-blue-50/80 px-2 py-1 text-center text-sm font-black text-blue-700 dark:bg-blue-950/45 dark:text-blue-300">
                        {cubicajeTot.toFixed(2)}
                      </td>
                      <td className="px-1 py-1">
                        <button
                          type="button"
                          onClick={() => deleteRow(row.id)}
                          className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600"
                          aria-label="Eliminar línea"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="shrink-0 border-t border-slate-200 p-2 dark:border-slate-600">
            <input
              ref={referenciasExcelRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={onExcelImport}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addRow}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 py-3 text-[10px] font-black uppercase tracking-widest text-slate-600 min-w-[200px] dark:border-slate-500 dark:text-slate-300"
              >
                <Plus className="h-4 w-4" /> Agregar línea
              </button>
              <button
                type="button"
                disabled={importBusy}
                onClick={() => referenciasExcelRef.current?.click()}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-300 py-3 text-[10px] font-black uppercase tracking-widest text-emerald-800 min-w-[200px] disabled:opacity-50 dark:text-emerald-300"
              >
                <FileSpreadsheet className="h-4 w-4" /> Importar Excel
              </button>
            </div>
          </div>
        </div>
      </div>

      <InventoryCsvExportModal
        open={csvOpen}
        raLabel={`Recolección · ${e.cliente || e.proveedor || e.id.slice(0, 8)}`}
        defaultNumero={String(e.numero ?? "").trim() || suggestedNumber}
        onCancel={() => setCsvOpen(false)}
        onConfirm={(numeroDocumento) => {
          const rows = e.lines as unknown as Record<string, unknown>[];
          if (countInventarioCsvRows(rows) === 0) {
             
            alert("No hay líneas con datos para exportar.");
            setCsvOpen(false);
            return;
          }
          downloadInventarioCsv({
            numeroDocumento,
            measureRows: rows,
            variant: "detailed",
            filenameBase: `recoleccion-${e.id.slice(0, 8)}`,
          });
          setCsvOpen(false);
        }}
      />

      <TransferCollectionToRaModal
        open={transferOpen}
        tasks={tasks}
        lineCount={transferLinesCount}
        busy={transferBusy}
        onCancel={() => setTransferOpen(false)}
        onConfirm={(taskId, merge) => void confirmTransfer(taskId, merge)}
      />
    </>
  );
}
