"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileSpreadsheet,
  HandHelping,
  Loader2,
  Plus,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { GeminiSparkIcon } from "@/components/ui/GeminiSparkIcon";
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
import { normalizeCollectionOrderLineFromImport } from "@/lib/collectionOrderUnitNormalization";
import {
  countInventarioCsvRows,
  countInventarioCsvRowsBulk,
  downloadInventarioCsv,
} from "@/lib/exportInventarioCsv";
import { downloadInventarioExcelFromSections } from "@/lib/exportInventarioExcel";
import {
  downloadMagayaReferenciasExcel,
  downloadMagayaReferenciasExcelFromSections,
} from "@/lib/exportMagayaExcel";
import { InventoryCsvExportModal } from "@/components/modals/InventoryCsvExportModal";
import {
  CollectionOrderGeminiPanel,
  type CollectionOrderGeminiJobState,
} from "@/components/control-panel/CollectionOrderGeminiPanel";
import { AI_ASSISTANT_DISPLAY_NAME } from "@/lib/aiAssistantBrand";
import { TransferCollectionToRaModal } from "@/components/modals/TransferCollectionToRaModal";
import type { CollectionGeminiLine } from "@/lib/collectionOrderGeminiSchema";
import { adaptMeasureDataForModule } from "@/lib/taskUtils";
import {
  applyPesoTotalToLine,
  applyUnidadesTotalesToLine,
  collectionLinesToDetailedMeasureData,
  lineHasData,
  pesoTotalFromLine,
  unidadesTotalesFromLine,
} from "@/lib/collectionLineUtils";
import { supabase } from "@/lib/supabase";
import { prepareGeminiAttachment } from "@/lib/geminiClientAttachment";
import { postCollectionOrderGemini } from "@/lib/geminiCollectionOrderApi";
import {
  recordGeminiRequestSuccess,
} from "@/lib/geminiClientUsage";

const generateId = () => Math.random().toString(36).slice(2, 11);
const CATALOG_DEBOUNCE_MS = 500;

const makeEmptyGeminiJob = (): CollectionOrderGeminiJobState => ({
  input: "",
  history: [],
  busy: false,
  errorBanner: null,
  pendingFileName: null,
  lastLines: [],
  usageSummary: null,
});

function sanitizeIntegerInput(raw: string): string {
  const digitsOnly = raw.replace(/\D+/g, "");
  return digitsOnly;
}

