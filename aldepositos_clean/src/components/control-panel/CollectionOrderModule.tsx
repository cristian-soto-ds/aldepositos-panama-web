"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  FileCode,
  FileSpreadsheet,
  HandHelping,
  Loader2,
  Plus,
  Save,
  Send,
  Trash2,
  Recycle,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  CheckSquare,
} from "lucide-react";
import { GeminiSparkIcon } from "@/components/ui/GeminiSparkIcon";
import type { Task } from "@/lib/types/task";
import type { CollectionOrder, CollectionOrderLine } from "@/lib/types/collectionOrder";
import {
  deleteCollectionOrderById,
  insertCollectionOrder,
  parseCollectionOrderNumber,
  sortCollectionOrdersByNumero,
  updateCollectionOrder,
  upsertCollectionOrderInList,
} from "@/lib/collectionOrders";
import { syncCollectionOrderToReceptionQueue } from "@/lib/receptionLogistics/repository";
import {
  cubicajeM3FromDims,
  formatCubicaje2,
  formatMeasure2,
  normalizeMeasureField,
  roundMeasureNearest,
  roundUpMeasure,
  sanitizeMeasureTyping,
} from "@/lib/measureDecimals";
import { CollectionOrderListTabs } from "@/components/control-panel/CollectionOrderListTabs";
import { DeleteRaConfirmModal } from "@/components/modals/DeleteRaConfirmModal";
import {
  countOrdersForCollectionListTab,
  isOrderInWarehouse,
  isOrderWithoutInventory,
  orderHasLinkedRa,
  ordersForCollectionListTab,
  type CollectionOrderListTab,
} from "@/lib/collectionOrderListTabs";
import { useSupabaseCollectionOrders } from "@/hooks/useSupabaseCollectionOrders";
import {
  getSharedWorkPresenceTabId,
} from "@/lib/panelPresence";
import {
  isForeignLiveUpdate,
  scheduleOrderLivePublish,
  subscribeLiveUpdates,
} from "@/lib/liveCollaboration";
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
import { GeneralChatGptPanel } from "@/components/control-panel/GeneralChatGptPanel";
import { AldeGptTerraIcon } from "@/components/ui/AldeGptTerraBrand";
import { ALDEGPT_TERRA_DISPLAY_NAME } from "@/lib/aldeGptTerraBrand";
import {
  aldeGptTerraLineToImportInput,
  collectionLineDedupeKey,
  ALDEGPT_TERRA_REFS_BULTOS_PROMPT,
  type AldeGptTerraLine,
} from "@/lib/aldeGptTerraDocumentExtract";
import { AI_ASSISTANT_DISPLAY_NAME } from "@/lib/aiAssistantBrand";
import { TransferCollectionToRaModal } from "@/components/modals/TransferCollectionToRaModal";
import { ImportCollectionOrdersHtmModal } from "@/components/modals/ImportCollectionOrdersHtmModal";
import {
  HtmImportResultModal,
  type HtmImportResultSummary,
} from "@/components/modals/HtmImportResultModal";
import { classifyHtmCollectionOrders } from "@/lib/parseCollectionOrdersHtm";
import type { CollectionGeminiLine } from "@/lib/collectionOrderGeminiSchema";
import {
  applyPesoTotalToLine,
  applyUnidadesTotalesToLine,
  collectionLinesToRaMeasureData,
  lineHasData,
  pesoTotalFromLine,
  sanitizeMeasureDataForTarget,
  unidadesTotalesFromLine,
} from "@/lib/collectionLineUtils";
import { mergeCollectionOrderIntoTask } from "@/lib/collectionOrderToTask";
import {
  normalizeCollectionOrderFields,
  reconcileCollectionOrder,
  totalsFromCapturedLines,
} from "@/lib/collectionOrderReconcile";
import { mergeConcurrentCollectionLines } from "@/lib/collectionOrderLineMerge";
import { supabase } from "@/lib/supabase";
import { prepareGeminiAttachment } from "@/lib/geminiClientAttachment";
import { postCollectionOrderGemini } from "@/lib/geminiCollectionOrderApi";
import { toRefsBultosOnlyLines } from "@/lib/geminiRefsBultosMode";
import { remapWeightMisfiledAsWidth } from "@/lib/collectionOrderGeminiPostProcess";
import {
  recordGeminiRequestSuccess,
} from "@/lib/geminiClientUsage";

const generateId = () => Math.random().toString(36).slice(2, 11);
/** Autosave más lento: 300 ms pisaba filas nuevas y saturaba Realtime. */
const ORDER_AUTOSAVE_MS = 1500;

type CollectionOrderDeleteConfirm =
  | { kind: "single"; order: CollectionOrder }
  | { kind: "bulk"; orders: CollectionOrder[] };

function collectionOrderDeleteLabel(o: CollectionOrder): string {
  return `#${String(o.numero ?? "").trim() || o.id.slice(0, 8)}`;
}

function collectionOrderClientHint(o: CollectionOrder): string | undefined {
  const hint = [o.cliente, o.proveedor]
    .map((s) => String(s ?? "").trim())
    .filter(Boolean)
    .join(" · ");
  return hint || undefined;
}

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
  return formatMeasure2(value);
}

/** Muestra 2 decimales si el valor guardado trae más (p. ej. 26.0000 → 26.00). */
function displayMeasureInput(value: string | number | undefined): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const dot = s.indexOf(".");
  if (dot >= 0 && s.length - dot - 1 > 2) {
    return formatWeight(s);
  }
  return s;
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

/** Bultos mostrados en lista: total del documento si existe, si no suma de líneas. */
function orderDisplayBultos(order: CollectionOrder): number {
  if (order.expectedBultos != null && order.expectedBultos > 0) {
    return Math.round(order.expectedBultos);
  }
  return listBultosTotal(order.lines);
}