function displayUndBultoValue(params: {
  rowId: string;
  raw: string;
  focusedUndBultoRowId: string | null;
  draftByRow: Record<string, string>;
}): string {
  const { rowId, raw, focusedUndBultoRowId, draftByRow } = params;
  if (focusedUndBultoRowId === rowId) {
    return draftByRow[rowId] ?? raw;
  }
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const n = parseFloat(s.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return s;
  return String(Math.round(n));
}

function sanitizeDecimalInput(raw: string, maxDecimals = 2): string {
  const normalized = raw.replace(",", ".").replace(/[^0-9.]/g, "");
  const [intPart = "", ...rest] = normalized.split(".");
  const decimalPart = rest.join("").slice(0, maxDecimals);
  if (!normalized.includes(".")) return intPart;
  return `${intPart}.${decimalPart}`;
}

/** Und/bulto puede llevar decimales (totales línea como 140÷3 bultos). */
function sanitizeQtyPerBundleInput(raw: string): string {
  return sanitizeDecimalInput(raw, 8);
}

function formatWeight(value: string | number | undefined): string {
  if (value === "" || value === undefined || value === null) return "";
  const n = parseFloat(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return "";
  return n.toFixed(2);
}

/** Referencias con número de parte en la lista de órdenes (no cuenta filas vacías). */
function listReferenciasCount(lines: CollectionOrderLine[]): number {
  return lines.filter((l) => String(l.referencia ?? "").trim().length > 0).length;
}

/** Suma de bultos de todas las líneas de la orden (enteros, como en la tabla). */
function listBultosTotal(lines: CollectionOrderLine[]): number {
  let sum = 0;
  for (const l of lines) {
    const n = parseFloat(String(l.bultos ?? "").replace(",", "."));
    if (Number.isFinite(n) && n > 0) sum += Math.round(n);
  }
  return sum;
}

/** Barra indeterminada + texto mientras la IA analiza el documento */
function CollectionOrderAiAnalyzingStrip(props: {
  label: string;
  className?: string;
  dense?: boolean;
  /** Una sola fila: barra flexible + texto (menos alto). */
  inlineRow?: boolean;
}) {
  const { label, className, dense, inlineRow } = props;
  if (inlineRow) {
    return (
      <div
        className={className}
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="collection-order-ai-progress-track min-w-0 flex-1">
            <div className="collection-order-ai-progress-fill" />
          </div>
          <p className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold tracking-wide text-slate-700 dark:text-slate-200">
            <GeminiSparkIcon size={14} className="shrink-0" />
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-slate-500" aria-hidden />
            <span className="max-w-[14rem] truncate sm:max-w-[20rem]">{label}</span>
          </p>
        </div>
      </div>
    );
  }
  return (
    <div
      className={className}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="collection-order-ai-progress-track">
        <div className="collection-order-ai-progress-fill" />
      </div>
      <p
        className={
          dense
            ? "mt-1 flex items-center gap-1.5 text-[9px] font-semibold tracking-wide text-slate-700 dark:text-slate-200"
            : "mt-1.5 flex items-center gap-2 text-[10px] font-semibold tracking-wide text-slate-700 dark:text-slate-200"
        }
      >
        <Loader2
          className={dense ? "h-3 w-3 shrink-0 animate-spin" : "h-3.5 w-3.5 shrink-0 animate-spin"}
          aria-hidden
        />
        {label}
      </p>
    </div>
  );
}

/** Una línea: barra corta + texto (lista de órdenes, poco espacio). */
function CollectionOrderAiAnalyzingInline() {
  return (
    <div
      className="inline-flex min-w-0 max-w-[11rem] shrink-0 flex-col gap-0.5 rounded-lg border border-slate-200 bg-white px-1.5 py-1 shadow-sm dark:border-slate-600 dark:bg-slate-900 sm:max-w-[13rem]"
      role="status"
      aria-live="polite"
      aria-busy="true"
      title={`${AI_ASSISTANT_DISPLAY_NAME} está analizando el documento`}
    >
      <div className="relative h-1 w-full min-w-[4.5rem] overflow-hidden rounded-full bg-slate-200/90 dark:bg-slate-700/60">
        <div className="collection-order-ai-progress-fill" />
      </div>
      <span className="flex items-center gap-1 text-[8px] font-semibold leading-none tracking-wide text-slate-600 dark:text-slate-300">
        <GeminiSparkIcon size={10} className="shrink-0" />
        <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" aria-hidden />
        <span className="truncate">Analizando…</span>
      </span>
    </div>
  );
}

function mergePendingTotalsIntoLines(
  lines: CollectionOrderLine[],
  unitsMode: "per_bundle" | "total",
  weightMode: "per_bundle" | "total",
  pendingUnd: Record<string, string>,
  pendingPeso: Record<string, string>,
): CollectionOrderLine[] {
  return lines.map((row) => {
    let r = row;
    if (unitsMode === "total") {
      const raw = pendingUnd[row.id];
      if (raw !== undefined && String(raw).trim() !== "") {
        r = applyUnidadesTotalesToLine(r, sanitizeIntegerInput(raw));
      }
    }
    if (weightMode === "total") {
      const raw = pendingPeso[row.id];
      if (raw !== undefined && String(raw).trim() !== "") {
        r = applyPesoTotalToLine(r, sanitizeDecimalInput(raw, 2));
      }
    }
    return r;
  });
}

const emptyLine = (): CollectionOrderLine => ({
  id: generateId(),
  referencia: "",
  descripcion: "",
  bultos: "",
  unidadesPorBulto: "",
  pesoPorBulto: "",
  pesoPiezaKg: "",
  l: "",
  w: "",
  h: "",
  magayaModelo: "",
  paisOrigen: "",
  tejido: "",
  talla: "",
  forro: "",
  genero: "",
  composicion: "",
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

function normalizeRaKey(ra: string | undefined): string {
  return String(ra ?? "").trim();
}

/**
 * Un RA solo puede enlazarse a una orden de recolección (salvo la misma orden que ya lo usó).
 */
function taskIsBlockedForCollectionOrder(
  task: Task,
  currentCollectionOrderId: string,
  allOrders: CollectionOrder[],
): boolean {
  const ra = normalizeRaKey(task.ra);
  if (!ra) return true;

  const claimedByOtherOrder = allOrders.some(
    (o) =>
      o.id !== currentCollectionOrderId &&
      (o.linkedRaNumbers ?? []).some((x) => normalizeRaKey(x) === ra),
  );
  if (claimedByOtherOrder) return true;

  const lock = task.linkedCollectionOrderId;
  if (lock && lock !== currentCollectionOrderId) return true;

  return false;
}

type CollectionOrderModuleProps = {
  tasks: Task[];
  onUpdateTask: (task: Task) => void | Promise<void>;
  userEmail: string | null;
  /** Nombre visible en el panel para el asistente IA (opcional). */
  userDisplayName?: string | null;
};

export function CollectionOrderModule({
  tasks,
  onUpdateTask,
  userEmail,
  userDisplayName = null,
}: CollectionOrderModuleProps) {
  const { orders, setOrders, reloadOrders, ordersLoading } =
    useSupabaseCollectionOrders({ enabled: !!userEmail });

  const [editing, setEditing] = useState<CollectionOrder | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const [geminiOpen, setGeminiOpen] = useState(false);
  const [geminiJobByOrderId, setGeminiJobByOrderId] = useState<
    Record<string, CollectionOrderGeminiJobState>
  >({});
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [unresolvedRefByRow, setUnresolvedRefByRow] = useState<
    Record<string, boolean>
  >({});
  const [unitsMode, setUnitsMode] = useState<"per_bundle" | "total">("per_bundle");
  const [weightMode, setWeightMode] = useState<"per_bundle" | "total">("per_bundle");
  /** Totales capturados en modo "total" antes de blur — se fusionan al guardar / pasar al RA */
  const [pendingUndTot, setPendingUndTot] = useState<Record<string, string>>({});
  const [pendingPesoTot, setPendingPesoTot] = useState<Record<string, string>>({});
  /**
   * UND/BULTO: cuando NO está enfocado, mostramos entero (mejor legibilidad).
   * Cuando se enfoca, mostramos el valor real (puede tener decimales) sin perder precisión interna.
   */
  const [focusedUndBultoRowId, setFocusedUndBultoRowId] = useState<string | null>(null);
  const [undBultoDraft, setUndBultoDraft] = useState<Record<string, string>>({});
  /** Selección múltiple en la lista de órdenes (eliminar en lote). */
  const [selectedOrderIds, setSelectedOrderIds] = useState<Record<string, boolean>>({});

  const referenciasExcelRef = useRef<HTMLInputElement>(null);
  const catalogDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const catalogSeqRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const d = catalogDebounceRef;
    return () => {
      Object.values(d.current).forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (unitsMode === "per_bundle") setPendingUndTot({});
  }, [unitsMode]);

  useEffect(() => {
    if (weightMode === "per_bundle") setPendingPesoTot({});
  }, [weightMode]);

  const openNew = () => {
    setEditing(newDraftOrder());
    setUnresolvedRefByRow({});
    setPendingUndTot({});
    setPendingPesoTot({});
    setFocusedUndBultoRowId(null);
    setUndBultoDraft({});
    setSelectedOrderIds({});
  };

  const openEdit = (o: CollectionOrder) => {
    setEditing(
      JSON.parse(JSON.stringify(o)) as CollectionOrder,
    );
    setUnresolvedRefByRow({});
    setPendingUndTot({});
    setPendingPesoTot({});
    setFocusedUndBultoRowId(null);
    setUndBultoDraft({});
    setSelectedOrderIds({});
  };

  const backToList = () => {
    setEditing(null);
    setUnresolvedRefByRow({});
    setPendingUndTot({});
    setPendingPesoTot({});
    setFocusedUndBultoRowId(null);
    setUndBultoDraft({});
    setSelectedOrderIds({});
    void reloadOrders();
  };

  const getGeminiJob = (orderId: string): CollectionOrderGeminiJobState => {
    return geminiJobByOrderId[orderId] ?? makeEmptyGeminiJob();
  };

  const patchGeminiJob = (orderId: string, patch: Partial<CollectionOrderGeminiJobState>) => {
    setGeminiJobByOrderId((prev) => {
      const current = prev[orderId] ?? makeEmptyGeminiJob();
      return {
        ...prev,
        [orderId]: { ...current, ...patch },
      };
    });
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
    setPendingUndTot((prev) => {
      if (!(lineId in prev)) return prev;
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
    setPendingPesoTot((prev) => {
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

  const persistOrder = useCallback(
    async (params: { order: CollectionOrder; showAlerts: boolean }) => {
      const { order, showAlerts } = params;
      const maxExisting = Math.max(0, ...orders.map((o) => parseOrderNumber(o.numero)));
      const suggested = String(maxExisting + 1);
      const numeroRaw = String(order.numero ?? "").trim();
      const numero = numeroRaw || suggested;
      const payload: CollectionOrder = {
        ...order,
        numero,
        updatedAt: new Date().toISOString(),
      };
      const exists = orders.some((o) => o.id === payload.id);
      if (showAlerts) setSaveBusy(true);
      try {
        if (exists) await updateCollectionOrder(payload);
        else await insertCollectionOrder(payload);
        setOrders((prev) => {
          const rest = prev.filter((o) => o.id !== payload.id);
          return [payload, ...rest];
        });
        setEditing((prev) => (prev && prev.id === payload.id ? payload : prev));
        if (showAlerts) alert(`Orden guardada. Número: ${numero}.`);
      } catch (e) {
        console.error(e);
        if (showAlerts) {
          alert("No se pudo guardar. ¿Aplicaste la migración SQL `collection_orders` en Supabase?");
        }
      } finally {
        if (showAlerts) setSaveBusy(false);
      }
    },
    [orders],
  );

  const saveOrder = async () => {
    if (!editing) return;
    const mergedLines = mergePendingTotalsIntoLines(
      editing.lines,
      unitsMode,
      weightMode,
      pendingUndTot,
      pendingPesoTot,
    );
    setPendingUndTot({});
    setPendingPesoTot({});
    const mergedOrder: CollectionOrder = { ...editing, lines: mergedLines };
    setEditing(mergedOrder);
    await persistOrder({ order: mergedOrder, showAlerts: true });
  };

  const scheduleAutoSave = useCallback(
    (order: CollectionOrder | null) => {
      if (!order || !userEmail) return;
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => {
        autoSaveTimerRef.current = null;
        void persistOrder({ order, showAlerts: false });
      }, 1200);
    },
    [persistOrder, userEmail],
  );

  useEffect(() => {
    scheduleAutoSave(editing);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [editing, scheduleAutoSave]);

  const deleteOrder = async (o: CollectionOrder) => {
     
    if (
      !confirm(
        `¿Eliminar la orden de recolección #${String(o.numero ?? "").trim() || o.id.slice(0, 8)}?`,
      )
    )
      return;
    try {
      await deleteCollectionOrderById(o.id);
      setOrders((prev) => prev.filter((x) => x.id !== o.id));
      if (editing?.id === o.id) setEditing(null);
    } catch (e) {
      console.error(e);
       
      alert("No se pudo eliminar en Supabase.");
    }
  };

  const deleteSelectedOrders = async () => {
    const selected = orders.filter((o) => selectedOrderIds[o.id] === true);
    if (selected.length === 0) {
      alert("Seleccioná al menos una orden.");
      return;
    }
    const labels = selected.map((o) => `#${String(o.numero ?? "").trim() || o.id.slice(0, 8)}`);
    const preview =
      labels.length <= 8 ? labels.join(", ") : `${labels.slice(0, 8).join(", ")}… (+${labels.length - 8})`;
    if (
      !confirm(
        `¿Eliminar ${selected.length} orden(es) de recolección?\n${preview}`,
      )
    ) {
      return;
    }
    let failed = 0;
    const deletedIds: string[] = [];
    for (const o of selected) {
      try {
        await deleteCollectionOrderById(o.id);
        deletedIds.push(o.id);
      } catch (e) {
        console.error(e);
        failed += 1;
      }
    }
    const deletedSet = new Set(deletedIds);
    setOrders((prev) => prev.filter((x) => !deletedSet.has(x.id)));
    setGeminiJobByOrderId((prev) => {
      const next = { ...prev };
      for (const id of deletedIds) delete next[id];
      return next;
    });
    setSelectedOrderIds((prev) => {
      const next = { ...prev };
      for (const id of deletedIds) delete next[id];
      return next;
    });
    if (editing && deletedSet.has(editing.id)) setEditing(null);
    if (failed > 0) {
      alert(`${failed} orden(es) no se pudieron eliminar. Revisá Supabase y reintentá.`);
      void reloadOrders();
    }
  };

  const downloadSelectedListMagaya = useCallback(async () => {
    const selected = orders.filter((o) => selectedOrderIds[o.id] === true);
    if (selected.length === 0) {
      alert("Seleccioná al menos una orden.");
      return;
    }
    const sections = selected.map((o) => ({
      measureRows: o.lines as unknown as Record<string, unknown>[],
    }));
    if (countInventarioCsvRowsBulk(sections) === 0) {
      alert("Las órdenes seleccionadas no tienen líneas con datos para exportar.");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    await downloadMagayaReferenciasExcelFromSections({
      sections,
      filenameBase: `magaya-recoleccion-varias-${stamp}`,
    });
  }, [orders, selectedOrderIds]);

  const downloadSelectedListInventarioExcel = useCallback(async () => {
    const selected = orders.filter((o) => selectedOrderIds[o.id] === true);
    if (selected.length === 0) {
      alert("Seleccioná al menos una orden.");
      return;
    }
    const sections = selected.map((o) => ({
      numeroDocumento: String(o.numero ?? "").trim() || o.id.slice(0, 8),
      measureRows: o.lines as unknown as Record<string, unknown>[],
    }));
    if (countInventarioCsvRowsBulk(sections) === 0) {
      alert("Las órdenes seleccionadas no tienen líneas con datos para exportar.");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    await downloadInventarioExcelFromSections({
      sections,
      variant: "detailed",
      filenameBase: `recoleccion-inventario-${stamp}`,
      sheetName: "Inventario",
    });
  }, [orders, selectedOrderIds]);

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
          pesoPiezaKg: "",
          l: "",
          w: "",
          h: "",
          magayaModelo: "",
          paisOrigen: "",
          tejido: "",
          talla: "",
          forro: "",
          genero: "",
          composicion: "",
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

  const mergedEditorLinesPreview = useMemo((): CollectionOrderLine[] => {
    if (!editing) return [];
    return mergePendingTotalsIntoLines(
      editing.lines,
      unitsMode,
      weightMode,
      pendingUndTot,
      pendingPesoTot,
    );
  }, [editing, unitsMode, weightMode, pendingUndTot, pendingPesoTot]);

  /** Mismas reglas que la tabla: bultos, peso (kg) y CBM total por línea. */
  const editorAggregatedTotals = useMemo(() => {
    let totalBultos = 0;
    let totalPesoKg = 0;
    let totalCbm = 0;
    for (const row of mergedEditorLinesPreview) {
      const bultos = parseFloat(String(row.bultos ?? 0).replace(",", ".")) || 0;
      totalBultos += Math.max(0, Math.round(bultos));
      totalPesoKg += pesoTotalFromLine(row);
      const l = parseFloat(String(row.l ?? 0).replace(",", ".")) || 0;
      const w = parseFloat(String(row.w ?? 0).replace(",", ".")) || 0;
      const h = parseFloat(String(row.h ?? 0).replace(",", ".")) || 0;
      const cbmBulto = (l * w * h) / 1_000_000;
      totalCbm += cbmBulto * bultos;
    }
    return { totalBultos, totalPesoKg, totalCbm };
  }, [mergedEditorLinesPreview]);

  const transferLinesCount = useMemo(
    () => mergedEditorLinesPreview.filter(lineHasData).length,
    [mergedEditorLinesPreview],
  );

  const tasksEligibleForCollectionTransfer = useMemo(() => {
    if (!editing) return [];
    return tasks.filter(
      (t) => !taskIsBlockedForCollectionOrder(t, editing.id, orders),
    );
  }, [tasks, editing, orders]);

  const transferTargetsExcluded =
    tasks.length > 0 && tasksEligibleForCollectionTransfer.length === 0;

  const confirmTransfer = async (taskId: string, merge: "append" | "replace") => {
    if (!editing) return;
    const mergedLines = mergePendingTotalsIntoLines(
      editing.lines,
      unitsMode,
      weightMode,
      pendingUndTot,
      pendingPesoTot,
    );
    const lines = mergedLines.filter(lineHasData);
    if (lines.length === 0) {
       
      alert("No hay líneas con datos para enviar.");
      return;
    }
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
       
      alert("RA no encontrado.");
      return;
    }
    if (taskIsBlockedForCollectionOrder(task, editing.id, orders)) {
       
      alert(
        "Este RA ya está vinculado a otra orden de recolección. Cada RA solo puede recibir una orden distinta.",
      );
      return;
    }
    setPendingUndTot({});
    setPendingPesoTot({});
    const orderWithMergedLines: CollectionOrder = { ...editing, lines: mergedLines };
    setEditing(orderWithMergedLines);
    setTransferBusy(true);
    try {
      const existsInDb = orders.some((o) => o.id === orderWithMergedLines.id);
      const baseOrder: CollectionOrder = {
        ...orderWithMergedLines,
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
      const sanitizedMeasure = JSON.parse(JSON.stringify(nextMeasure)) as unknown[];
      const updatedTask: Task = {
        ...task,
        measureData: sanitizedMeasure,
        linkedCollectionOrderId: baseOrder.id,
      };
      await onUpdateTask(updatedTask);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(`detailed_inventory_draft_v1_${task.id}`);
        window.localStorage.removeItem(`quick_inventory_draft_v1_${task.id}`);
        window.localStorage.removeItem(`airway_inventory_draft_v1_${task.id}`);
      }
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
    const listSelectedCount = orders.filter((o) => selectedOrderIds[o.id] === true).length;
    const toggleListSelectAll = () => {
      if (orders.length === 0) return;
      if (listSelectedCount === orders.length) {
        setSelectedOrderIds({});
        return;
      }
      const next: Record<string, boolean> = {};
      for (const o of orders) next[o.id] = true;
      setSelectedOrderIds(next);
    };

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
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-600 dark:bg-slate-900">
              <button
                type="button"
                onClick={toggleListSelectAll}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {listSelectedCount === orders.length ? "Quitar selección" : "Seleccionar todo"}
              </button>
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                Seleccionadas: {listSelectedCount}
              </span>
              <button
                type="button"
                disabled={listSelectedCount === 0}
                onClick={() => void downloadSelectedListMagaya()}
                title="Un solo Excel Magaya (hoja «Magaya»): órdenes en bloques con color alternado."
                className="rounded-xl border-2 border-amber-400/80 bg-gradient-to-r from-amber-100 to-orange-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-950 shadow-sm hover:from-amber-200 hover:to-orange-100 disabled:opacity-40 dark:border-amber-500/40 dark:from-amber-950/50 dark:to-orange-950/30 dark:text-amber-100 dark:hover:from-amber-900/60 dark:hover:to-orange-950/40"
              >
                <span className="inline-flex items-center gap-1.5">
                  <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Magaya
                </span>
              </button>
              <button
                type="button"
                disabled={listSelectedCount === 0}
                onClick={() => void downloadSelectedListInventarioExcel()}
                title="Mismas columnas que «Descargar CSV» en cada orden (detallado). Archivo Excel con franjas de color suaves por orden; el formato .csv no puede llevar colores."
                className="rounded-xl border-2 border-cyan-400/80 bg-cyan-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-cyan-900 shadow-sm hover:bg-cyan-100 disabled:opacity-40 dark:border-cyan-500/50 dark:bg-cyan-950/35 dark:text-cyan-100 dark:hover:bg-cyan-950/55"
              >
                <span className="inline-flex items-center gap-1.5">
                  <FileSpreadsheet className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Inventario
                </span>
              </button>
              <button
                type="button"
                disabled={listSelectedCount === 0}
                onClick={() => void deleteSelectedOrders()}
                className="ml-auto rounded-xl border-2 border-red-200 bg-red-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-red-700 shadow-sm hover:bg-red-100 disabled:opacity-40 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60"
              >
                Eliminar seleccionadas
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {orders.map((o) => {
              const job = geminiJobByOrderId[o.id];
              const analyzing = job?.busy === true;
              const refCount = listReferenciasCount(o.lines);
              const bultosTot = listBultosTotal(o.lines);
              const refWord = refCount === 1 ? "referencia" : "referencias";
              const orderLabel = String(o.numero ?? "").trim() || o.id.slice(0, 8);
              return (
                <div
                  key={o.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openEdit(o)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      openEdit(o);
                    }
                  }}
                  aria-label={`Abrir orden #${orderLabel}`}
                  className="group relative flex cursor-pointer flex-col gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 pl-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:hover:border-indigo-500/50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-indigo-500 to-sky-500 opacity-70" />
                  <label
                    className="relative z-[1] flex shrink-0 cursor-pointer items-center self-start pt-0.5 sm:self-center"
                    onClick={(ev) => ev.stopPropagation()}
                    onKeyDown={(ev) => ev.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selectedOrderIds[o.id] === true}
                      onChange={(ev) =>
                        setSelectedOrderIds((p) => ({
                          ...p,
                          [o.id]: ev.target.checked,
                        }))
                      }
                      onClick={(ev) => ev.stopPropagation()}
                      className="h-4 w-4 rounded border-slate-300 accent-indigo-600 focus:ring-2 focus:ring-indigo-500"
                      aria-label={`Seleccionar orden ${orderLabel}`}
                    />
                  </label>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="truncate text-sm font-black text-[#16263F] dark:text-slate-100">
                        Orden #{String(o.numero ?? "S/N")}
                      </p>
                      {analyzing && <CollectionOrderAiAnalyzingInline />}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span
                        className="inline-flex items-baseline gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 shadow-sm dark:border-slate-600 dark:bg-slate-800/90"
                        title="Referencias con número de parte"
                      >
                        <span className="text-base font-black tabular-nums leading-none text-[#16263F] dark:text-slate-100">
                          {refCount}
                        </span>
                        <span className="text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {refWord}
                        </span>
                      </span>
                      <span
                        className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 shadow-sm dark:border-violet-500/35 dark:bg-violet-950/45 dark:shadow-violet-950/20"
                        title="Total de bultos en la orden"
                      >
                        <span className="text-[10px] font-black uppercase tracking-wide text-violet-600 dark:text-violet-300">
                          Bultos
                        </span>
                        <span className="text-xl font-black tabular-nums leading-none text-violet-600 dark:text-violet-200">
                          {bultosTot}
                        </span>
                      </span>
                      <span
                        className={
                          o.status === "sent"
                            ? "rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300"
                            : "rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300"
                        }
                      >
                        {o.status === "sent" ? "Enviada al almacén" : "Borrador"}
                      </span>
                      {o.linkedRaNumbers && o.linkedRaNumbers.length > 0 && (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          RA: {o.linkedRaNumbers.join(", ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <span className="rounded-xl border-2 border-slate-200 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 group-hover:border-indigo-200 group-hover:bg-indigo-50/50 group-hover:text-indigo-700 dark:border-slate-600 dark:text-slate-400 dark:group-hover:border-indigo-500/40 dark:group-hover:bg-indigo-950/30 dark:group-hover:text-indigo-200">
                      Abrir
                    </span>
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        void deleteOrder(o);
                      }}
                      className="relative z-[1] rounded-xl border-2 border-red-100 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-red-600 hover:bg-red-50 dark:border-red-900/40 dark:text-red-400"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              );
            })}
            </div>
          </>
        )}
      </div>
    );
  }

  /* ——— Editor ——— */
  const e = editing;
  const maxExistingNumber = Math.max(0, ...orders.map((o) => parseOrderNumber(o.numero)));
  const suggestedNumber = String(maxExistingNumber + 1);
  const orderId = e.id;
  const geminiJob = getGeminiJob(orderId);

  const sendToGemini = async (args: { text: string; file: File | null }) => {
    const text = String(args.text ?? "").trim();
    const f = args.file;
    if (!text && !f) return;

    const userVisible = [text, f ? `📎 ${f.name}` : ""].filter(Boolean).join("\n");
    const nextHistory = [...geminiJob.history, { role: "user", text: userVisible } as const];
    patchGeminiJob(orderId, {
      errorBanner: null,
      busy: true,
      history: nextHistory,
      pendingFileName: f ? f.name : null,
    });

    const contextHint =
      e.lines.map((r) => String(r.referencia ?? "").trim()).filter(Boolean).length > 0
        ? `Referencias ya cargadas en la orden (no duplicar salvo corrección): ${e.lines
            .map((r) => String(r.referencia ?? "").trim())
            .filter(Boolean)
            .slice(0, 40)
            .join(", ")}${e.lines.filter((r) => String(r.referencia ?? "").trim()).length > 40 ? "…" : ""}`
        : undefined;

    try {
      const filePromise =
        f != null
          ? prepareGeminiAttachment(f, f.type || "application/octet-stream")
          : Promise.resolve(undefined);
      const [sessionOutcome, fileOutcome] = await Promise.allSettled([
        supabase.auth.getSession(),
        filePromise,
      ]);

      if (sessionOutcome.status === "rejected") {
        patchGeminiJob(orderId, {
          errorBanner: { text: "No se pudo comprobar la sesión. Reintenta." },
          busy: false,
        });
        return;
      }
      if (fileOutcome.status === "rejected") {
        patchGeminiJob(orderId, {
          errorBanner: { text: "No se pudo leer o optimizar el archivo adjunto." },
          busy: false,
        });
        return;
      }

      const token = sessionOutcome.value.data.session?.access_token;
      if (!token) {
        patchGeminiJob(orderId, {
          errorBanner: { text: "Sesión expirada. Vuelve a iniciar sesión.", code: 401 },
          busy: false,
        });
        return;
      }

      const outboundMessage = (text || "Analiza el documento adjunto y extrae las líneas.").slice(
        0,
        28_000,
      );

      const res = await postCollectionOrderGemini(token, {
        message: outboundMessage,
        history: nextHistory.map((t) => ({
          role: t.role,
          text: String(t.text ?? "").slice(0, 6500),
        })),
        attachment: fileOutcome.value,
        orderNumber: String(e.numero ?? "").trim() || undefined,
        contextHint,
        viewerDisplayName: String(userDisplayName ?? "").trim() || undefined,
      });

      let data: {
        error?: string;
        reply?: string;
        lines?: CollectionGeminiLine[];
        usage?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        } | null;
      };
      try {
        const ct = res.headers.get("content-type") || "";
        if (!ct.toLowerCase().includes("application/json")) {
          throw new Error("non_json_response");
        }
        data = (await res.json()) as typeof data;
      } catch {
        const hint =
          res.status === 504
            ? "Se agotó el tiempo de espera (504). Probá con un PDF más liviano o dividido, o reintenta en unos segundos."
            : "La respuesta no fue JSON (posible gateway/proxy). Reintenta en unos segundos.";
        patchGeminiJob(orderId, {
          errorBanner: {
            text: `Error ${res.status}. ${hint}`,
            code: res.status,
          },
          busy: false,
        });
        return;
      }

      if (!res.ok) {
        patchGeminiJob(orderId, {
          errorBanner: { text: data.error || `Error ${res.status}`, code: res.status },
          busy: false,
        });
        return;
      }

      const reply = String(data.reply ?? "");
      const lines = Array.isArray(data.lines) ? data.lines : [];
      const usageSummary = recordGeminiRequestSuccess(data.usage ?? null);

      patchGeminiJob(orderId, {
        lastLines: lines,
        usageSummary,
        history: [...nextHistory, { role: "model", text: reply } as const],
        pendingFileName: null,
        busy: false,
      });
      // Auto-aplicar y autoguardar siempre.
      applyGeminiLinesToOrder(lines);
    } catch (err) {
      const text =
        err instanceof DOMException && err.name === "TimeoutError"
          ? err.message
          : err instanceof Error
            ? err.message
            : "Error de red (revisa tu conexión).";
      patchGeminiJob(orderId, {
        errorBanner: { text },
        busy: false,
      });
    }
  };

  const applyGeminiLinesToOrder = (incoming?: CollectionGeminiLine[]) => {
    const source = Array.isArray(incoming)
      ? incoming
      : (geminiJobByOrderId[orderId]?.lastLines ?? []);
    const useful = source.filter(
      (row) =>
        row.referencia ||
        row.descripcion ||
        row.bultos ||
        row.unidadesPorBulto ||
        row.unidadesTotales ||
        row.pesoUnaPiezaKg ||
        row.pesoPorBulto ||
        row.pesoTotalKg ||
        row.l ||
        row.w ||
        row.h ||
        row.volumenM3 ||
        row.modelo ||
        row.paisOrigen ||
        row.tejido ||
        row.talla ||
        row.forro ||
        row.genero ||
        row.composicion,
    );
    if (useful.length === 0) return;
    const additions: CollectionOrderLine[] = useful.map((row) => ({
      id: generateId(),
      ...normalizeCollectionOrderLineFromImport(row),
    }));
    const baseOrder =
      (editing && editing.id === orderId
        ? editing
        : orders.find((o) => o.id === orderId)) ?? e;
    const nextOrder: CollectionOrder = {
      ...baseOrder,
      lines: [...(baseOrder.lines || []), ...additions],
    };
    patchGeminiJob(orderId, { lastLines: [] });
    void persistOrder({ order: nextOrder, showAlerts: false });
  };

  return (
    <>
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
            onClick={() => {
              const rows = e.lines as unknown as Record<string, unknown>[];
              if (countInventarioCsvRows(rows) === 0) {
                alert("No hay líneas con datos para exportar.");
                return;
              }
              void downloadMagayaReferenciasExcel({
                measureRows: rows,
                filenameBase: `magaya-recoleccion-${e.id.slice(0, 8)}`,
              });
            }}
            title="Magaya: plantilla Excel con 18 columnas; columna «cantidad por bulto» se ve como entero (0 decimales) pero conserva el valor exacto al seleccionar la celda."
            className="flex items-center gap-2 rounded-xl border-2 border-amber-500/80 bg-gradient-to-r from-amber-100 to-orange-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-950 shadow-sm hover:from-amber-200 hover:to-orange-100 dark:border-amber-500/40 dark:from-amber-950/50 dark:to-orange-950/30 dark:text-amber-100"
          >
            <FileSpreadsheet className="h-4 w-4" /> Magaya
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
            disabled={saveBusy}
            onClick={() => setGeminiOpen(true)}
            title={`${AI_ASSISTANT_DISPLAY_NAME}: PDF, imagen o texto`}
            className={`alde-ia-trigger flex items-center gap-2 rounded-full border border-slate-200/90 bg-white px-3.5 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-[#1e1f20] dark:text-slate-100 dark:hover:bg-[#282a2c] ${
              geminiJob.busy ? "alde-ia-trigger--busy" : ""
            }`}
          >
            {geminiJob.busy ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-500" aria-hidden />
            ) : (
              <GeminiSparkIcon size={18} className="shrink-0" />
            )}
            {AI_ASSISTANT_DISPLAY_NAME}
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

        {geminiJob.busy && (
          <div
            role="status"
            aria-live="polite"
            className="sticky top-0 z-30 mb-2 shrink-0 rounded-xl border border-slate-200 bg-[#e8f0fe]/95 px-2.5 py-1.5 shadow-md dark:border-slate-600 dark:bg-[#131314]/90"
          >
            <CollectionOrderAiAnalyzingStrip
              inlineRow
              label={`${AI_ASSISTANT_DISPLAY_NAME} · analizando documento…`}
            />
          </div>
        )}

        <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
          Paso 1 · Número de orden · Paso 2 · Líneas · Paso 3 · Pasar al RA
        </p>

        <div className="mb-3 grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-white to-indigo-50/60 px-3 py-2 shadow-sm dark:border-indigo-900/50 dark:from-slate-900 dark:to-indigo-950/20">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Cantidad de bultos
            </p>
            <p className="mt-1 text-lg font-black tabular-nums text-[#16263F] dark:text-slate-100">
              {editorAggregatedTotals.totalBultos.toLocaleString("es")}
            </p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 shadow-sm dark:border-emerald-900/40 dark:bg-emerald-950/20">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
              Peso total (kg)
            </p>
            <p className="mt-1 text-lg font-black tabular-nums text-emerald-800 dark:text-emerald-200">
              {editorAggregatedTotals.totalPesoKg.toLocaleString("es", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </div>
          <div className="rounded-xl border border-sky-200 bg-sky-50/80 px-3 py-2 shadow-sm dark:border-sky-900/40 dark:bg-sky-950/25">
            <p className="text-[10px] font-black uppercase tracking-widest text-sky-800 dark:text-sky-200">
              Cubicaje total (m³)
            </p>
            <p className="mt-1 text-lg font-black tabular-nums text-sky-900 dark:text-sky-100">
              {editorAggregatedTotals.totalCbm.toLocaleString("es", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </div>
        </div>

        <div className="mb-3 shrink-0 rounded-2xl border-2 border-indigo-200 bg-white p-4 shadow-md dark:border-indigo-900/45 dark:bg-slate-900 max-w-md">
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
                  const totalUndRounded = Math.round(totUnd);
                  const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
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
                          type={focusedUndBultoRowId === row.id ? "number" : "text"}
                          value={displayUndBultoValue({
                            rowId: row.id,
                            raw: String(row.unidadesPorBulto ?? ""),
                            focusedUndBultoRowId,
                            draftByRow: undBultoDraft,
                          })}
                          disabled={unitsMode === "total"}
                          onFocus={() => {
                            if (unitsMode === "total") return;
                            setFocusedUndBultoRowId(row.id);
                            setUndBultoDraft((prev) => ({
                              ...prev,
                              [row.id]: String(row.unidadesPorBulto ?? ""),
                            }));
                          }}
                          onChange={(ev) =>
                            (() => {
                              const next = sanitizeQtyPerBundleInput(ev.target.value);
                              setUndBultoDraft((prev) => ({ ...prev, [row.id]: next }));
                              updateLine(row.id, { unidadesPorBulto: next });
                            })()
                          }
                          onBlur={() => {
                            setFocusedUndBultoRowId((prev) => (prev === row.id ? null : prev));
                          }}
                          inputMode="decimal"
                          step="any"
                          className={`no-spinners w-full rounded-lg border px-1 py-1 text-center text-xs transition dark:bg-slate-950 ${
                            unitsMode === "total"
                              ? "border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-500"
                              : "border-slate-200 dark:border-slate-600"
                          }`}
                        />
                      </td>
                      <td className="bg-slate-50/80 px-2 py-1 text-center text-sm font-black text-[#16263F] dark:bg-slate-800/60 dark:text-slate-100">
                        {totalUndRounded}
                      </td>
                      <td className="px-2 py-1 w-24 bg-slate-50/70 dark:bg-slate-800/60">
                        <input
                          type="number"
                          disabled={unitsMode === "per_bundle"}
                          title="Si llenas unidades totales, al salir recalcula und/bulto con los bultos actuales"
                          value={
                            unitsMode === "total"
                              ? pendingUndTot[row.id] !== undefined
                                ? pendingUndTot[row.id]!
                                : totUnd > 0
                                  ? String(Math.round(totUnd))
                                  : ""
                              : ""
                          }
                          onChange={(ev) => {
                            if (unitsMode !== "total") return;
                            setPendingUndTot((p) => ({
                              ...p,
                              [row.id]: sanitizeIntegerInput(ev.target.value),
                            }));
                          }}
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
                            setPendingUndTot((p) => {
                              const n = { ...p };
                              delete n[row.id];
                              return n;
                            });
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
                          value={
                            weightMode === "total"
                              ? pendingPesoTot[row.id] !== undefined
                                ? pendingPesoTot[row.id]!
                                : pesoTot > 0
                                  ? pesoTot.toFixed(2)
                                  : ""
                              : pesoTot > 0
                                ? pesoTot.toFixed(2)
                                : ""
                          }
                          onChange={(ev) => {
                            if (weightMode !== "total") return;
                            setPendingPesoTot((p) => ({
                              ...p,
                              [row.id]: sanitizeDecimalInput(ev.target.value, 2),
                            }));
                          }}
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
                            setPendingPesoTot((p) => {
                              const n = { ...p };
                              delete n[row.id];
                              return n;
                            });
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

      <InventoryCsvExportModal
        open={csvOpen}
        raLabel={`Recolección · orden ${String(e.numero ?? "").trim() || e.id.slice(0, 8)}`}
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
        tasks={tasksEligibleForCollectionTransfer}
        lineCount={transferLinesCount}
        busy={transferBusy}
        noEligibleTargets={transferTargetsExcluded}
        onCancel={() => setTransferOpen(false)}
        onConfirm={(taskId, merge) => void confirmTransfer(taskId, merge)}
      />

      <CollectionOrderGeminiPanel
        open={geminiOpen}
        onClose={() => setGeminiOpen(false)}
        orderNumber={String(e.numero ?? "").trim()}
        viewerDisplayName={userDisplayName}
        existingReferencias={e.lines
          .map((r) => String(r.referencia ?? "").trim())
          .filter(Boolean)
          .slice(0, 80)}
        job={geminiJob}
        onChangeJob={(patch) => patchGeminiJob(orderId, patch)}
        onSend={sendToGemini}
        onApplyLines={applyGeminiLinesToOrder}
      />
    </>
  );
}