/** Barra indeterminada + texto mientras la IA analiza el documento */
function CollectionOrderAiAnalyzingStrip(props: {
  label: string;
  className?: string;
  dense?: boolean;
  /** Una sola fila: barra flexible + texto (menos alto). */
  inlineRow?: boolean;
  brand?: "gemini" | "terra";
}) {
  const { label, className, dense, inlineRow, brand = "gemini" } = props;
  const BrandIcon =
    brand === "terra" ? (
      <AldeGptTerraIcon size={14} className="shrink-0" />
    ) : (
      <GeminiSparkIcon size={14} className="shrink-0" />
    );
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
            {BrandIcon}
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
        {BrandIcon}
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
function CollectionOrderAiAnalyzingInline(props: {
  brand?: "gemini" | "terra";
}) {
  const brand = props.brand ?? "gemini";
  const title =
    brand === "terra"
      ? `${ALDEGPT_TERRA_DISPLAY_NAME} está analizando el documento`
      : `${AI_ASSISTANT_DISPLAY_NAME} está analizando el documento`;
  return (
    <div
      className="inline-flex min-w-0 max-w-[11rem] shrink-0 flex-col gap-0.5 rounded-lg border border-slate-200 bg-white px-1.5 py-1 shadow-sm dark:border-slate-600 dark:bg-slate-900 sm:max-w-[13rem]"
      role="status"
      aria-live="polite"
      aria-busy="true"
      title={title}
    >
      <div className="relative h-1 w-full min-w-[4.5rem] overflow-hidden rounded-full bg-slate-200/90 dark:bg-slate-700/60">
        <div className="collection-order-ai-progress-fill" />
      </div>
      <span className="flex items-center gap-1 text-[8px] font-semibold leading-none tracking-wide text-slate-600 dark:text-slate-300">
        {brand === "terra" ? (
          <AldeGptTerraIcon size={10} className="shrink-0" />
        ) : (
          <GeminiSparkIcon size={10} className="shrink-0" />
        )}
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

/**
 * Filas para Descargar CSV / Magaya: aplica und captura pendientes y expone
 * `unidadesTotales` (= piezas totales extraídas) para la columna Cantidad.
 */
function linesForInventarioExport(
  lines: CollectionOrderLine[],
  unitsMode: "per_bundle" | "total",
  weightMode: "per_bundle" | "total",
  pendingUnd: Record<string, string>,
  pendingPeso: Record<string, string>,
): Record<string, unknown>[] {
  return mergePendingTotalsIntoLines(
    lines,
    unitsMode,
    weightMode,
    pendingUnd,
    pendingPeso,
  ).map((row) => {
    let totPiezas = 0;
    if (unitsMode === "total") {
      const raw = pendingUnd[row.id];
      if (raw !== undefined && String(raw).trim() !== "") {
        totPiezas =
          Math.round(parseFloat(sanitizeIntegerInput(raw)) || 0) || 0;
      }
    }
    if (totPiezas <= 0) {
      // Preferir tot de factura guardado (311) sobre bultos×und (48×6=288).
      totPiezas = Math.round(unidadesTotalesFromLine(row)) || 0;
    }
    const base = row as unknown as Record<string, unknown>;
    return totPiezas > 0 ? { ...base, unidadesTotales: totPiezas } : { ...base };
  });
}

const emptyLine = (): CollectionOrderLine => ({
  id: generateId(),
  referencia: "",
  descripcion: "",
  bultos: "",
  unidadesPorBulto: "",
  unidadesTotales: "",
  pesoPorBulto: "",
  pesoTotalKg: "",
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
  reempaque: false,
});

/** Fila placeholder sin datos (la OR arranca con una). */
function isBlankCollectionOrderLine(line: CollectionOrderLine): boolean {
  if (line.reempaque === true) return false;
  const hasText = [
    line.referencia,
    line.descripcion,
    line.unidadesPorBulto,
    line.unidadesTotales,
    line.pesoPorBulto,
    line.pesoTotalKg,
    line.pesoPiezaKg,
    line.l,
    line.w,
    line.h,
    line.magayaModelo,
  ].some((v) => String(v ?? "").trim().length > 0);
  if (hasText) return false;
  const bultos = parseFloat(String(line.bultos ?? "").replace(",", ".")) || 0;
  return bultos <= 0;
}

/** Solo líneas con dato útil (sin placeholders vacíos al final). */
function withoutBlankCollectionLines(
  lines: CollectionOrderLine[],
): CollectionOrderLine[] {
  return lines.filter((l) => !isBlankCollectionOrderLine(l));
}

function newDraftOrder(): CollectionOrder {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    numero: "",
    cliente: "",
    proveedor: "",
    notes: "",
    lines: [],
    status: "draft",
    linkedRaNumbers: [],
    createdAt: now,
    updatedAt: now,
  };
}

function parseOrderNumber(n: string | undefined): number {
  return parseCollectionOrderNumber(n);
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
    useSupabaseCollectionOrders({ enabled: !!userEmail, userKey: userEmail });

  const [editing, setEditing] = useState<CollectionOrder | null>(null);
  const [htmImportOpen, setHtmImportOpen] = useState(false);
  const [htmImportBusy, setHtmImportBusy] = useState(false);
  const [htmImportResult, setHtmImportResult] = useState<HtmImportResultSummary | null>(
    null,
  );
  const [saveBusy, setSaveBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferBusy, setTransferBusy] = useState(false);
  const [geminiOpen, setGeminiOpen] = useState(false);
  const [chatGptOpen, setChatGptOpen] = useState(false);
  const [terraJobByOrderId, setTerraJobByOrderId] = useState<
    Record<
      string,
      {
        busy: boolean;
        pendingFileName: string | null;
        progress: { current: number; total: number } | null;
      }
    >
  >({});
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
  /**
   * Peso/CBM del documento: se guardan como número, pero al escribir hay que
   * conservar el texto crudo (p.ej. "12.") para poder teclear el punto decimal.
   */
  const [expectedPesoDraft, setExpectedPesoDraft] = useState<string | null>(null);
  const [expectedCbmDraft, setExpectedCbmDraft] = useState<string | null>(null);
  /** Selección múltiple en la lista de órdenes (eliminar en lote). */
  const [selectedOrderIds, setSelectedOrderIds] = useState<Record<string, boolean>>({});
  /** Los checkboxes solo aparecen tras pulsar «Seleccionar». */
  const [listSelectMode, setListSelectMode] = useState(false);
  const [listTab, setListTab] = useState<CollectionOrderListTab>("general");
  const [deleteConfirm, setDeleteConfirm] = useState<CollectionOrderDeleteConfirm | null>(
    null,
  );
  const [deleteConfirmBusy, setDeleteConfirmBusy] = useState(false);

  const referenciasExcelRef = useRef<HTMLInputElement>(null);
  const catalogDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const catalogSeqRef = useRef<Record<string, number>>({});
  const editingRef = useRef<CollectionOrder | null>(null);
  const ordersRef = useRef<CollectionOrder[]>([]);
  const isOrderSavingRef = useRef(false);
  const saveGenerationRef = useRef(0);
  const lastSavedOrderHashRef = useRef("");
  const lastRemoteOrderHashRef = useRef("");
  /** Evita rebroadcast del estado que acabamos de recibir/fusionar. */
  const lastLivePublishedHashRef = useRef("");
  /** Último snapshot persistido (baseline para merge a 3 vías). */
  const serverBaselineLinesRef = useRef<CollectionOrderLine[]>([]);
  /** Remoto encolado solo mientras hay un save en curso. */
  const pendingRemoteOrderRef = useRef<CollectionOrder | null>(null);
  const prevEditingIdRef = useRef<string | null>(null);

  editingRef.current = editing;
  ordersRef.current = orders;

  const applyMergedRemote = useCallback((remote: CollectionOrder, fromLive: boolean) => {
    const current = editingRef.current;
    if (!current || current.id !== remote.id) return;

    const remoteLines = Array.isArray(remote.lines) ? remote.lines : [];
    const localLines = current.lines;
    const localHash = JSON.stringify(current);
    const isDirty = localHash !== lastSavedOrderHashRef.current;
    const remoteLinesHash = JSON.stringify(remoteLines);

    // Siempre fusionar en vivo (sin banner ni clic): merge a 3 vías conserva
    // lo que cada operador está tipando y aplica filas/campos del otro.
    const mergedLines = mergeConcurrentCollectionLines(
      serverBaselineLinesRef.current,
      localLines,
      remoteLines,
    );
    const mergedLinesHash = JSON.stringify(mergedLines);
    const localLinesHash = JSON.stringify(localLines);

    // Sin cambios de filas y sucio: no tocar React state.
    if (mergedLinesHash === localLinesHash && isDirty) {
      lastRemoteOrderHashRef.current = remoteLinesHash;
      pendingRemoteOrderRef.current = null;
      return;
    }

    // No pasar por normalizeCollectionOrderFields aquí: reformatea medidas y
    // dispara setEditing en bucle (UI trabada al tipear).
    const next: CollectionOrder = {
      ...current,
      ...(isDirty
        ? {}
        : {
            cliente: remote.cliente,
            proveedor: remote.proveedor,
            marca: remote.marca,
            expedidor: remote.expedidor,
            notes: remote.notes,
            expectedBultos: remote.expectedBultos,
            expectedPesoKg: remote.expectedPesoKg,
            expectedCbm: remote.expectedCbm,
            numero: remote.numero,
            status: remote.status,
            receptionStatus: remote.receptionStatus,
            linkedRaNumbers: remote.linkedRaNumbers,
            updatedAt: remote.updatedAt,
          }),
      lines: mergedLines,
      id: current.id,
    };

    const nextHash = JSON.stringify(next);
    if (nextHash === localHash) {
      lastRemoteOrderHashRef.current = remoteLinesHash;
      if (!fromLive && !isDirty) {
        serverBaselineLinesRef.current = JSON.parse(
          JSON.stringify(remoteLines),
        ) as CollectionOrderLine[];
        lastSavedOrderHashRef.current = JSON.stringify(remote);
      }
      pendingRemoteOrderRef.current = null;
      return;
    }

    setEditing(next);
    editingRef.current = next;
    lastRemoteOrderHashRef.current = remoteLinesHash;
    lastLivePublishedHashRef.current = mergedLinesHash;
    if (!fromLive && !isDirty) {
      serverBaselineLinesRef.current = JSON.parse(
        JSON.stringify(remoteLines),
      ) as CollectionOrderLine[];
      lastSavedOrderHashRef.current = nextHash;
    }
    pendingRemoteOrderRef.current = null;
  }, []);

  useEffect(() => {
    const id = editing?.id ?? null;
    if (id === prevEditingIdRef.current) return;
    prevEditingIdRef.current = id;
    const remote = id ? orders.find((o) => o.id === id) : null;
    lastRemoteOrderHashRef.current = remote ? JSON.stringify(remote.lines) : "";
    lastSavedOrderHashRef.current = remote ? JSON.stringify(remote) : "";
    lastLivePublishedHashRef.current = "";
    serverBaselineLinesRef.current = remote
      ? (JSON.parse(JSON.stringify(remote.lines)) as CollectionOrderLine[])
      : [];
    pendingRemoteOrderRef.current = null;
  }, [editing?.id, orders]);

  useEffect(() => {
    if (!editing?.id) return;
    const remote = orders.find((o) => o.id === editing.id);
    if (!remote) return;
    const remoteLinesHash = JSON.stringify(remote.lines);
    if (remoteLinesHash === lastRemoteOrderHashRef.current) return;

    if (isOrderSavingRef.current) {
      pendingRemoteOrderRef.current = remote;
      return;
    }

    applyMergedRemote(remote, false);
  }, [orders, editing?.id, applyMergedRemote]);

  useEffect(() => {
    const key = (userEmail ?? "").trim();
    if (!editing?.id || !key) return;
    const linesHash = JSON.stringify(editing.lines);
    const fullHash = JSON.stringify(editing);
    if (fullHash === lastSavedOrderHashRef.current) return;
    if (linesHash === lastLivePublishedHashRef.current) return;
    lastLivePublishedHashRef.current = linesHash;
    scheduleOrderLivePublish({
      orderId: editing.id,
      userKey: key,
      lines: editing.lines,
    });
  }, [editing, userEmail]);

  useEffect(() => {
    if (!editing?.id) return;
    const tabId = getSharedWorkPresenceTabId();
    const orderId = editing.id;
    return subscribeLiveUpdates((update) => {
      if (update.type !== "order" || update.orderId !== orderId) return;
      if (!isForeignLiveUpdate(update, tabId)) return;

      const liveHash = JSON.stringify(update.lines);
      if (liveHash === lastRemoteOrderHashRef.current) return;

      const current = editingRef.current;
      if (!current) return;

      if (isOrderSavingRef.current) {
        pendingRemoteOrderRef.current = { ...current, lines: update.lines };
        return;
      }

      applyMergedRemote({ ...current, lines: update.lines }, true);
    });
  }, [editing?.id, userEmail, applyMergedRemote]);

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
    setExpectedPesoDraft(null);
    setExpectedCbmDraft(null);
    setSelectedOrderIds({});
    setListSelectMode(false);
  };

  const openEdit = (o: CollectionOrder) => {
    setEditing(
      normalizeCollectionOrderFields(
        JSON.parse(JSON.stringify(o)) as CollectionOrder,
      ),
    );
    setUnresolvedRefByRow({});
    setPendingUndTot({});
    setPendingPesoTot({});
    setFocusedUndBultoRowId(null);
    setUndBultoDraft({});
    setExpectedPesoDraft(null);
    setExpectedCbmDraft(null);
    // No borrar la selección: si vuelves a la lista con «Lista», se conserva.
  };

  const backToList = () => {
    setEditing(null);
    setUnresolvedRefByRow({});
    setPendingUndTot({});
    setPendingPesoTot({});
    setFocusedUndBultoRowId(null);
    setUndBultoDraft({});
    setExpectedPesoDraft(null);
    setExpectedCbmDraft(null);
    void reloadOrders();
  };

  const exitListSelectMode = () => {
    setListSelectMode(false);
    setSelectedOrderIds({});
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

  /** Marca/desmarca reempaque: limpia bultos, peso y medidas (igual que en RA). */
  const toggleLineReempaque = (lineId: string) => {
    setEditing((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        lines: prev.lines.map((row) => {
          if (row.id !== lineId) return row;
          const nextFlag = !row.reempaque;
          if (nextFlag) {
            return {
              ...row,
              reempaque: true,
              bultos: "",
              unidadesPorBulto: "",
              pesoPorBulto: "",
              pesoPiezaKg: "",
              l: "",
              w: "",
              h: "",
              volumenM3: "",
            };
          }
          return { ...row, reempaque: false };
        }),
      };
    });
    setPendingUndTot((p) => {
      if (!(lineId in p)) return p;
      const next = { ...p };
      delete next[lineId];
      return next;
    });
    setPendingPesoTot((p) => {
      if (!(lineId in p)) return p;
      const next = { ...p };
      delete next[lineId];
      return next;
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
        lines: prev.lines.map((r) => {
          if (r.id !== rowId) return r;
          // No pisar cantidades/peso ya puestos por Terra / Alde.IA / el usuario.
          const next = { ...r };
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === null || value === "") continue;
            const cur = String(
              (r as Record<string, unknown>)[key] ?? "",
            ).trim();
            const preserveQty = [
              "unidadesPorBulto",
              "bultos",
              "pesoPorBulto",
              "pesoPiezaKg",
              "descripcion",
            ].includes(key);
            if (preserveQty && cur) continue;
            (next as Record<string, unknown>)[key] = value;
          }
          if (patch.referencia) next.referencia = patch.referencia;
          return next;
        }),
      };
    });
  }, []);

  const addRow = () => {
    setEditing((prev) => {
      if (!prev) return prev;
      const next = { ...prev, lines: [...prev.lines, emptyLine()] };
      editingRef.current = next;
      return next;
    });
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
      const filtered = prev.lines.filter((r) => r.id !== lineId);
      const next = {
        ...prev,
        lines: withoutBlankCollectionLines(filtered),
      };
      editingRef.current = next;
      return next;
    });
  };

  const persistOrder = useCallback(
    async (params: { order: CollectionOrder; showAlerts: boolean }) => {
      const { order, showAlerts } = params;
      const saveGen = ++saveGenerationRef.current;
      const normalizedOrder = normalizeCollectionOrderFields(order);

      // Fusionar con lo último conocido en lista (eco atrasado no debe borrar altas).
      const listRemote = orders.find((o) => o.id === normalizedOrder.id);
      const linesForSave = listRemote
        ? mergeConcurrentCollectionLines(
            serverBaselineLinesRef.current,
            normalizedOrder.lines,
            listRemote.lines,
          )
        : normalizedOrder.lines;

      const maxExisting = Math.max(0, ...orders.map((o) => parseOrderNumber(o.numero)));
      const suggested = String(maxExisting + 1);
      const numeroRaw = String(normalizedOrder.numero ?? "").trim();
      const numero = numeroRaw || suggested;
      const payload: CollectionOrder = {
        ...normalizedOrder,
        lines: linesForSave,
        numero,
        updatedAt: new Date().toISOString(),
      };
      const snapshotHash = JSON.stringify(order);
      const exists = orders.some((o) => o.id === payload.id);
      if (showAlerts) setSaveBusy(true);
      isOrderSavingRef.current = true;
      try {
        if (exists) await updateCollectionOrder(payload);
        else await insertCollectionOrder(payload);

        // Guardado obsoleto: otra escritura más nueva ya arrancó.
        if (saveGen !== saveGenerationRef.current) {
          setOrders((prev) => upsertCollectionOrderInList(prev, payload));
          return;
        }

        setOrders((prev) => upsertCollectionOrderInList(prev, payload));
        setEditing((prev) => {
          if (!prev || prev.id !== payload.id) return prev;
          if (JSON.stringify(prev) === snapshotHash) {
            editingRef.current = payload;
            return payload;
          }
          // Conservar ediciones posteriores; integrar filas del payload (p. ej. altas remotas).
          const mergedLines = mergeConcurrentCollectionLines(
            serverBaselineLinesRef.current,
            prev.lines,
            payload.lines,
          );
          const next = {
            ...prev,
            lines: mergedLines,
            ...(!String(prev.numero ?? "").trim() && numero
              ? { numero }
              : {}),
          };
          editingRef.current = next;
          return next;
        });
        serverBaselineLinesRef.current = JSON.parse(
          JSON.stringify(payload.lines),
        ) as CollectionOrderLine[];
        lastSavedOrderHashRef.current = JSON.stringify(payload);
        lastRemoteOrderHashRef.current = JSON.stringify(payload.lines);
        lastLivePublishedHashRef.current = JSON.stringify(payload.lines);
        if (showAlerts) alert(`Orden guardada. Número: ${numero}.`);
      } catch (e) {
        console.error(e);
        if (showAlerts) {
          alert("No se pudo guardar. ¿Aplicaste la migración SQL `collection_orders` en Supabase?");
        }
      } finally {
        if (saveGen === saveGenerationRef.current) {
          isOrderSavingRef.current = false;
          const pending = pendingRemoteOrderRef.current;
          if (pending && editingRef.current) {
            pendingRemoteOrderRef.current = null;
            applyMergedRemote(pending, true);
          }
        }
        if (showAlerts) setSaveBusy(false);
      }
    },
    [orders, applyMergedRemote],
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
        const latest = editingRef.current;
        if (!latest) return;
        // Una sola escritura en vuelo: si hay save activo, reintenta al terminar.
        if (isOrderSavingRef.current) {
          saveGenerationRef.current += 1; // invalida el save viejo al completar
          autoSaveTimerRef.current = setTimeout(() => {
            autoSaveTimerRef.current = null;
            const again = editingRef.current;
            if (again && !isOrderSavingRef.current) {
              void persistOrder({ order: again, showAlerts: false });
            }
          }, 400);
          return;
        }
        void persistOrder({ order: latest, showAlerts: false });
      }, ORDER_AUTOSAVE_MS);
    },
    [persistOrder, userEmail],
  );

  useEffect(() => {
    scheduleAutoSave(editing);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [editing, scheduleAutoSave]);

  const removeOrderFromState = async (o: CollectionOrder) => {
    await deleteCollectionOrderById(o.id);
    await syncCollectionOrderToReceptionQueue({
      ...o,
      receptionStatus: undefined,
    });
    setOrders((prev) => prev.filter((x) => x.id !== o.id));
    if (editing?.id === o.id) setEditing(null);
  };

  const requestDeleteOrder = (o: CollectionOrder) => {
    setDeleteConfirm({ kind: "single", order: o });
  };

  const requestDeleteSelectedOrders = () => {
    const selected = orders.filter((o) => selectedOrderIds[o.id] === true);
    if (selected.length === 0) {
      alert("Seleccioná al menos una orden.");
      return;
    }
    setDeleteConfirm({ kind: "bulk", orders: selected });
  };

  /** Pasa OR de bodega → Sin inventario (marcadas a mano; ya no piden RA). */
  const markOrdersSinInventario = async (targets: CollectionOrder[]) => {
    const eligible = targets.filter(
      (o) =>
        isOrderInWarehouse(o) &&
        !orderHasLinkedRa(o) &&
        !isOrderWithoutInventory(o),
    );
    if (eligible.length === 0) {
      alert(
        "Seleccioná órdenes en bodega (sin RA) que aún no estén en Sin inventario.",
      );
      return;
    }
    const ok = window.confirm(
      eligible.length === 1
        ? `¿Pasar la orden #${eligible[0]!.numero ?? eligible[0]!.id.slice(0, 8)} a Sin inventario?\n\nÚsala cuando ya se procesó fuera del flujo de RA / inventario.`
        : `¿Pasar ${eligible.length} órdenes a Sin inventario?\n\nÚsalo cuando ya se procesaron fuera del flujo de RA / inventario.`,
    );
    if (!ok) return;

    let failed = 0;
    const updatedIds: string[] = [];
    for (const o of eligible) {
      const next: CollectionOrder = {
        ...o,
        sinInventario: true,
        updatedAt: new Date().toISOString(),
      };
      try {
        await updateCollectionOrder(next);
        updatedIds.push(o.id);
        setOrders((prev) => upsertCollectionOrderInList(prev, next));
      } catch (e) {
        console.error(e);
        failed += 1;
      }
    }
    setSelectedOrderIds((prev) => {
      const next = { ...prev };
      for (const id of updatedIds) delete next[id];
      return next;
    });
    if (failed > 0) {
      alert(
        `${failed} orden(es) no se pudieron actualizar. Revisá la conexión y reintentá.`,
      );
      void reloadOrders();
    }
  };

  const moveSelectedToNoInventory = () => {
    const selected = orders.filter((o) => selectedOrderIds[o.id] === true);
    void markOrdersSinInventario(selected);
  };

  const confirmDeleteOrders = async () => {
    if (!deleteConfirm) return;
    setDeleteConfirmBusy(true);
    try {
      if (deleteConfirm.kind === "single") {
        await removeOrderFromState(deleteConfirm.order);
        setDeleteConfirm(null);
        return;
      }

      let failed = 0;
      const deletedIds: string[] = [];
      for (const o of deleteConfirm.orders) {
        try {
          await deleteCollectionOrderById(o.id);
          await syncCollectionOrderToReceptionQueue({
            ...o,
            receptionStatus: undefined,
          });
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
      setDeleteConfirm(null);
      if (failed > 0) {
        alert(`${failed} orden(es) no se pudieron eliminar. Revisá Supabase y reintentá.`);
        void reloadOrders();
      }
    } catch (e) {
      console.error(e);
      alert("No se pudo eliminar en Supabase.");
    } finally {
      setDeleteConfirmBusy(false);
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

  const confirmHtmImport = async (imported: CollectionOrder[]) => {
    const { toCreate, toUpdate, unchangedNumeros } = classifyHtmCollectionOrders(
      imported,
      orders,
    );
    if (toCreate.length === 0 && toUpdate.length === 0) {
      setHtmImportOpen(false);
      setHtmImportResult({
        created: 0,
        updated: 0,
        unchanged: unchangedNumeros.length,
        failed: 0,
        emptyReason:
          unchangedNumeros.length > 0 ? "all-up-to-date" : "nothing-to-import",
      });
      return;
    }
    setHtmImportBusy(true);
    let created = 0;
    let updated = 0;
    let fail = 0;
    try {
      for (const order of toCreate) {
        try {
          await insertCollectionOrder(order);
          created += 1;
        } catch (e) {
          console.error(e);
          fail += 1;
        }
      }
      for (const order of toUpdate) {
        try {
          await updateCollectionOrder(order);
          updated += 1;
        } catch (e) {
          console.error(e);
          fail += 1;
        }
      }
      await reloadOrders();
      setHtmImportOpen(false);
      setHtmImportResult({
        created,
        updated,
        unchanged: unchangedNumeros.length,
        failed: fail,
      });
    } finally {
      setHtmImportBusy(false);
    }
  };

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
              ? {
                  ...prev,
                  lines: withoutBlankCollectionLines([
                    ...prev.lines,
                    ...enriched,
                  ]),
                }
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

  const capturedLineTotals = useMemo(
    () => totalsFromCapturedLines(mergedEditorLinesPreview),
    [mergedEditorLinesPreview],
  );

  const orderReconcile = useMemo(() => {
    if (!editing) return null;
    return reconcileCollectionOrder(editing, capturedLineTotals);
  }, [editing, capturedLineTotals]);

  const bultosReconcile = orderReconcile?.checks.find((c) => c.label === "Bultos");
  const pesoReconcile = orderReconcile?.checks.find((c) => c.label === "Peso (kg)");
  const cbmReconcile = orderReconcile?.checks.find((c) => c.label === "Cubicaje (m³)");

  const transferLinesCount = useMemo(
    () => mergedEditorLinesPreview.filter(lineHasData).length,
    [mergedEditorLinesPreview],
  );

  const tasksEligibleForCollectionTransfer = useMemo(() => {
    if (!editing) return [];
    return tasks.filter((t) => {
      if (t.status === "completed") return false;
      return !taskIsBlockedForCollectionOrder(t, editing.id, orders);
    });
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
    if (task.status === "completed") {
      alert("Este RA ya está completado. Elija otro RA disponible.");
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
        setOrders((prev) => upsertCollectionOrderInList(prev, baseOrder));
      } else {
        await updateCollectionOrder(baseOrder);
        setOrders((prev) => upsertCollectionOrderInList(prev, baseOrder));
      }
      setEditing(baseOrder);

      const targetType = (task.type as string) || "quick";
      const adapted = collectionLinesToRaMeasureData(lines, targetType).map((row) => ({
        ...row,
        id: generateId(),
      }));
      const prevData = (task.measureData || []) as Record<string, unknown>[];
      const nextMeasure: unknown[] =
        merge === "replace" ? adapted : [...prevData, ...adapted];
      const sanitizedMeasure = sanitizeMeasureDataForTarget(
        nextMeasure as Record<string, unknown>[],
        targetType,
      );
      const updatedTask: Task = mergeCollectionOrderIntoTask(
        {
          ...task,
          measureData: sanitizedMeasure,
          linkedCollectionOrderId: baseOrder.id,
        },
        baseOrder,
        lines,
      );
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
      setOrders((prev) => upsertCollectionOrderInList(prev, nextOrder));
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

  const getTerraJob = (oid: string) =>
    terraJobByOrderId[oid] ?? {
      busy: false,
      pendingFileName: null,
      progress: null,
    };

  const patchTerraJob = (
    oid: string,
    patch: Partial<{
      busy: boolean;
      pendingFileName: string | null;
      progress: { current: number; total: number } | null;
    }>,
  ) => {
    setTerraJobByOrderId((prev) => {
      const cur = prev[oid] ?? {
        busy: false,
        pendingFileName: null,
        progress: null,
      };
      return { ...prev, [oid]: { ...cur, ...patch } };
    });
  };

  /**
   * Aplica líneas Terra a una OR concreta (sigue funcionando si saliste a la lista
   * u abriste otra orden, como Alde.IA).
   */
  const applyTerraLinesForOrderId = useCallback(
    (targetOrderId: string, incoming: AldeGptTerraLine[]) => {
      const useful = incoming.filter((row) => {
        const ref = String(row.referencia ?? "").trim();
        const desc = String(row.descripcion ?? "").trim();
        if (ref || desc) return true;
        if (row.reempaque === true) return true;
        const b =
          parseFloat(String(row.bultos ?? "").replace(",", ".")) || 0;
        const und =
          parseFloat(String(row.unidadesPorBulto ?? "").replace(",", ".")) || 0;
        const tot =
          parseFloat(String(row.unidadesTotales ?? "").replace(",", ".")) || 0;
        const pb =
          parseFloat(String(row.pesoPorBulto ?? "").replace(",", ".")) || 0;
        const pt =
          parseFloat(String(row.pesoTotalKg ?? "").replace(",", ".")) || 0;
        return b > 0 || und > 0 || tot > 0 || pb > 0 || pt > 0;
      });
      if (useful.length === 0) return;

      const editingNow = editingRef.current;
      const baseOrder =
        (editingNow && editingNow.id === targetOrderId
          ? editingNow
          : ordersRef.current.find((o) => o.id === targetOrderId)) ?? null;
      if (!baseOrder) return;

      const mergedLines = (baseOrder.lines || []).filter(
        (l) => !isBlankCollectionOrderLine(l),
      );
      const lineIndex = new Map<string, number>();
      mergedLines.forEach((row, i) => {
        const key = collectionLineDedupeKey(row.referencia, row.descripcion);
        if (key) lineIndex.set(key, i);
      });

      const undTotPatch: Record<string, string> = {};
      const pesoTotPatch: Record<string, string> = {};
      let hasTotUnd = false;
      let hasTotPeso = false;

      for (const row of useful) {
        const mapped = aldeGptTerraLineToImportInput(row);
        const bultosNum = Math.max(
          0,
          Math.round(
            parseFloat(String(mapped.bultos ?? "").replace(",", ".")) || 0,
          ),
        );
        const pesoNum = Math.max(
          parseFloat(String(mapped.pesoPorBulto ?? "").replace(",", ".")) || 0,
          parseFloat(String(mapped.pesoTotalKg ?? "").replace(",", ".")) || 0,
        );
        const isReempaque =
          mapped.reempaque === true && bultosNum <= 0 && pesoNum <= 0;

        const imported = normalizeCollectionOrderLineFromImport({
          referencia: mapped.referencia,
          descripcion: mapped.descripcion,
          bultos: isReempaque
            ? "0"
            : mapped.bultos || (bultosNum > 0 ? String(bultosNum) : ""),
          unidadesPorBulto: mapped.unidadesPorBulto,
          unidadesTotales: mapped.unidadesTotales,
          pesoPorBulto: isReempaque ? "" : mapped.pesoPorBulto,
          pesoTotalKg: isReempaque ? "" : mapped.pesoTotalKg,
          modelo: mapped.modelo,
          paisOrigen: mapped.paisOrigen,
          tejido: mapped.tejido,
          talla: mapped.talla,
          genero: mapped.genero,
          composicion: mapped.composicion,
        });

        const undFromTerra = Math.round(
          parseFloat(String(mapped.unidadesPorBulto ?? "").replace(",", ".")) ||
            0,
        );
        const totFromTerra = Math.round(
          parseFloat(String(mapped.unidadesTotales ?? "").replace(",", ".")) ||
            0,
        );
        const pesoTotFromTerra = String(mapped.pesoTotalKg ?? "").trim();

        if (undFromTerra > 0) {
          imported.unidadesPorBulto = String(undFromTerra);
        } else if (totFromTerra > 0 && isReempaque) {
          imported.unidadesPorBulto = String(totFromTerra);
        } else if (
          totFromTerra > 0 &&
          bultosNum > 0 &&
          totFromTerra % bultosNum === 0
        ) {
          imported.unidadesPorBulto = String(totFromTerra / bultosNum);
        } else if (totFromTerra > 0 && bultosNum > 0) {
          // Tot ÷ bultos no entero → und=48 decorativo; tot de factura se guarda.
          imported.unidadesPorBulto = "48";
        }

        if (totFromTerra > 0) {
          imported.unidadesTotales = String(totFromTerra);
        }

        if (!isReempaque && pesoTotFromTerra) {
          const withPeso = applyPesoTotalToLine(
            { id: "", ...imported },
            pesoTotFromTerra,
          );
          imported.pesoPorBulto = withPeso.pesoPorBulto;
          imported.pesoTotalKg = withPeso.pesoTotalKg;
        }

        if (isReempaque) {
          imported.reempaque = true;
          imported.bultos = "0";
          imported.pesoPorBulto = "";
          imported.pesoTotalKg = "";
          imported.pesoPiezaKg = "";
        } else {
          imported.reempaque = false;
          if (bultosNum > 0) imported.bultos = String(bultosNum);
        }

        const normalized: CollectionOrderLine = {
          id: generateId(),
          ...imported,
        };
        const referencia = imported.referencia;
        const key = collectionLineDedupeKey(
          imported.referencia,
          imported.descripcion,
        );
        let targetId = normalized.id;

        if (key && lineIndex.has(key)) {
          const idx = lineIndex.get(key)!;
          const existingId = mergedLines[idx]!.id;
          targetId = existingId;
          mergedLines[idx] = {
            ...mergedLines[idx],
            ...normalized,
            id: existingId,
            reempaque: isReempaque,
            unidadesTotales:
              totFromTerra > 0
                ? String(totFromTerra)
                : mergedLines[idx]!.unidadesTotales,
            pesoTotalKg: !isReempaque && pesoTotFromTerra
              ? String(imported.pesoTotalKg ?? pesoTotFromTerra)
              : mergedLines[idx]!.pesoTotalKg,
          };
          void runCatalogLookup(existingId, referencia);
        } else {
          mergedLines.push(normalized);
          if (key) lineIndex.set(key, mergedLines.length - 1);
          void runCatalogLookup(normalized.id, referencia);
        }

        const totUnd =
          totFromTerra > 0
            ? String(totFromTerra)
            : undFromTerra > 0 && bultosNum > 0
              ? String(undFromTerra * bultosNum)
              : "";
        if (totUnd) {
          undTotPatch[targetId] = totUnd;
          hasTotUnd = true;
        }
        if (pesoTotFromTerra && !isReempaque) {
          pesoTotPatch[targetId] = pesoTotFromTerra;
          hasTotPeso = true;
        }
      }

      const cleanedLines = withoutBlankCollectionLines(mergedLines);
      const nextOrder: CollectionOrder = {
        ...baseOrder,
        lines: cleanedLines.length > 0 ? cleanedLines : [],
      };
      setEditing((prev) =>
        prev && prev.id === targetOrderId ? nextOrder : prev,
      );
      setOrders((prev) => upsertCollectionOrderInList(prev, nextOrder));
      if (editingRef.current?.id === targetOrderId) {
        if (hasTotUnd) {
          setUnitsMode("total");
          setPendingUndTot((prev) => ({ ...prev, ...undTotPatch }));
        }
        if (hasTotPeso) {
          setWeightMode("total");
          setPendingPesoTot((prev) => ({ ...prev, ...pesoTotPatch }));
        }
      }
      void persistOrder({ order: nextOrder, showAlerts: false });
    },
    [persistOrder, runCatalogLookup],
  );

  /** Extracción documental Terra ligada a una OR (sobrevive al salir de la orden). */
  const runTerraDocumentExtract = useCallback(
    async (args: {
      targetOrderId: string;
      text: string;
      files: File[];
      extractMode: "full" | "refsBultosOnly";
    }): Promise<{ reply: string; lines: AldeGptTerraLine[] }> => {
      const { targetOrderId, text, files, extractMode } = args;
      const fileNames = files.map((f) => f.name);
      patchTerraJob(targetOrderId, {
        busy: true,
        pendingFileName: fileNames[0] ?? null,
        progress: { current: 1, total: Math.max(1, files.length) },
      });

      const normalizeUploadFilename = (name: string) => {
        const base = (name || "documento").slice(0, 180);
        const lastDot = base.lastIndexOf(".");
        if (lastDot <= 0 || lastDot === base.length - 1) return base;
        return `${base.slice(0, lastDot)}${base.slice(lastDot).toLowerCase()}`;
      };

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          throw Object.assign(
            new Error("Sesión expirada. Vuelve a iniciar sesión."),
            { code: 401 },
          );
        }

        const requestOne = async (
          message: string,
          file: File | null,
        ): Promise<{ reply: string; lines: AldeGptTerraLine[] }> => {
          let res: Response;
          if (file) {
            const fd = new FormData();
            fd.append("message", message);
            fd.append("history", JSON.stringify([]));
            fd.append("extractMode", extractMode);
            fd.append(
              "file",
              file,
              normalizeUploadFilename(file.name || "documento"),
            );
            res = await fetch("/api/chat", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
              body: fd,
            });
          } else {
            res = await fetch("/api/chat", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                message,
                history: [],
                extractMode,
              }),
            });
          }
          let data: {
            error?: string;
            reply?: string;
            lines?: AldeGptTerraLine[];
          } = {};
          try {
            data = (await res.json()) as typeof data;
          } catch {
            throw Object.assign(
              new Error(
                res.status === 504
                  ? "Se agotó el tiempo de espera. Reintenta en unos segundos."
                  : `Error ${res.status}. Reintenta en unos segundos.`,
              ),
              { code: res.status },
            );
          }
          if (!res.ok) {
            throw Object.assign(new Error(data.error || `Error ${res.status}`), {
              code: res.status,
            });
          }
          return {
            reply: String(data.reply ?? "").trim(),
            lines: Array.isArray(data.lines) ? data.lines : [],
          };
        };

        let extracted: AldeGptTerraLine[] = [];
        const parts: string[] = [];

        if (files.length === 0) {
          const one = await requestOne(text, null);
          extracted = one.lines;
          parts.push(one.reply);
        } else {
          for (let i = 0; i < files.length; i++) {
            const file = files[i]!;
            patchTerraJob(targetOrderId, {
              busy: true,
              pendingFileName: file.name,
              progress: { current: i + 1, total: files.length },
            });
            const basePrompt =
              extractMode === "refsBultosOnly"
                ? ALDEGPT_TERRA_REFS_BULTOS_PROMPT
                : text ||
                  `Extrae las líneas del documento adjunto (${file.name}) según las reglas de recolección.`;
            const orderedPrompt =
              files.length === 1
                ? `${basePrompt}\n\nResponde en JSON.`
                : `${basePrompt}\n\nDocumento ${i + 1} de ${files.length} (respeta este orden). Responde en JSON.`;
            const one = await requestOne(orderedPrompt, file);
            extracted = extracted.concat(one.lines);
            if (one.reply) parts.push(`(${file.name}) ${one.reply}`);
          }
        }

        applyTerraLinesForOrderId(targetOrderId, extracted);
        const reply =
          parts.filter(Boolean).join("\n\n") ||
          (extracted.length > 0
            ? `Se extrajeron ${extracted.length} fila(s) del documento.`
            : "");
        patchTerraJob(targetOrderId, {
          busy: false,
          pendingFileName: null,
          progress: null,
        });
        return { reply, lines: extracted };
      } catch (err) {
        patchTerraJob(targetOrderId, {
          busy: false,
          pendingFileName: null,
          progress: null,
        });
        throw err;
      }
    },
    [applyTerraLinesForOrderId],
  );

  /* ——— Lista ——— */
  if (!editing) {
    const generalCount = countOrdersForCollectionListTab(orders, "general");
    const warehouseCount = countOrdersForCollectionListTab(orders, "warehouse");
    const linkedRaCount = countOrdersForCollectionListTab(orders, "linkedRa");
    const noInventoryCount = countOrdersForCollectionListTab(orders, "noInventory");
    const displayedListOrders = ordersForCollectionListTab(orders, listTab);
    const listSelectedCount = displayedListOrders.filter(
      (o) => selectedOrderIds[o.id] === true,
    ).length;
    const listDominantCliente = (() => {
      const freq = new Map<string, number>();
      for (const o of orders) {
        const c = String(o.cliente ?? "").trim();
        if (c) freq.set(c, (freq.get(c) ?? 0) + 1);
      }
      let best = "";
      let bestN = 0;
      for (const [c, n] of freq) {
        if (n > bestN) {
          best = c;
          bestN = n;
        }
      }
      return best;
    })();
    const toggleListSelectAll = () => {
      if (displayedListOrders.length === 0) return;
      const allVisibleSelected = displayedListOrders.every(
        (o) => selectedOrderIds[o.id] === true,
      );
      if (allVisibleSelected) {
        setSelectedOrderIds((prev) => {
          const next = { ...prev };
          for (const o of displayedListOrders) delete next[o.id];
          return next;
        });
        return;
      }
      setSelectedOrderIds((prev) => {
        const next = { ...prev };
        for (const o of displayedListOrders) next[o.id] = true;
        return next;
      });
    };
    const toggleOrderSelected = (orderId: string) => {
      setSelectedOrderIds((prev) => ({
        ...prev,
        [orderId]: !prev[orderId],
      }));
    };

    const deleteModalSingle =
      deleteConfirm?.kind === "single" ? deleteConfirm.order : null;
    const deleteModalBulk =
      deleteConfirm?.kind === "bulk" ? deleteConfirm.orders : null;
    const bulkLabels = deleteModalBulk?.map(collectionOrderDeleteLabel) ?? [];
    const bulkPreview =
      bulkLabels.length <= 8
        ? bulkLabels.join(", ")
        : `${bulkLabels.slice(0, 8).join(", ")}… (+${bulkLabels.length - 8})`;

    return (
      <>
      <div className="flex h-full min-h-0 w-full max-w-5xl mx-auto flex-1 flex-col bg-gradient-to-b from-indigo-50/40 via-transparent to-transparent px-2 py-3 sm:px-3 md:px-0 md:py-6 dark:from-indigo-950/20">
        <header className="mb-3 shrink-0 rounded-2xl border border-indigo-300/70 bg-gradient-to-r from-[#1e2a5a] via-[#24356d] to-[#1e4f86] p-4 text-white shadow-xl shadow-indigo-500/25 dark:border-indigo-900/40 sm:mb-4 sm:rounded-3xl sm:p-5 md:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-indigo-100">
                <HandHelping className="h-6 w-6 shrink-0 sm:h-8 sm:w-8" />
                <h1 className="text-xl font-black uppercase tracking-tight text-white sm:text-2xl md:text-3xl">
                  Orden de recolección
                </h1>
              </div>
            </div>
            <div className="flex shrink-0 gap-2 max-sm:flex-wrap sm:flex-row">
              <button
                type="button"
                onClick={() => setHtmImportOpen(true)}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-emerald-300/60 bg-emerald-500/20 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-white shadow-lg backdrop-blur-sm transition hover:bg-emerald-500/30 sm:flex-none sm:rounded-2xl sm:px-5 sm:py-3"
              >
                <FileCode className="h-5 w-5 shrink-0" aria-hidden />
                <span className="whitespace-nowrap">Importar HTM</span>
              </button>
              <button
                type="button"
                onClick={openNew}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs font-black uppercase tracking-widest text-[#1b2d58] shadow-xl transition hover:scale-[1.01] hover:bg-indigo-50 sm:flex-none sm:rounded-2xl sm:px-5 sm:py-3"
              >
                <Plus className="h-5 w-5 shrink-0" /> <span className="whitespace-nowrap">Nueva orden</span>
              </button>
            </div>
          </div>
        </header>

        <CollectionOrderListTabs
          active={listTab}
          generalCount={generalCount}
          warehouseCount={warehouseCount}
          linkedRaCount={linkedRaCount}
          noInventoryCount={noInventoryCount}
          onChange={setListTab}
        />

        {ordersLoading ? (
          <p className="text-sm font-bold text-slate-500">Cargando…</p>
        ) : orders.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
            <p className="font-bold text-slate-500 dark:text-slate-400">
              No hay órdenes aún. Creá una para empezar.
            </p>
          </div>
        ) : displayedListOrders.length === 0 ? (
          <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
            <p className="font-bold text-slate-500 dark:text-slate-400">
              {listTab === "general"
                ? "No hay órdenes en recepción."
                : listTab === "warehouse"
                  ? "No hay órdenes en bodega pendientes de RA."
                  : listTab === "linkedRa"
                    ? "No hay órdenes con RA asignado."
                    : "No hay órdenes sin inventario en bodega."}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-600 dark:bg-slate-900">
              {!listSelectMode ? (
                <button
                  type="button"
                  onClick={() => setListSelectMode(true)}
                  className="rounded-xl border-2 border-indigo-300 bg-indigo-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-indigo-900 shadow-sm hover:bg-indigo-100 dark:border-indigo-500/50 dark:bg-indigo-950/40 dark:text-indigo-100 dark:hover:bg-indigo-950/60"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <CheckSquare className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Seleccionar
                  </span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={exitListSelectMode}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Cancelar selección
                  </button>
                  <button
                    type="button"
                    onClick={toggleListSelectAll}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {displayedListOrders.length > 0 &&
                    displayedListOrders.every((o) => selectedOrderIds[o.id] === true)
                      ? "Quitar selección"
                      : "Seleccionar todo"}
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
                  {listTab === "warehouse" ? (
                    <button
                      type="button"
                      disabled={listSelectedCount === 0}
                      onClick={moveSelectedToNoInventory}
                      title="Mueve las OR seleccionadas a la pestaña Sin inventario (ya procesadas fuera del flujo de RA)."
                      className="rounded-xl border-2 border-slate-400/70 bg-slate-100 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-800 shadow-sm hover:bg-slate-200 disabled:opacity-40 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    >
                      Pasar a sin inventario
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={listSelectedCount === 0}
                    onClick={() => requestDeleteSelectedOrders()}
                    className="ml-auto rounded-xl border-2 border-red-200 bg-red-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-red-700 shadow-sm hover:bg-red-100 disabled:opacity-40 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60"
                  >
                    Eliminar seleccionadas
                  </button>
                </>
              )}
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {displayedListOrders.map((o) => {
              const job = geminiJobByOrderId[o.id];
              const terraJob = terraJobByOrderId[o.id];
              const analyzing =
                job?.busy === true || terraJob?.busy === true;
              const analyzingBrand: "gemini" | "terra" =
                terraJob?.busy === true ? "terra" : "gemini";
              const refCount = listReferenciasCount(o.lines);
              const bultosTot = orderDisplayBultos(o);
              const refWord = refCount === 1 ? "referencia" : "referencias";
              const orderLabel = String(o.numero ?? "").trim() || o.id.slice(0, 8);
              const clienteLabel =
                String(o.cliente ?? "").trim() || listDominantCliente;
              const inWarehouse = listTab === "warehouse";
              const inLinkedRa = listTab === "linkedRa";
              const hasRa = orderHasLinkedRa(o);
              const isSelected = selectedOrderIds[o.id] === true;
              return (
                <div
                  key={o.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (listSelectMode) {
                      toggleOrderSelected(o.id);
                      return;
                    }
                    openEdit(o);
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      if (listSelectMode) {
                        toggleOrderSelected(o.id);
                        return;
                      }
                      openEdit(o);
                    }
                  }}
                  aria-label={
                    listSelectMode
                      ? `${isSelected ? "Quitar" : "Seleccionar"} orden #${orderLabel}`
                      : `Abrir orden #${orderLabel}`
                  }
                  className={`group relative flex cursor-pointer flex-col gap-2 overflow-hidden rounded-xl border bg-white p-2.5 pl-3.5 text-left shadow-sm ring-1 transition duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${
                    listSelectMode && isSelected
                      ? "border-indigo-400 ring-indigo-500/20 dark:border-indigo-500/60"
                      : "border-slate-200/90 ring-slate-900/[0.03] hover:border-indigo-200/80 hover:ring-indigo-500/10 dark:border-slate-600/80 dark:ring-white/[0.04] dark:hover:border-indigo-500/40"
                  } dark:bg-slate-900`}
                >
                  <span className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-indigo-500 to-sky-500 opacity-70" />
                  {listSelectMode ? (
                    <label
                      className="relative z-[1] flex shrink-0 cursor-pointer items-center self-start pt-0.5 sm:self-center"
                      onClick={(ev) => ev.stopPropagation()}
                      onKeyDown={(ev) => ev.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOrderSelected(o.id)}
                        onClick={(ev) => ev.stopPropagation()}
                        className="h-4 w-4 rounded border-slate-300 accent-indigo-600 focus:ring-2 focus:ring-indigo-500"
                        aria-label={`Seleccionar orden ${orderLabel}`}
                      />
                    </label>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="truncate text-sm font-black text-[#16263F] dark:text-slate-100">
                        Orden #{String(o.numero ?? "S/N")}
                      </p>
                      {inWarehouse ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                          En bodega
                        </span>
                      ) : null}
                      {analyzing && (
                        <CollectionOrderAiAnalyzingInline brand={analyzingBrand} />
                      )}
                    </div>
                    {o.proveedor?.trim() && (
                      <p className="mt-1 truncate text-xs font-medium text-slate-500 dark:text-slate-400">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          Proveedor{" "}
                        </span>
                        <span className="text-slate-600 dark:text-slate-300">
                          {o.proveedor}
                        </span>
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span
                        className="inline-flex items-baseline gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 shadow-sm dark:border-slate-600 dark:bg-slate-800/90"
                        title="Referencias con número de parte"
                      >
                        <span className="text-sm font-black tabular-nums leading-none text-[#16263F] dark:text-slate-100">
                          {refCount}
                        </span>
                        <span className="text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {refWord}
                        </span>
                      </span>
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 shadow-sm dark:border-violet-500/35 dark:bg-violet-950/45 dark:shadow-violet-950/20"
                        title="Total de bultos en la orden"
                      >
                        <span className="text-[10px] font-black uppercase tracking-wide text-violet-600 dark:text-violet-300">
                          Bultos
                        </span>
                        <span className="text-lg font-black tabular-nums leading-none text-violet-600 dark:text-violet-200">
                          {bultosTot}
                        </span>
                      </span>
                      {inWarehouse ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
                          Pendiente RA
                        </span>
                      ) : null}
                      {inLinkedRa && hasRa ? (
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-300">
                          RA: {o.linkedRaNumbers!.join(", ")}
                        </span>
                      ) : null}
                      {o.status === "sent" && !inLinkedRa && (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-300">
                          Enviada al almacén
                        </span>
                      )}
                      {inLinkedRa && o.linkedRaNumbers && o.linkedRaNumbers.length > 0 ? (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-blue-600 dark:text-blue-300">
                          Vinculada · RA: {o.linkedRaNumbers.join(", ")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-1.5 sm:w-auto">
                    {clienteLabel ? (
                      <span
                        className="max-w-[min(100%,180px)] truncate text-xs font-semibold text-[#16263F] dark:text-slate-100"
                        title={`Cliente: ${clienteLabel}`}
                      >
                        {clienteLabel}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        openEdit(o);
                      }}
                      className={`relative z-[1] inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white shadow-sm transition ${
                        inWarehouse
                          ? "bg-amber-600 hover:bg-amber-700"
                          : "bg-[#16263F] hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-500"
                      }`}
                    >
                      {inWarehouse ? "Asignar RA" : "Abrir"}
                      <ChevronRight className="h-3 w-3 opacity-80" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        requestDeleteOrder(o);
                      }}
                      className="relative z-[1] rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-red-900/50 dark:hover:bg-red-950/30 dark:hover:text-red-400"
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

        <ImportCollectionOrdersHtmModal
          open={htmImportOpen}
          existingOrders={orders}
          busy={htmImportBusy}
          onCancel={() => setHtmImportOpen(false)}
          onConfirm={(imported) => void confirmHtmImport(imported)}
        />

        <HtmImportResultModal
          open={htmImportResult != null}
          summary={htmImportResult}
          onClose={() => setHtmImportResult(null)}
        />
      </div>

      <DeleteRaConfirmModal
        open={deleteConfirm != null}
        headingTitle="Eliminar orden"
        questionPrefix={
          deleteModalSingle
            ? "¿Eliminar la orden de recolección"
            : "¿Eliminar"
        }
        raLabel={
          deleteModalSingle
            ? collectionOrderDeleteLabel(deleteModalSingle)
            : `${deleteModalBulk?.length ?? 0} orden(es) de recolección`
        }
        questionSuffix="?"
        clientHint={
          deleteModalSingle
            ? collectionOrderClientHint(deleteModalSingle)
            : bulkPreview || undefined
        }
        busy={deleteConfirmBusy}
        onCancel={() => {
          if (!deleteConfirmBusy) setDeleteConfirm(null);
        }}
        onConfirm={() => void confirmDeleteOrders()}
      />
      </>
    );
  }

  /* ——— Editor ——— */
  const e = editing;
  const maxExistingNumber = Math.max(0, ...orders.map((o) => parseOrderNumber(o.numero)));
  const suggestedNumber = String(maxExistingNumber + 1);
  const orderId = e.id;
  const geminiJob = getGeminiJob(orderId);
  const terraJob = getTerraJob(orderId);

  const sendToGemini = async (args: {
    text: string;
    file: File | null;
    onlyRefsBultos?: boolean;
  }) => {
    const text = String(args.text ?? "").trim();
    const f = args.file;
    const onlyRefsBultos = args.onlyRefsBultos === true;
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
        const reason = fileOutcome.reason;
        const detail =
          reason instanceof Error && reason.message
            ? reason.message
            : "No se pudo leer o optimizar el archivo adjunto.";
        patchGeminiJob(orderId, {
          errorBanner: { text: detail },
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
        extractMode: onlyRefsBultos ? "refsBultosOnly" : undefined,
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
        processing?: {
          cartonesFooter?: number | null;
          bultosSum?: number;
          extractionIncomplete?: boolean;
          extractionIncompleteReason?: string;
        };
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
      const rawLines = Array.isArray(data.lines) ? data.lines : [];
      const lines = onlyRefsBultos ? toRefsBultosOnlyLines(rawLines) : rawLines;
      const usageSummary = recordGeminiRequestSuccess(data.usage ?? null);

      if (!onlyRefsBultos && data.processing?.extractionIncomplete) {
        const reason = String(data.processing.extractionIncompleteReason ?? "").trim();
        patchGeminiJob(orderId, {
          errorBanner: {
            text: reason
              ? `Extracción incompleta: ${reason}`
              : "Extracción incompleta: revisá bultos, descripción o peso en algunas filas.",
          },
        });
      }

      patchGeminiJob(orderId, {
        lastLines: lines,
        usageSummary,
        history: [...nextHistory, { role: "model", text: reply } as const],
        pendingFileName: null,
        busy: false,
      });
      applyGeminiLinesToOrder(lines, {
        cartonesFooter: onlyRefsBultos ? undefined : data.processing?.cartonesFooter,
      });
    } catch (err) {
      const errText =
        err instanceof DOMException && err.name === "TimeoutError"
          ? err.message
          : err instanceof Error
            ? err.message
            : "Error de red (revisa tu conexión).";
      patchGeminiJob(orderId, {
        errorBanner: { text: errText },
        busy: false,
      });
    }
  };

  const applyGeminiLinesToOrder = (
    incoming?: CollectionGeminiLine[],
    opts?: { cartonesFooter?: number | null },
  ) => {
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

    const baseOrder =
      (editing && editing.id === orderId
        ? editing
        : orders.find((o) => o.id === orderId)) ?? e;

    const mergedLines = [...(baseOrder.lines || [])];
    const lineIndex = new Map<string, number>();
    mergedLines.forEach((row, i) => {
      const key = collectionLineDedupeKey(row.referencia, row.descripcion);
      if (key) lineIndex.set(key, i);
    });

    for (const row of useful) {
      const remapped = remapWeightMisfiledAsWidth(row);
      const imported = normalizeCollectionOrderLineFromImport(remapped);
      const normalized: CollectionOrderLine = {
        id: generateId(),
        ...imported,
      };
      const referencia = imported.referencia;
      const key = collectionLineDedupeKey(
        imported.referencia,
        imported.descripcion,
      );
      if (key && lineIndex.has(key)) {
        const idx = lineIndex.get(key)!;
        const existingId = mergedLines[idx]!.id;
        mergedLines[idx] = { ...mergedLines[idx], ...normalized, id: existingId };
        void runCatalogLookup(existingId, referencia);
      } else {
        mergedLines.push(normalized);
        if (key) lineIndex.set(key, mergedLines.length - 1);
        void runCatalogLookup(normalized.id, referencia);
      }
    }

    const cartones = opts?.cartonesFooter;
    const cleanedLines = withoutBlankCollectionLines(mergedLines);
    const nextOrder: CollectionOrder = {
      ...baseOrder,
      lines: cleanedLines.length > 0 ? cleanedLines : [],
      ...(cartones != null &&
      cartones > 0 &&
      (baseOrder.expectedBultos == null || baseOrder.expectedBultos === 0)
        ? { expectedBultos: Math.round(cartones) }
        : {}),
    };
    patchGeminiJob(orderId, { lastLines: [] });
    setEditing((prev) =>
      prev && prev.id === orderId ? nextOrder : prev,
    );
    void persistOrder({ order: nextOrder, showAlerts: false });
  };

  const applyTerraLinesToOrder = (incoming: AldeGptTerraLine[]) => {
    applyTerraLinesForOrderId(orderId, incoming);
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
              const rows = linesForInventarioExport(
                e.lines,
                unitsMode,
                weightMode,
                pendingUndTot,
                pendingPesoTot,
              );
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
            disabled={saveBusy}
            onClick={() => setChatGptOpen(true)}
            title={`${ALDEGPT_TERRA_DISPLAY_NAME}: chat y extracción (puedes salir de la OR mientras analiza)`}
            className={`flex items-center gap-2 rounded-full border border-slate-200/90 bg-white px-3.5 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-[#1e1f20] dark:text-slate-100 dark:hover:bg-[#282a2c] ${
              terraJob.busy ? "alde-ia-trigger--busy" : ""
            }`}
          >
            {terraJob.busy ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-500" aria-hidden />
            ) : (
              <AldeGptTerraIcon size={18} className="shrink-0" />
            )}
            {ALDEGPT_TERRA_DISPLAY_NAME}
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
              brand="gemini"
              label={
                geminiJob.pendingFileName
                  ? `${AI_ASSISTANT_DISPLAY_NAME} · analizando ${geminiJob.pendingFileName} (puede tardar hasta 5 min en documentos extensos)…`
                  : `${AI_ASSISTANT_DISPLAY_NAME} · analizando documento…`
              }
            />
          </div>
        )}

        {terraJob.busy && (
          <div
            role="status"
            aria-live="polite"
            className="sticky top-0 z-30 mb-2 shrink-0 rounded-xl border border-slate-200 bg-[#e8f0fe]/95 px-2.5 py-1.5 shadow-md dark:border-slate-600 dark:bg-[#131314]/90"
          >
            <CollectionOrderAiAnalyzingStrip
              inlineRow
              brand="terra"
              label={
                terraJob.pendingFileName
                  ? terraJob.progress && terraJob.progress.total > 1
                    ? `${ALDEGPT_TERRA_DISPLAY_NAME} · documento ${terraJob.progress.current}/${terraJob.progress.total}: ${terraJob.pendingFileName}…`
                    : `${ALDEGPT_TERRA_DISPLAY_NAME} · extrayendo ${terraJob.pendingFileName} a la orden…`
                  : `${ALDEGPT_TERRA_DISPLAY_NAME} · extrayendo documento a la orden…`
              }
            />
          </div>
        )}

        <section className="mb-3 overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col lg:flex-row lg:items-stretch">
            {/* Totales documento — horizontal */}
            <div className="flex flex-row border-b border-slate-100 dark:border-slate-800 lg:shrink-0 lg:border-b-0 lg:border-r">
              <div
                className={`flex min-w-[5.5rem] flex-1 flex-col justify-center gap-1 border-r border-slate-100 px-3 py-2.5 last:border-r-0 dark:border-slate-800 lg:flex-none ${
                  bultosReconcile?.ok
                    ? "bg-emerald-50/50 dark:bg-emerald-950/20"
                    : bultosReconcile
                      ? "bg-amber-50/40 dark:bg-amber-950/15"
                      : ""
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Bultos
                  </span>
                  {bultosReconcile ? (
                    bultosReconcile.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />
                    )
                  ) : null}
                </div>
                <div className="flex items-baseline gap-2">
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={e.expectedBultos ?? ""}
                    onChange={(ev) => {
                      const raw = sanitizeIntegerInput(ev.target.value);
                      updateEditing({
                        expectedBultos: raw ? Math.max(0, parseInt(raw, 10)) : undefined,
                      });
                    }}
                    className="no-spinners w-12 bg-transparent text-lg font-black tabular-nums text-[#16263F] outline-none dark:text-slate-100"
                    placeholder="0"
                    aria-label="Bultos documento"
                  />
                  {orderReconcile?.bultosProgress ? (
                    <span className="text-[10px] font-semibold tabular-nums text-slate-500">
                      {orderReconcile.bultosProgress.actual}/
                      {orderReconcile.bultosProgress.expected}
                    </span>
                  ) : null}
                </div>
                {orderReconcile?.bultosProgress ? (
                  <div className="h-0.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700">
                    <div
                      className={`h-full rounded-full transition-all ${
                        bultosReconcile?.ok ? "bg-emerald-500" : "bg-amber-500"
                      }`}
                      style={{ width: `${orderReconcile.bultosProgress.pct}%` }}
                    />
                  </div>
                ) : null}
              </div>

              <div
                className={`flex min-w-[5.5rem] flex-1 flex-col justify-center gap-1 border-r border-slate-100 px-3 py-2.5 dark:border-slate-800 lg:flex-none ${
                  pesoReconcile?.ok
                    ? "bg-emerald-50/50 dark:bg-emerald-950/20"
                    : pesoReconcile
                      ? "bg-amber-50/40 dark:bg-amber-950/15"
                      : ""
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Peso kg
                  </span>
                  {pesoReconcile ? (
                    pesoReconcile.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />
                    )
                  ) : null}
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  value={
                    expectedPesoDraft !== null
                      ? expectedPesoDraft
                      : e.expectedPesoKg != null && e.expectedPesoKg > 0
                        ? String(e.expectedPesoKg)
                        : ""
                  }
                  onChange={(ev) => {
                    const raw = sanitizeDecimalInput(ev.target.value, 2);
                    setExpectedPesoDraft(raw);
                    const n = parseFloat(raw.replace(",", "."));
                    updateEditing({
                      expectedPesoKg:
                        raw && Number.isFinite(n) && n > 0 ? n : undefined,
                    });
                  }}
                  onBlur={() => setExpectedPesoDraft(null)}
                  className="no-spinners w-full bg-transparent text-lg font-black tabular-nums text-[#16263F] outline-none dark:text-slate-100"
                  placeholder="0"
                  aria-label="Peso kg documento"
                />
                <p className="text-[9px] tabular-nums text-slate-400">
                  Tabla:{" "}
                  {capturedLineTotals.pesoKg.toLocaleString("es", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>

              <div
                className={`flex min-w-[5.5rem] flex-1 flex-col justify-center gap-1 px-3 py-2.5 lg:flex-none ${
                  cbmReconcile?.ok
                    ? "bg-emerald-50/50 dark:bg-emerald-950/20"
                    : cbmReconcile
                      ? "bg-amber-50/40 dark:bg-amber-950/15"
                      : ""
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    CBM m³
                  </span>
                  {cbmReconcile ? (
                    cbmReconcile.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden />
                    )
                  ) : null}
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  value={
                    expectedCbmDraft !== null
                      ? expectedCbmDraft
                      : e.expectedCbm != null && e.expectedCbm > 0
                        ? String(e.expectedCbm)
                        : ""
                  }
                  onChange={(ev) => {
                    const raw = sanitizeDecimalInput(ev.target.value, 2);
                    setExpectedCbmDraft(raw);
                    const n = parseFloat(raw.replace(",", "."));
                    updateEditing({
                      expectedCbm: raw && Number.isFinite(n) && n > 0 ? n : undefined,
                    });
                  }}
                  onBlur={() => setExpectedCbmDraft(null)}
                  className="no-spinners w-full bg-transparent text-lg font-black tabular-nums text-[#16263F] outline-none dark:text-slate-100"
                  placeholder="0"
                  aria-label="Cubicaje documento"
                />
                <p className="text-[9px] tabular-nums text-slate-400">
                  Tabla:{" "}
                  {capturedLineTotals.cbm.toLocaleString("es", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </p>
              </div>
            </div>

            {/* Datos de la orden — una fila ancha */}
            <div className="grid min-w-0 flex-1 grid-cols-2 items-end gap-x-4 gap-y-2.5 px-3 py-3 sm:px-4 lg:grid-cols-5">
              <div className="min-w-0">
                <label className="mb-1 block text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  Nº orden
                </label>
                <input
                  value={e.numero ?? ""}
                  onChange={(ev) => updateEditing({ numero: ev.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-1.5 text-sm font-bold text-[#16263F] outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                  placeholder={`Ej. ${suggestedNumber}`}
                />
              </div>
              <div className="min-w-0">
                <label className="mb-1 block text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  Marca
                </label>
                <input
                  value={e.marca ?? ""}
                  onChange={(ev) => updateEditing({ marca: ev.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-1.5 text-sm font-medium text-[#16263F] outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                  placeholder="Nº de seguimiento"
                />
              </div>
              <div className="min-w-0">
                <label className="mb-1 block text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  Consignatario
                </label>
                <input
                  value={e.cliente ?? ""}
                  onChange={(ev) => updateEditing({ cliente: ev.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-1.5 text-sm font-medium text-[#16263F] outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                  placeholder="Cliente"
                />
              </div>
              <div className="min-w-0">
                <label className="mb-1 block text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  Proveedor
                </label>
                <input
                  value={e.proveedor ?? ""}
                  onChange={(ev) => updateEditing({ proveedor: ev.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-1.5 text-sm font-medium text-[#16263F] outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                  placeholder="Proveedor"
                />
              </div>
              <div className="min-w-0">
                <label className="mb-1 block text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  Expedidor
                </label>
                <input
                  value={e.expedidor ?? ""}
                  onChange={(ev) => updateEditing({ expedidor: ev.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-slate-50/50 px-2.5 py-1.5 text-sm font-medium text-[#16263F] outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                  placeholder="Ej. TORII ENTERPRISES CORP."
                />
                {e.fechaEntrega?.trim() ? (
                  <p className="mt-0.5 truncate text-[9px] text-slate-400">
                    Entrega: {e.fechaEntrega}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <div className="mb-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-end">
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

        <div className="table-scroll-hint flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-[0_12px_34px_-20px_rgba(79,70,229,0.45)] dark:border-indigo-900/45 dark:bg-slate-900">
          <div className="table-scroll-host min-h-0 flex-1 overflow-auto">
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
                  const isReempaque = row.reempaque === true;
                  const totUnd = isReempaque
                    ? 0
                    : (() => {
                        const pending = pendingUndTot[row.id];
                        if (pending !== undefined && String(pending).trim() !== "") {
                          const n = Math.round(
                            parseFloat(String(pending).replace(",", ".")) || 0,
                          );
                          if (n > 0) return n;
                        }
                        return unidadesTotalesFromLine(row);
                      })();
                  const pesoTot = isReempaque
                    ? 0
                    : (() => {
                        const pending = pendingPesoTot[row.id];
                        if (pending !== undefined && String(pending).trim() !== "") {
                          const n =
                            parseFloat(String(pending).replace(",", ".")) || 0;
                          if (n > 0) return n;
                        }
                        const stored =
                          parseFloat(
                            String(row.pesoTotalKg ?? "").replace(",", "."),
                          ) || 0;
                        if (stored > 0) return stored;
                        return roundMeasureNearest(pesoTotalFromLine(row));
                      })();
                  const totalUndRounded = Math.round(totUnd);
                  const bultos = isReempaque
                    ? 0
                    : parseFloat(String(row.bultos ?? 0)) || 0;
                  const cubicajeTot = cubicajeM3FromDims(
                    row.l,
                    row.w,
                    row.h,
                    row.bultos,
                    isReempaque,
                  );
                  const cbmBulto =
                    isReempaque
                      ? 0
                      : bultos > 0
                        ? roundMeasureNearest(cubicajeTot / bultos)
                        : cubicajeM3FromDims(row.l, row.w, row.h, 1);
                  const refUnknown =
                    unresolvedRefByRow[row.id] === true &&
                    String(row.referencia ?? "").trim().length > 0;
                  const measureDisabledClass =
                    "border-slate-200 bg-slate-100 text-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-600";
                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors hover:bg-sky-50/70 dark:hover:bg-sky-900/20 ${
                        isReempaque
                          ? "border-l-[3px] border-l-violet-400 bg-violet-50/40 dark:bg-violet-950/20"
                          : "odd:bg-white even:bg-slate-50/60 dark:odd:bg-slate-900 dark:even:bg-slate-800/40"
                      }`}
                    >
                      <td className="px-2 py-1 text-center">
                        <div className="inline-flex items-center justify-center gap-1">
                          <span className="text-slate-400">{idx + 1}</span>
                          {isReempaque ? (
                            <Recycle
                              className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400"
                              aria-label={`Línea ${idx + 1} reempaque`}
                            />
                          ) : null}
                        </div>
                      </td>
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
                            // Catálogo solo al salir del campo (evita parpadeos al tipear).
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
                          disabled={isReempaque}
                          value={isReempaque ? "" : (row.bultos ?? "")}
                          onChange={(ev) =>
                            updateLine(row.id, { bultos: sanitizeIntegerInput(ev.target.value) })
                          }
                          inputMode="numeric"
                          step={1}
                          placeholder={isReempaque ? "—" : undefined}
                          className={`no-spinners w-full rounded-lg border px-1 py-1 text-center text-xs font-black dark:bg-slate-950 ${
                            isReempaque
                              ? measureDisabledClass
                              : "border-slate-200 dark:border-slate-600"
                          }`}
                        />
                      </td>
                      <td className="px-2 py-1 w-20">
                        <input
                          type="text"
                          value={
                            isReempaque
                              ? ""
                              : displayUndBultoValue({
                                  rowId: row.id,
                                  raw: String(row.unidadesPorBulto ?? ""),
                                  focusedUndBultoRowId,
                                  draftByRow: undBultoDraft,
                                })
                          }
                          disabled={isReempaque || unitsMode === "total"}
                          onFocus={() => {
                            if (isReempaque || unitsMode === "total") return;
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
                          placeholder={isReempaque ? "—" : undefined}
                          className={`no-spinners w-full rounded-lg border px-1 py-1 text-center text-xs transition dark:bg-slate-950 ${
                            isReempaque || unitsMode === "total"
                              ? measureDisabledClass
                              : "border-slate-200 dark:border-slate-600"
                          }`}
                        />
                      </td>
                      <td className="bg-slate-50/80 px-2 py-1 text-center text-sm font-black text-[#16263F] dark:bg-slate-800/60 dark:text-slate-100">
                        {isReempaque ? "—" : totalUndRounded}
                      </td>
                      <td className="px-2 py-1 w-24 bg-slate-50/70 dark:bg-slate-800/60">
                        <input
                          type="number"
                          disabled={isReempaque || unitsMode === "per_bundle"}
                          title="Si llenas unidades totales, al salir recalcula und/bulto con los bultos actuales"
                          value={
                            isReempaque
                              ? ""
                              : unitsMode === "total"
                                ? pendingUndTot[row.id] !== undefined
                                  ? pendingUndTot[row.id]!
                                  : totUnd > 0
                                    ? String(Math.round(totUnd))
                                    : ""
                                : ""
                          }
                          onChange={(ev) => {
                            if (isReempaque || unitsMode !== "total") return;
                            setPendingUndTot((p) => ({
                              ...p,
                              [row.id]: sanitizeIntegerInput(ev.target.value),
                            }));
                          }}
                          onBlur={(ev) => {
                            if (isReempaque || unitsMode !== "total") return;
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
                            isReempaque
                              ? measureDisabledClass
                              : unitsMode === "total"
                                ? "border-indigo-200 bg-indigo-50/60 dark:border-indigo-800 dark:bg-indigo-950/25"
                                : "border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-500"
                          }`}
                          placeholder={isReempaque ? "—" : "Tot."}
                          step={1}
                        />
                      </td>
                      <td className="px-2 py-1 w-24">
                        <input
                          type="text"
                          value={isReempaque ? "" : displayMeasureInput(row.pesoPorBulto)}
                          disabled={isReempaque || weightMode === "total"}
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
                          placeholder={isReempaque ? "—" : undefined}
                          className={`no-spinners w-full rounded-lg border px-1 py-1 text-center text-xs transition dark:bg-slate-950 ${
                            isReempaque || weightMode === "total"
                              ? measureDisabledClass
                              : "border-slate-200 dark:border-slate-600"
                          }`}
                        />
                      </td>
                      <td className="px-2 py-1 w-24 bg-slate-50/70 dark:bg-slate-800/60">
                        <input
                          type="text"
                          title="Al salir del campo recalcula peso por bulto con los bultos actuales"
                          disabled={isReempaque || weightMode === "per_bundle"}
                          value={
                            isReempaque
                              ? ""
                              : weightMode === "total"
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
                            if (isReempaque || weightMode !== "total") return;
                            setPendingPesoTot((p) => ({
                              ...p,
                              [row.id]: sanitizeDecimalInput(ev.target.value, 2),
                            }));
                          }}
                          onBlur={(ev) => {
                            if (isReempaque || weightMode !== "total") return;
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
                            isReempaque
                              ? measureDisabledClass
                              : weightMode === "total"
                                ? "border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/30"
                                : "border-slate-200 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-500"
                          }`}
                          placeholder={isReempaque ? "—" : "Tot."}
                          inputMode="decimal"
                        />
                      </td>
                      <td className="px-2 py-1 w-16">
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={isReempaque}
                          value={isReempaque ? "" : (row.l ?? "")}
                          onChange={(ev) =>
                            updateLine(row.id, {
                              l: sanitizeMeasureTyping(ev.target.value),
                            })
                          }
                          onBlur={(ev) =>
                            updateLine(row.id, {
                              l: normalizeMeasureField(ev.target.value),
                            })
                          }
                          placeholder={isReempaque ? "—" : undefined}
                          className={`no-spinners w-full rounded border px-1 py-0.5 text-xs dark:bg-slate-950 ${
                            isReempaque ? measureDisabledClass : ""
                          }`}
                        />
                      </td>
                      <td className="px-2 py-1 w-16">
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={isReempaque}
                          value={isReempaque ? "" : (row.w ?? "")}
                          onChange={(ev) =>
                            updateLine(row.id, {
                              w: sanitizeMeasureTyping(ev.target.value),
                            })
                          }
                          onBlur={(ev) =>
                            updateLine(row.id, {
                              w: normalizeMeasureField(ev.target.value),
                            })
                          }
                          placeholder={isReempaque ? "—" : undefined}
                          className={`no-spinners w-full rounded border px-1 py-0.5 text-xs dark:bg-slate-950 ${
                            isReempaque ? measureDisabledClass : ""
                          }`}
                        />
                      </td>
                      <td className="px-2 py-1 w-16">
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={isReempaque}
                          value={isReempaque ? "" : (row.h ?? "")}
                          onChange={(ev) =>
                            updateLine(row.id, {
                              h: sanitizeMeasureTyping(ev.target.value),
                            })
                          }
                          onBlur={(ev) =>
                            updateLine(row.id, {
                              h: normalizeMeasureField(ev.target.value),
                            })
                          }
                          placeholder={isReempaque ? "—" : undefined}
                          className={`no-spinners w-full rounded border px-1 py-0.5 text-xs dark:bg-slate-950 ${
                            isReempaque ? measureDisabledClass : ""
                          }`}
                        />
                      </td>
                      <td className="bg-slate-50/80 px-2 py-1 text-center text-xs font-black text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                        {isReempaque ? "—" : formatCubicaje2(cbmBulto) || "0.00"}
                      </td>
                      <td className="bg-blue-50/80 px-2 py-1 text-center text-sm font-black text-blue-700 dark:bg-blue-950/45 dark:text-blue-300">
                        {isReempaque ? "—" : formatCubicaje2(cubicajeTot) || "0.00"}
                      </td>
                      <td className="px-1 py-1">
                        <div className="flex items-center justify-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => toggleLineReempaque(row.id)}
                            aria-pressed={isReempaque}
                            title={
                              isReempaque
                                ? "Quitar reempaque"
                                : "Marcar como reempaque (sin bultos, peso ni medidas)"
                            }
                            className={`rounded-lg p-1.5 transition ${
                              isReempaque
                                ? "bg-violet-500 text-white shadow-sm hover:bg-violet-600"
                                : "text-slate-400 hover:bg-violet-50 hover:text-violet-500 dark:hover:bg-violet-950/40"
                            }`}
                          >
                            <Recycle className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteRow(row.id)}
                            className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600"
                            aria-label="Eliminar línea"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
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
          const rows = linesForInventarioExport(
            e.lines,
            unitsMode,
            weightMode,
            pendingUndTot,
            pendingPesoTot,
          );
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

      <GeneralChatGptPanel
        open={chatGptOpen}
        onClose={() => setChatGptOpen(false)}
        extractJobBusy={terraJob.busy}
        onApplyLines={applyTerraLinesToOrder}
        onSendExtract={async ({ text, files, extractMode }) => {
          // Captura el id de ESTA orden: puedes salir a la lista u otra OR.
          return runTerraDocumentExtract({
            targetOrderId: orderId,
            text,
            files,
            extractMode,
          });
        }}
      />
    </>
  );
}
