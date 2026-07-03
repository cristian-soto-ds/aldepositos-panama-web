"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Box,
  Check,
  CheckCircle2,
  Circle,
  Cloud,
  CloudOff,
  Edit,
  Download,
  LayoutGrid,
  Loader2,
  Plane,
  Plus,
  Ruler,
  Smartphone,
  Trash2,
} from "lucide-react";
import { ReekonCaptureView } from "@/components/control-panel/ReekonCaptureView";
import { RemoteSyncBanner } from "@/components/control-panel/RemoteSyncBanner";
import { useEditingFocusRef, useInventoryRealtimeSync } from "@/hooks/useInventoryRealtimeSync";
import { tableScrollHostClass } from "@/lib/responsiveUi";
import {
  applyConsecutiveReferences,
  buildReferenceSnapshot,
  buildSourceReferenceSnapshot,
  captureSourceReferencesFromRows,
  CAPTURE_LAYOUT_STORAGE_KEY,
  isAutoConsecutiveBlock,
  isCaptureLayout,
  mergePreservingRealReferences,
  renumberConsecutiveReferences,
  restoreSourceReferences,
  taskHasImportedReferences,
  nextConsecutiveReference,
  stripQuickRowsForPersist,
  type CaptureLayout,
  type QuickMeasureRow,
  type ReferenceCaptureMode,
} from "@/lib/quickInventoryTypes";
import type { ControlPanelHome } from "@/components/control-panel/ControlPanelHome";
import { InventoryCsvExportModal } from "@/components/modals/InventoryCsvExportModal";
import {
  countInventarioCsvRows,
  downloadInventarioCsv,
} from "@/lib/exportInventarioCsv";
import {
  getSharedWorkPresenceTabId,
  publishWorkPresence,
  clearWorkPresence,
} from "@/lib/panelPresence";
import { presenceVisibleLabel } from "@/lib/viewerIdentity";
import { useInventoryPresenceByRa } from "@/hooks/useInventoryPresenceByRa";
import { liveOperatorsForRa } from "@/lib/presenceByRa";
import { InventoryLiveOperators } from "@/components/control-panel/InventoryLiveOperators";
import {
  applyInventoryAttribution,
  inventoryCompletedByLabel,
} from "@/lib/taskContributors";
import {
  cubicajeM3FromDims,
  formatMeasure2,
  normalizeMeasureField,
  roundUpMeasure,
  sanitizeMeasureTyping,
} from "@/lib/measureDecimals";
import { InventoryReceptionCompact } from "@/components/control-panel/InventoryReceptionCompact";
import {
  buildMeasurePatchFromCatalog,
  getReferenceCatalogItem,
  normalizePartNumber,
  type InventoryCatalogModule,
} from "@/lib/referenceCatalog";
import { formatRaFieldLabel, raClientGroupLabel } from "@/lib/collectionOrderToTask";

type Task = Parameters<typeof ControlPanelHome>[0]["tasks"][number];

type QuickInventoryEntryProps = {
  /** "quick" = Ingreso Rápido; "airway" = Guía Aérea (misma captura, otro tipo de RA). */
  moduleType?: "quick" | "airway";
  tasks: Task[];
  onUpdateTask: (task: Task) => void;
  onDeleteTask: (id: string) => void;
  onTransferTask: (task: Task, newType: "quick" | "detailed" | "airway") => void;
  openManualModal: () => void;
  openEditModal: (task: Task) => void;
  /** Si se envía, el panel principal puede mostrar quién tiene un RA abierto (pestañas mismo equipo). */
  presenceUserKey?: string | null;
  presenceUserLabel?: string | null;
  /** URL pública del avatar (visible para otros en presencia). */
  presenceAvatarUrl?: string | null;
};

type MeasureRow = {
  id: string;
  referencia?: string;
  bultos?: string | number;
  l?: string | number;
  w?: string | number;
  h?: string | number;
  weight?: string | number;
  volumenM3?: string | number;
  unidad?: string;
  reempaque?: boolean;
  bultoContenedor?: string;
  referenciasContenedor?: string;
  reempaqueRefs?: string[];
  referenciaContenedora?: string;
};

type WeightMode = "no_weight" | "per_bundle" | "by_reference" | "excel_fixed";
type AutosaveState = "idle" | "saving" | "saved" | "error";

type QuickDraft = {
  updatedAt: number;
  rows: MeasureRow[];
  weightMode?: WeightMode;
  referenceMode?: ReferenceCaptureMode;
  captureLayout?: CaptureLayout;
  sourceReferences?: Record<string, string>;
};

const inventoryDraftKey = (taskId: string, kind: "quick" | "airway") =>
  `${kind}_inventory_draft_v1_${taskId}`;

const generateId = () => Math.random().toString(36).substr(2, 9);

function createEmptyMeasureRow(): MeasureRow {
  return {
    id: generateId(),
    referencia: "",
    bultos: "",
    l: "",
    w: "",
    h: "",
    weight: "",
    reempaque: false,
    bultoContenedor: "",
    referenciasContenedor: "",
    reempaqueRefs: [],
    referenciaContenedora: "",
  };
}
const CATALOG_DEBOUNCE_MS = 500;
const QUICK_AUTOSAVE_MS = 200;
const QUICK_WEIGHT_MODE: WeightMode = "per_bundle";

function CaptureLayoutToggle({
  layout,
  onChange,
}: {
  layout: CaptureLayout;
  onChange: (layout: CaptureLayout) => void;
}) {
  return (
    <div className="inline-flex flex-1 items-center rounded-md border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-600 dark:bg-slate-800/50 sm:flex-none">
      <button
        type="button"
        onClick={() => onChange("table")}
        className={`inline-flex flex-1 touch-target items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px] font-semibold transition sm:flex-none sm:gap-1.5 sm:px-3 sm:text-xs ${
          layout === "table"
            ? "bg-white text-[#16263F] shadow-sm dark:bg-slate-900 dark:text-slate-100"
            : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
        }`}
      >
        <LayoutGrid className="icon-sm" />
        <span className="sm:inline">Tabla</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("reekon")}
        className={`inline-flex flex-1 touch-target items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px] font-semibold transition sm:flex-none sm:gap-1.5 sm:px-3 sm:text-xs ${
          layout === "reekon"
            ? "bg-white text-[#16263F] shadow-sm dark:bg-slate-900 dark:text-slate-100"
            : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
        }`}
      >
        <Smartphone className="icon-sm" />
        Reekon
      </button>
    </div>
  );
}

function hasQuickRequiredData(rows: MeasureRow[]): boolean {
  if (rows.length === 0) return false;
  return rows.every((row) => {
    const referencia = String(row.referencia ?? "").trim();
    const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
    const l = parseFloat(String(row.l ?? 0)) || 0;
    const w = parseFloat(String(row.w ?? 0)) || 0;
    const h = parseFloat(String(row.h ?? 0)) || 0;
    return referencia.length > 0 && bultos > 0 && l > 0 && w > 0 && h > 0;
  });
}

function isQuickRowComplete(row: MeasureRow): boolean {
  const referencia = String(row.referencia ?? "").trim();
  const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
  const l = parseFloat(String(row.l ?? 0)) || 0;
  const w = parseFloat(String(row.w ?? 0)) || 0;
  const h = parseFloat(String(row.h ?? 0)) || 0;
  return referencia.length > 0 && bultos > 0 && l > 0 && w > 0 && h > 0;
}

function quickRowHasPartialData(row: MeasureRow): boolean {
  const referencia = String(row.referencia ?? "").trim();
  const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
  const l = parseFloat(String(row.l ?? 0)) || 0;
  const w = parseFloat(String(row.w ?? 0)) || 0;
  const h = parseFloat(String(row.h ?? 0)) || 0;
  const weight = parseFloat(String(row.weight ?? 0)) || 0;
  return referencia.length > 0 || bultos > 0 || l > 0 || w > 0 || h > 0 || weight > 0;
}

function quickRowsHaveAnyCapture(rows: MeasureRow[]): boolean {
  return rows.some((row) => {
    const referencia = String(row.referencia ?? "").trim();
    const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
    const l = parseFloat(String(row.l ?? 0)) || 0;
    const w = parseFloat(String(row.w ?? 0)) || 0;
    const h = parseFloat(String(row.h ?? 0)) || 0;
    const weight = parseFloat(String(row.weight ?? 0)) || 0;
    const bultoContenedor = String(row.bultoContenedor ?? "").trim();
    const referenciasContenedor = String(row.referenciasContenedor ?? "").trim();
    const reempaqueRefsCount = Array.isArray(row.reempaqueRefs)
      ? row.reempaqueRefs.length
      : 0;
    const referenciaContenedora = String(row.referenciaContenedora ?? "").trim();
    return (
      referencia.length > 0 ||
      bultos > 0 ||
      l > 0 ||
      w > 0 ||
      h > 0 ||
      weight > 0 ||
      row.reempaque === true ||
      bultoContenedor.length > 0 ||
      referenciasContenedor.length > 0 ||
      reempaqueRefsCount > 0 ||
      referenciaContenedora.length > 0
    );
  });
}

export function QuickInventoryEntry({
  moduleType = "quick",
  tasks,
  onUpdateTask,
  onDeleteTask,
  onTransferTask,
  openManualModal,
  openEditModal,
  presenceUserKey = null,
  presenceUserLabel = null,
  presenceAvatarUrl = null,
}: QuickInventoryEntryProps) {
  const [viewMode, setViewMode] = useState<
    "pending" | "completed" | "priority"
  >("pending");
  const [transferOpenId, setTransferOpenId] = useState<string | null>(null);
  const presenceByRa = useInventoryPresenceByRa();

  useEffect(() => {
    const closeTransfer = () => setTransferOpenId(null);
    if (transferOpenId) {
      document.addEventListener("click", closeTransfer);
      return () => document.removeEventListener("click", closeTransfer);
    }
  }, [transferOpenId]);

  const moduleTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (t.type !== moduleType) return false;
      if (viewMode === "completed") {
        return t.status === "completed";
      }
      if (viewMode === "priority") {
        return (
          t.status === "pending" &&
          (t.containerDraft === true || t.dispatched === true)
        );
      }
      return (
        (t.status === "pending" || t.status === "in_progress") &&
        !t.containerDraft &&
        !t.dispatched
      );
    });
  }, [tasks, moduleType, viewMode]);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [clientFilter, setClientFilter] = useState<string>("Todos");
  const [measureRows, setMeasureRows] = useState<MeasureRow[]>([]);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [autosaveTick, setAutosaveTick] = useState(0);

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);
  const queuedRef = useRef(false);
  const queuedHashRef = useRef<string>("");
  const lastSavedHashRef = useRef<string>("");
  const activeTaskIdRef = useRef<string | null>(null);
  const latestRowsRef = useRef<MeasureRow[]>([]);
  const latestTaskRef = useRef<Task | null>(null);
  const [csvExportOpen, setCsvExportOpen] = useState(false);
  const [captureLayout, setCaptureLayout] = useState<CaptureLayout>("table");
  const [referenceMode, setReferenceMode] = useState<ReferenceCaptureMode>("with");
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const sourceReferencesRef = useRef<Record<string, string>>({});
  const catalogDebounceRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
  const catalogSeqRef = useRef<Record<string, number>>({});
  const onLocalSaveCompletedRef = useRef<() => void>(() => {});

  const prepareRowsFromRemote = useCallback(
    (remote: Task): MeasureRow[] => {
      const taskRows =
        remote.measureData && remote.measureData.length > 0
          ? stripQuickRowsForPersist(
              JSON.parse(JSON.stringify(remote.measureData)) as MeasureRow[],
            )
          : [createEmptyMeasureRow()];
      const incomingSnapshot = taskHasImportedReferences(taskRows)
        ? buildSourceReferenceSnapshot(taskRows, taskRows)
        : buildReferenceSnapshot(taskRows);
      if (!isAutoConsecutiveBlock(taskRows)) {
        sourceReferencesRef.current = mergePreservingRealReferences(
          sourceReferencesRef.current,
          incomingSnapshot,
        );
      }
      if (referenceMode === "without") {
        return applyConsecutiveReferences(taskRows);
      }
      return restoreSourceReferences(taskRows, sourceReferencesRef.current);
    },
    [referenceMode],
  );

  useEffect(() => {
    if (!selectedTask) return;
    setMeasureRows((prev) => {
      const next = stripQuickRowsForPersist(prev);
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
  }, [selectedTask?.id]);

  const buildEditorHash = useCallback(
    (rows: MeasureRow[]) =>
      JSON.stringify({ rows, referenceMode, captureLayout }),
    [referenceMode, captureLayout],
  );

  const isEditingRef = useEditingFocusRef();

  const getLiveTaskMeta = useCallback(
    (rows: MeasureRow[]) => {
      const hasCapture = quickRowsHaveAnyCapture(rows);
      const totalsBultos = rows.reduce(
        (a, row) => a + (parseFloat(String(row.bultos)) || 0),
        0,
      );
      const expected = selectedTask?.expectedBultos ?? 0;
      const isCompleted =
        hasCapture &&
        totalsBultos >= expected &&
        hasQuickRequiredData(rows);
      return {
        currentBultos: hasCapture ? totalsBultos : 0,
        status: isCompleted
          ? "completed"
          : hasCapture
            ? "in_progress"
            : "pending",
      };
    },
    [selectedTask?.expectedBultos],
  );

  const {
    remoteUpdatePending,
    applyPendingRemoteUpdate,
    onLocalSaveCompleted,
  } = useInventoryRealtimeSync({
    tasks,
    selectedTask,
    measureRows,
    setSelectedTask,
    setMeasureRows,
    isSavingRef,
    isEditingRef,
    lastSavedHashRef,
    latestRowsRef,
    latestTaskRef,
    buildHash: buildEditorHash,
    prepareRowsFromRemote,
    getLiveTaskMeta,
    userKey: presenceUserKey,
    onTaskRemoved: () => {
      setSelectedTask(null);
      activeTaskIdRef.current = null;
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    },
  });

  onLocalSaveCompletedRef.current = onLocalSaveCompleted;

  useEffect(() => {
    const debRef = catalogDebounceRef;
    return () => {
      Object.values(debRef.current).forEach(clearTimeout);
      debRef.current = {};
    };
  }, []);

  useEffect(() => {
    const key = (presenceUserKey ?? "").trim();
    if (!key) {
      void clearWorkPresence(getSharedWorkPresenceTabId());
      return;
    }
    const label = presenceVisibleLabel(presenceUserLabel, key.includes("@") ? key : null);
    const presenceModule =
      moduleType === "airway" ? ("airway" as const) : ("quick" as const);
    const tabId = getSharedWorkPresenceTabId();
    const send = () => {
      publishWorkPresence({
        tabId,
        userKey: key,
        userLabel: label,
        avatarUrl: presenceAvatarUrl?.trim() || null,
        ra: selectedTask ? String(selectedTask.ra ?? "").trim() : "",
        module: presenceModule,
      });
    };
    send();
    const interval = window.setInterval(send, 12000);
    return () => {
      window.clearInterval(interval);
      void clearWorkPresence(tabId);
    };
  }, [
    selectedTask,
    presenceUserKey,
    presenceUserLabel,
    presenceAvatarUrl,
    moduleType,
  ]);

  const groupedTasks = useMemo(
    () =>
      moduleTasks.reduce<Record<string, Task[]>>((groups, task) => {
        const client = raClientGroupLabel(task.mainClient);
        if (!groups[client]) groups[client] = [];
        groups[client].push(task);
        return groups;
      }, {}),
    [moduleTasks],
  );

  const clients = useMemo(() => Object.keys(groupedTasks), [groupedTasks]);
  const totalModuleTasks = moduleTasks.length;

  const displayedTasks = useMemo(() => {
    if (clientFilter !== "Todos" && clients.includes(clientFilter)) {
      return groupedTasks[clientFilter] ?? moduleTasks;
    }
    return moduleTasks;
  }, [moduleTasks, groupedTasks, clientFilter, clients]);

  const calculateTotals = () => {
    if (!selectedTask) return { bultos: 0, cbm: 0, weight: 0 };

    const bultos = measureRows.reduce(
      (a, row) => a + (parseFloat(String(row.bultos)) || 0),
      0,
    );
    const cbmNumber = measureRows.reduce(
      (acc, row) =>
        acc +
        cubicajeM3FromDims(
          row.l,
          row.w,
          row.h,
          row.bultos,
          row.reempaque === true,
        ),
      0,
    );

    const weight = roundUpMeasure(
      measureRows.reduce((acc, row) => {
        const rowWeight = parseFloat(String(row.weight)) || 0;
        const b = parseFloat(String(row.bultos)) || 0;
        return acc + rowWeight * b;
      }, 0),
    );

    return { bultos, cbm: roundUpMeasure(cbmNumber), weight };
  };

  const commitMeasureField = (
    rowId: string,
    field: "l" | "w" | "h" | "weight",
    raw: string,
  ) => {
    const normalized = normalizeMeasureField(raw);
    updateRowValue(rowId, field, normalized);
  };

  const handleSelectTask = (task: Task) => {
    setSelectedTask(task);
    activeTaskIdRef.current = task.id;

    const taskRows =
      task.measureData && task.measureData.length > 0
        ? stripQuickRowsForPersist(
            JSON.parse(JSON.stringify(task.measureData)) as MeasureRow[],
          )
        : [createEmptyMeasureRow()];
    const serverRows = taskRows;
    const serverHasCapture = quickRowsHaveAnyCapture(taskRows);
    let rowsToUse = taskRows;
    let refModeToUse: ReferenceCaptureMode = taskHasImportedReferences(taskRows)
      ? "with"
      : "without";
    let layoutToUse: CaptureLayout =
      typeof window !== "undefined" && window.innerWidth < 768 ? "reekon" : "table";

    if (typeof window !== "undefined") {
      const rawDraft = window.localStorage.getItem(
        inventoryDraftKey(task.id, moduleType),
      );
      const savedLayout = window.localStorage.getItem(CAPTURE_LAYOUT_STORAGE_KEY);
      if (isCaptureLayout(savedLayout)) {
        layoutToUse = savedLayout;
      }
      if (rawDraft) {
        try {
          const parsed = JSON.parse(rawDraft) as QuickDraft;
          if (Array.isArray(parsed.rows) && parsed.rows.length > 0) {
            const draftHasCapture = quickRowsHaveAnyCapture(parsed.rows);
            if (!serverHasCapture && draftHasCapture) {
              rowsToUse = stripQuickRowsForPersist(parsed.rows);
            } else if (serverHasCapture) {
              rowsToUse = taskRows;
            } else {
              rowsToUse = stripQuickRowsForPersist(parsed.rows);
            }
          }
          if (parsed.referenceMode === "with" || parsed.referenceMode === "without") {
            refModeToUse = parsed.referenceMode;
          }
          if (isCaptureLayout(parsed.captureLayout)) {
            layoutToUse = parsed.captureLayout;
          }
          if (
            parsed.sourceReferences &&
            typeof parsed.sourceReferences === "object"
          ) {
            sourceReferencesRef.current = mergePreservingRealReferences(
              parsed.sourceReferences,
              sourceReferencesRef.current,
            );
          }
        } catch {
          // ignore invalid draft
        }
      }
    }

    const serverSnapshot = taskHasImportedReferences(serverRows)
      ? buildSourceReferenceSnapshot(rowsToUse, serverRows)
      : buildReferenceSnapshot(rowsToUse);
    sourceReferencesRef.current = mergePreservingRealReferences(
      sourceReferencesRef.current,
      serverSnapshot,
    );

    if (refModeToUse === "without") {
      rowsToUse = applyConsecutiveReferences(rowsToUse);
    } else {
      rowsToUse = restoreSourceReferences(rowsToUse, sourceReferencesRef.current);
    }

    rowsToUse = stripQuickRowsForPersist(rowsToUse);

    const firstPending = rowsToUse.find((r) => !isQuickRowComplete(r));
    setExpandedRowId(firstPending?.id ?? rowsToUse[0]?.id ?? null);
    setReferenceMode(refModeToUse);
    setCaptureLayout(layoutToUse);
    setMeasureRows(rowsToUse);
    latestRowsRef.current = rowsToUse;
    latestTaskRef.current = task;
    lastSavedHashRef.current = JSON.stringify({
      rows: rowsToUse,
      referenceMode: refModeToUse,
      captureLayout: layoutToUse,
    });
    setAutosaveState("idle");
  };

  const clearTask = () => {
    setSelectedTask(null);
    activeTaskIdRef.current = null;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  };

  const setCaptureLayoutWithPersist = (layout: CaptureLayout) => {
    setCaptureLayout(layout);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CAPTURE_LAYOUT_STORAGE_KEY, layout);
    }
  };

  const switchReferenceMode = (mode: ReferenceCaptureMode) => {
    if (mode === referenceMode) return;
    if (mode === "with") {
      setMeasureRows((prev) =>
        restoreSourceReferences(prev, sourceReferencesRef.current),
      );
    } else {
      sourceReferencesRef.current = captureSourceReferencesFromRows(
        measureRows,
        sourceReferencesRef.current,
      );
      setMeasureRows((prev) => applyConsecutiveReferences(prev));
    }
    setReferenceMode(mode);
  };

  const addRow = () => {
    const newId = generateId();
    setMeasureRows((prev) => {
      const nextRef =
        referenceMode === "without" ? nextConsecutiveReference(prev) : "";
      return [
        ...prev,
        {
          id: newId,
          referencia: nextRef,
          bultos: referenceMode === "without" ? "1" : "",
          l: "",
          w: "",
          h: "",
          weight: "",
          reempaque: false,
          bultoContenedor: "",
          referenciasContenedor: "",
          reempaqueRefs: [],
          referenciaContenedora: "",
        },
      ];
    });
    if (captureLayout === "reekon") {
      setExpandedRowId(newId);
    }
  };

  const deleteRow = (idToRemove: string) => {
    const t = catalogDebounceRef.current[idToRemove];
    if (t) {
      clearTimeout(t);
      delete catalogDebounceRef.current[idToRemove];
    }
    delete sourceReferencesRef.current[idToRemove];
    setMeasureRows((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((r) => r.id !== idToRemove);
      return referenceMode === "without"
        ? renumberConsecutiveReferences(next)
        : next;
    });
  };

  const updateRowValue = (
    id: string,
    field: keyof MeasureRow | keyof QuickMeasureRow,
    value: string | boolean | string[],
  ) =>
    setMeasureRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );

  const runCatalogLookup = useCallback(
    async (rowId: string, rawReferencia: string) => {
      const key = normalizePartNumber(rawReferencia);
      if (!key) {
        return;
      }
      const seq = (catalogSeqRef.current[rowId] =
        (catalogSeqRef.current[rowId] ?? 0) + 1);
      const item = await getReferenceCatalogItem(key);
      if (catalogSeqRef.current[rowId] !== seq) return;
      if (!item) {
        return;
      }
      const mod: InventoryCatalogModule =
        moduleType === "airway" ? "airway" : "quick";
      const patch = buildMeasurePatchFromCatalog(mod, item);
      setMeasureRows((prev) =>
        stripQuickRowsForPersist(
          prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
        ),
      );
    },
    [moduleType],
  );

  const scheduleCatalogLookup = (rowId: string, raw: string) => {
    const prevT = catalogDebounceRef.current[rowId];
    if (prevT) clearTimeout(prevT);
    catalogDebounceRef.current[rowId] = setTimeout(() => {
      delete catalogDebounceRef.current[rowId];
      void runCatalogLookup(rowId, raw);
    }, CATALOG_DEBOUNCE_MS);
  };

  const persistQuickDraft = (
    taskId: string,
    rows: MeasureRow[],
    refMode: ReferenceCaptureMode,
    layout: CaptureLayout,
  ) => {
    if (typeof window === "undefined") return;
    const draft: QuickDraft = {
      updatedAt: Date.now(),
      rows: JSON.parse(JSON.stringify(stripQuickRowsForPersist(rows))) as MeasureRow[],
      weightMode: QUICK_WEIGHT_MODE,
      referenceMode: refMode,
      captureLayout: layout,
      sourceReferences: { ...sourceReferencesRef.current },
    };
    window.localStorage.setItem(
      inventoryDraftKey(taskId, moduleType),
      JSON.stringify(draft),
    );
  };

  const runAutosave = async (task: Task, rows: MeasureRow[], hash: string) => {
    if (isSavingRef.current) {
      queuedRef.current = true;
      queuedHashRef.current = hash;
      return;
    }
    isSavingRef.current = true;
    setAutosaveState("saving");

    const hasCapture = quickRowsHaveAnyCapture(rows);
    const totalsBultos = rows.reduce(
      (a, row) => a + (parseFloat(String(row.bultos)) || 0),
      0,
    );
    const originalExpected = task.originalExpectedBultos || task.expectedBultos;
    const isCompleted =
      hasCapture &&
      totalsBultos >= task.expectedBultos &&
      hasQuickRequiredData(rows);

    const persistedRows = hasCapture ? stripQuickRowsForPersist(rows) : [];
    if (!hasCapture && typeof window !== "undefined") {
      window.localStorage.removeItem(inventoryDraftKey(task.id, moduleType));
    }

    const updatedTask: Task = applyInventoryAttribution(
      {
        ...task,
        measureData: JSON.parse(JSON.stringify(persistedRows)),
        currentBultos: hasCapture ? totalsBultos : 0,
        weightMode: QUICK_WEIGHT_MODE,
        status: isCompleted ? "completed" : hasCapture ? "in_progress" : "pending",
        originalExpectedBultos: originalExpected,
        manualTotalWeight:
          task.manualTotalWeight !== undefined ? task.manualTotalWeight : 0,
      },
      {
        userKey: presenceUserKey,
        userLabel: presenceUserLabel,
        hasCapture,
        isCompleted,
      },
    );

    try {
      await Promise.resolve((onUpdateTask as (t: Task) => unknown)(updatedTask));
      if (activeTaskIdRef.current === task.id) {
        setSelectedTask(updatedTask);
      }
      lastSavedHashRef.current = hash;
      setAutosaveState("saved");
      setAutosaveTick((v) => v + 1);
    } catch {
      setAutosaveState("error");
    } finally {
      isSavingRef.current = false;
      onLocalSaveCompletedRef.current();
      if (queuedRef.current && queuedHashRef.current !== lastSavedHashRef.current) {
        queuedRef.current = false;
        const latestHash =
          queuedHashRef.current ||
          JSON.stringify({
            rows: latestRowsRef.current,
          });
        queuedHashRef.current = "";
        if (latestTaskRef.current) {
          await runAutosave(
            latestTaskRef.current,
            latestRowsRef.current,
            latestHash,
          );
        }
      }
    }
  };

  useEffect(() => {
    if (!selectedTask) return;
    latestRowsRef.current = measureRows;
    latestTaskRef.current = selectedTask;
    const hash = JSON.stringify({ rows: measureRows, referenceMode, captureLayout });
    persistQuickDraft(selectedTask.id, measureRows, referenceMode, captureLayout);
    if (hash === lastSavedHashRef.current) return;

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(() => {
      void runAutosave(selectedTask, measureRows, hash);
    }, QUICK_AUTOSAVE_MS);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [measureRows, selectedTask, moduleType, referenceMode, captureLayout]);

  const saveOrder = () => {
    if (!selectedTask) return;
    const totals = calculateTotals();
    const hasCapture = quickRowsHaveAnyCapture(measureRows);
    const originalExpected =
      selectedTask.originalExpectedBultos || selectedTask.expectedBultos;
    const isCompleted =
      hasCapture &&
      totals.bultos >= selectedTask.expectedBultos &&
      hasQuickRequiredData(measureRows);

    const persistedRows = hasCapture ? stripQuickRowsForPersist(measureRows) : [];
    if (!hasCapture && typeof window !== "undefined") {
      window.localStorage.removeItem(
        inventoryDraftKey(selectedTask.id, moduleType),
      );
    }

    const updatedTask: Task = applyInventoryAttribution(
      {
        ...selectedTask,
        measureData: JSON.parse(JSON.stringify(persistedRows)),
        currentBultos: hasCapture ? totals.bultos : 0,
        weightMode: QUICK_WEIGHT_MODE,
        status: isCompleted ? "completed" : hasCapture ? "in_progress" : "pending",
        originalExpectedBultos: originalExpected,
        manualTotalWeight:
          selectedTask.manualTotalWeight !== undefined
            ? selectedTask.manualTotalWeight
            : 0,
      },
      {
        userKey: presenceUserKey,
        userLabel: presenceUserLabel,
        hasCapture,
        isCompleted,
      },
    );

    onUpdateTask(updatedTask);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(
        inventoryDraftKey(selectedTask.id, moduleType),
      );
    }
    setAutosaveState("saved");
    clearTask();
  };

  const tableMinWidthClass = "min-w-[1180px]";

  // Lista de órdenes (sin task seleccionado) — encabezado fijo, solo la lista con barra de desplazamiento
  if (!selectedTask) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
          <div className="shrink-0 space-y-2 sm:space-y-4 md:space-y-6 mb-2 sm:mb-4 md:mb-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div>
                <h2 className="text-fluid-title flex items-center gap-2 font-bold text-[#16263F] dark:text-slate-100 md:gap-3">
                  {moduleType === "airway" ? (
                    <>
                      <Plane className="icon-lg text-orange-500" />
                      Guía aérea
                    </>
                  ) : (
                    <>
                      <Box className="icon-lg text-[#16263F] dark:text-slate-100" />
                      Ingreso rápido
                    </>
                  )}
                </h2>
                <p className="text-fluid-subtitle mt-1 text-slate-500 dark:text-slate-400">
                  Selecciona una orden para capturar medidas y bultos
                </p>
              </div>
              <button
                type="button"
                onClick={openManualModal}
                className="bg-[#16263F] hover:bg-[#0f172a] text-white px-4 py-2.5 md:px-5 md:py-3 rounded-xl font-semibold shadow-md transition cursor-pointer flex items-center justify-center gap-2 active:scale-95 text-xs md:text-sm w-full sm:w-auto"
              >
                <Plus size={16} /> Nueva orden manual
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1 dark:border-slate-600 dark:bg-slate-800/50">
              <button
                type="button"
                onClick={() => {
                  setViewMode("pending");
                  setClientFilter("Todos");
                }}
                className={`rounded-lg px-1.5 py-2.5 text-[10px] font-semibold transition-all sm:px-4 sm:text-xs ${
                  viewMode === "pending"
                    ? "bg-white text-blue-600 shadow-sm dark:bg-slate-900 dark:text-blue-400"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                Pendientes
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode("priority");
                  setClientFilter("Todos");
                }}
                className={`rounded-lg px-1.5 py-2.5 text-[10px] font-semibold transition-all sm:px-4 sm:text-xs ${
                  viewMode === "priority"
                    ? "bg-red-500 text-white shadow-sm"
                    : "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                }`}
              >
                <span className="sm:hidden">Prioridad</span>
                <span className="hidden sm:inline">Prioridad contenedor</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode("completed");
                  setClientFilter("Todos");
                }}
                className={`rounded-lg px-1.5 py-2.5 text-[10px] font-semibold transition-all sm:px-4 sm:text-xs ${
                  viewMode === "completed"
                    ? "bg-white text-emerald-600 shadow-sm dark:bg-slate-900"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                Completados
              </button>
            </div>

            {clients.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 hide-scrollbar md:gap-3 md:pb-2">
            <button
              type="button"
              onClick={() => setClientFilter("Todos")}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-[9px] font-black uppercase tracking-wider transition-all sm:px-6 sm:py-2.5 sm:text-xs sm:tracking-widest ${
                clientFilter === "Todos"
                  ? "bg-[#16263F] text-white border-[#16263F] shadow-md"
                  : "bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:bg-slate-800/60"
              }`}
            >
              TODOS ({totalModuleTasks})
            </button>
            {clients.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setClientFilter(c)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-[9px] font-black uppercase tracking-wider transition-all sm:px-6 sm:py-2.5 sm:text-xs sm:tracking-widest ${
                  clientFilter === c
                    ? "bg-[#16263F] text-white border-[#16263F] shadow-md"
                    : "bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:bg-slate-800/60"
                }`}
              >
                {c} ({groupedTasks[c].length})
              </button>
            ))}
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar pb-12 sm:pb-20">
            <div className="grid grid-cols-1 gap-2 sm:gap-3">
              {displayedTasks.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 p-8 md:p-16 rounded-[2rem] border border-slate-200 dark:border-slate-600 text-center font-bold text-slate-400 dark:text-slate-500">
                  No hay órdenes{" "}
                  {viewMode === "completed"
                    ? "completadas"
                    : viewMode === "priority"
                      ? "marcadas como prioridad para contenedor"
                      : "pendientes regulares"}
                  .
                </div>
              ) : (
                displayedTasks.map((t) => {
                  const liveWorkers = liveOperatorsForRa(presenceByRa, t.ra);
                  const completedBy = inventoryCompletedByLabel(t);

                  return (
              <div
                key={t.id}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectTask(t)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelectTask(t);
                  }
                }}
                className={`group flex cursor-pointer flex-col gap-2 rounded-xl border p-3 shadow-sm transition-all hover:border-blue-200 hover:shadow-md dark:hover:border-blue-800 sm:p-4 ${
                  viewMode === "priority"
                    ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20"
                    : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <h3
                      className={`shrink-0 text-lg font-black tabular-nums leading-none sm:text-xl ${
                        viewMode === "priority"
                          ? "text-red-700 dark:text-red-300"
                          : "text-[#16263F] dark:text-slate-100"
                      }`}
                    >
                      RA {t.ra}
                    </h3>
                    {t.status === "in_progress" && liveWorkers.length === 0 ? (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                        En curso
                      </span>
                    ) : null}
                    {viewMode === "completed" && completedBy ? (
                      <span
                        className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200"
                        title="Operador que terminó medidas y peso"
                      >
                        Por {completedBy}
                      </span>
                    ) : null}
                  </div>
                  <div
                    className={`flex shrink-0 flex-col items-center rounded-lg border px-3 py-1 text-center ${
                      viewMode === "priority"
                        ? "border-red-200 bg-red-100 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
                        : "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200"
                    }`}
                  >
                    <span className="text-[9px] font-semibold leading-none">Bultos</span>
                    <span className="text-lg font-bold tabular-nums leading-tight">
                      {t.expectedBultos > 0 ? t.expectedBultos : "—"}
                    </span>
                  </div>
                </div>

                <InventoryLiveOperators operators={liveWorkers} />

                <div
                  className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2 dark:border-slate-700"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <div className="grid min-w-0 flex-1 grid-cols-1 gap-1 sm:grid-cols-2 sm:gap-4">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                        Proveedor
                      </p>
                      <p className="truncate text-xs font-semibold text-[#16263F] dark:text-slate-100 sm:text-sm">
                        {formatRaFieldLabel(t.provider)}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                        Marca
                      </p>
                      <p className="truncate text-xs font-semibold text-[#16263F] dark:text-slate-100 sm:text-sm">
                        {formatRaFieldLabel(t.brand)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTransferOpenId((prev) => (prev === t.id ? null : t.id));
                        }}
                        className="flex items-center justify-center rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/30"
                        title="Transferir a otro módulo"
                      >
                        <ArrowRightLeft className="h-4 w-4" />
                      </button>
                    {transferOpenId === t.id && (
                      <div className="absolute bottom-full right-0 z-30 mb-1 min-w-[180px] rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-900">
                        {moduleType === "quick" ? (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onTransferTask(t, "detailed");
                                setTransferOpenId(null);
                              }}
                              className="w-full px-4 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/60"
                            >
                              → Ingreso Detallado
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onTransferTask(t, "airway");
                                setTransferOpenId(null);
                              }}
                              className="w-full px-4 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/60"
                            >
                              → Guía Aérea
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onTransferTask(t, "quick");
                                setTransferOpenId(null);
                              }}
                              className="w-full px-4 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/60"
                            >
                              → Ingreso Rápido
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onTransferTask(t, "detailed");
                                setTransferOpenId(null);
                              }}
                              className="w-full px-4 py-2.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/60"
                            >
                              → Ingreso Detallado
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(t);
                    }}
                    className="flex items-center justify-center rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950/45"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteTask(t.id);
                    }}
                    className="flex items-center justify-center rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <span className="hidden items-center justify-center rounded-lg bg-slate-50 p-1.5 text-slate-400 group-hover:text-blue-500 sm:flex dark:bg-slate-800/60">
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
                </div>
              </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Vista de captura de medidas.
  // El "declarado" del detalle debe coincidir con el de la tarjeta (expectedBultos,
  // que es el valor editable). Así, si el usuario cambia los bultos del RA, el
  // detalle (DECL / progreso) se actualiza de inmediato.
  const t = selectedTask;
  const totals = calculateTotals();
  const originalExpected =
    t?.expectedBultos && t.expectedBultos > 0
      ? t.expectedBultos
      : t?.originalExpectedBultos || 0;
  const faltantes = originalExpected - totals.bultos;

  const showWeightColumn = true;
  // La referencia debe poder capturarse en ambos modos.
  const showReferenceColumn = true;
  const completedRows = measureRows.filter((row) => isQuickRowComplete(row)).length;

  if (captureLayout === "reekon") {
    return (
      <>
        {remoteUpdatePending ? (
          <div className="fixed inset-x-0 top-0 z-[10001] p-2">
            <RemoteSyncBanner onApply={applyPendingRemoteUpdate} />
          </div>
        ) : null}
        <ReekonCaptureView
          measureRows={measureRows}
          referenceMode={referenceMode}
          activeRowId={expandedRowId}
          onActiveRowChange={setExpandedRowId}
          onUpdateRow={(id, field, value) => updateRowValue(id, field, value)}
          onReferenceChange={(id, value) => {
            updateRowValue(id, "referencia", value);
            const trimmed = String(value ?? "").trim();
            if (trimmed) {
              sourceReferencesRef.current[id] = trimmed;
            } else {
              delete sourceReferencesRef.current[id];
            }
            scheduleCatalogLookup(id, value);
          }}
          onReferenceBlur={(id, value) => {
            const deb = catalogDebounceRef.current[id];
            if (deb) {
              clearTimeout(deb);
              delete catalogDebounceRef.current[id];
            }
            void runCatalogLookup(id, value);
          }}
          onAddRow={addRow}
          onDeleteRow={deleteRow}
          raLabel={String(t.ra ?? "")}
          declaredBultos={originalExpected}
          physicalBultos={totals.bultos}
          faltantes={faltantes}
          totalCbm={totals.cbm}
          totalWeight={totals.weight}
          completedCount={completedRows}
          onBack={clearTask}
          onSwitchToTable={() => setCaptureLayoutWithPersist("table")}
          onSave={saveOrder}
          autosaveState={autosaveState}
          isSaving={autosaveState === "saving"}
        />
        <InventoryCsvExportModal
          open={csvExportOpen}
          raLabel={String(t.ra ?? "")}
          defaultNumero={String(t.ra ?? "").trim()}
          onCancel={() => setCsvExportOpen(false)}
          onConfirm={(numeroDocumento) => {
            const rows = measureRows as unknown as Record<string, unknown>[];
            if (countInventarioCsvRows(rows) === 0) {
              // eslint-disable-next-line no-alert
              alert("No hay líneas con datos para exportar.");
              setCsvExportOpen(false);
              return;
            }
            const variant = moduleType === "airway" ? "airway" : "quick";
            const raSafe = String(t.ra ?? "RA").replace(/[/\\?%*:|"<>]/g, "-");
            downloadInventarioCsv({
              numeroDocumento,
              measureRows: rows,
              variant,
              filenameBase: `inventario-${variant}-${raSafe}`,
            });
            setCsvExportOpen(false);
          }}
        />
      </>
    );
  }

  return (
    <>
    <div className="flex h-full min-h-0 w-full flex-1 flex-col animate-fade">
      <div className="mb-2 shrink-0 space-y-2 px-0.5 md:px-0">
        {remoteUpdatePending ? (
          <RemoteSyncBanner onApply={applyPendingRemoteUpdate} />
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={clearTask}
            className="inline-flex touch-target items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-[#16263F] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-slate-100 sm:gap-2 sm:px-3"
          >
            <ArrowLeft className="icon-sm" />
            <span className="truncate">Volver</span>
          </button>
          <button
            type="button"
            onClick={() => setCsvExportOpen(true)}
            title="Descargar CSV compatible con Excel"
            className="inline-flex touch-target items-center justify-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-2 py-2.5 text-xs font-semibold text-sky-900 transition hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100 dark:hover:bg-sky-900/50 sm:gap-2 sm:px-3"
          >
            <Download className="icon-sm" />
            <span className="truncate">CSV</span>
          </button>
        </div>

          {t && (
            <div className="flex flex-wrap items-center gap-2">
              <CaptureLayoutToggle
                layout={captureLayout}
                onChange={setCaptureLayoutWithPersist}
              />
              <span className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-[#16263F] shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 sm:flex-none sm:text-sm">
                {moduleType === "airway" ? (
                  <Plane className="icon-sm text-orange-500" />
                ) : (
                  <Box className="icon-sm text-blue-600 dark:text-blue-400" />
                )}
                RA-{t.ra}
              </span>
              <span
                key={autosaveTick}
                className={`inline-flex shrink-0 items-center gap-1 rounded-xl border px-2.5 py-2 text-[11px] font-semibold sm:gap-1.5 sm:px-3 sm:text-xs ${
                  autosaveState === "saving"
                    ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                    : autosaveState === "saved"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                      : autosaveState === "error"
                        ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
                        : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
                }`}
                title={
                  autosaveState === "saving"
                    ? "Guardando…"
                    : autosaveState === "saved"
                      ? "Guardado"
                      : autosaveState === "error"
                        ? "Error al guardar"
                        : "Listo"
                }
              >
                {autosaveState === "saving" ? (
                  <Loader2 className="icon-sm animate-spin" />
                ) : autosaveState === "saved" ? (
                  <Cloud className="icon-sm" />
                ) : autosaveState === "error" ? (
                  <CloudOff className="icon-sm" />
                ) : (
                  <CheckCircle2 className="icon-sm" />
                )}
                <span className="hidden sm:inline">
                  {autosaveState === "saving"
                    ? "Guardando…"
                    : autosaveState === "saved"
                      ? "Guardado"
                      : autosaveState === "error"
                        ? "Error"
                        : "Listo"}
                </span>
              </span>
            </div>
          )}

        {t && (
          <button
            type="button"
            onClick={() => setCaptureLayoutWithPersist("reekon")}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/80 px-3 py-2 text-[11px] font-semibold text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-100 sm:hidden"
          >
            <Smartphone className="icon-sm" />
            Usar vista Reekon — mejor para celular
          </button>
        )}
      </div>

      {t && (
        <div className="flex h-full min-h-0 max-h-full flex-1 flex-col gap-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:gap-2 sm:rounded-2xl sm:p-2 md:p-3">
          <InventoryReceptionCompact
            friendly
            leadingIcon={
              moduleType === "airway" ? (
                <Plane className="h-4 w-4" aria-hidden />
              ) : (
                <Box className="h-4 w-4" aria-hidden />
              )
            }
            badge="RA · referencia previa"
            provider={t.provider}
            brand={t.brand}
            expectedCbm={t.expectedCbm}
            expectedWeight={t.expectedWeight}
            subClient={t.subClient}
            notes={t.notes}
            captureEyebrow="Progreso de recepción"
            declared={originalExpected}
            physical={totals.bultos}
            faltantes={faltantes}
            totalCbm={totals.cbm}
            totalWeight={totals.weight}
            totalWeightDecimals={1}
          />

          <div className="flex min-h-0 flex-1 basis-0 flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-600">
            <div className="flex shrink-0 flex-col gap-2 border-b border-slate-200 bg-slate-50/90 px-2 py-2 dark:border-slate-600 dark:bg-slate-800/50 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-3">
              <div className="flex min-w-0 items-center gap-2">
                <Ruler className="icon-sm shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#16263F] dark:text-slate-100">
                    Captura de medidas
                  </p>
                  <p className="hidden text-[11px] text-slate-500 dark:text-slate-400 sm:block">
                    {referenceMode === "with"
                      ? "Referencias del RA, bultos, peso y dimensiones en cm"
                      : "Numeración consecutiva — solo bultos y dimensiones"}
                  </p>
                </div>
              </div>
              <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
                <div className="inline-flex w-full items-center gap-1 rounded-xl border border-slate-200 bg-white px-1.5 py-1 dark:border-slate-600 dark:bg-slate-900 sm:w-auto">
                  <div className="inline-flex w-full rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-600 dark:bg-slate-800 sm:w-auto">
                    <button
                      type="button"
                      onClick={() => switchReferenceMode("with")}
                      className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold transition sm:flex-none sm:px-3 sm:text-xs ${
                        referenceMode === "with"
                          ? "bg-[#16263F] text-white shadow-sm"
                          : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900"
                      }`}
                    >
                      Con refs
                    </button>
                    <button
                      type="button"
                      onClick={() => switchReferenceMode("without")}
                      className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold transition sm:flex-none sm:px-3 sm:text-xs ${
                        referenceMode === "without"
                          ? "bg-[#16263F] text-white shadow-sm"
                          : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900"
                      }`}
                    >
                      Sin refs
                    </button>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-[10px] font-medium text-slate-500 dark:text-slate-400 sm:text-[11px]">
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500 sm:h-3.5 sm:w-3.5" />
                    {completedRows} ok
                  </span>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  <span>{measureRows.length} líneas</span>
                </div>
              </div>
            </div>

            <div className="inventory-table-scroll-host table-scroll-hint flex min-h-0 flex-1 basis-0 flex-col overflow-hidden bg-white dark:bg-slate-900">
            <div className={`${tableScrollHostClass} inventory-measures-scroll`}>
            <table
              className={`w-full border-collapse text-left text-sm md:min-w-full ${tableMinWidthClass}`}
            >
              <thead className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 text-[10px] font-semibold text-slate-600 shadow-sm backdrop-blur-sm dark:border-slate-600 dark:bg-slate-900/95 dark:text-slate-300 md:text-xs supports-[backdrop-filter]:bg-white/90">
                <tr>
                  <th className="w-10 px-2 py-2.5 text-center" title="Número de línea">#</th>
                  {showReferenceColumn && (
                    <th className="min-w-[7rem] px-2 py-2.5 text-left">Referencia</th>
                  )}
                  <th className="w-24 px-2 py-2.5 text-center">Bultos</th>
                  {showWeightColumn && (
                    <th
                      className="w-24 px-2 py-2.5 text-center"
                      title="Peso de un bulto en kilogramos"
                    >
                      Peso/bulto (kg)
                    </th>
                  )}
                  <th className="w-20 px-2 py-2.5 text-center" title="Largo en centímetros">Largo</th>
                  <th className="w-20 px-2 py-2.5 text-center" title="Ancho en centímetros">Ancho</th>
                  <th className="w-20 px-2 py-2.5 text-center" title="Alto en centímetros">Alto</th>
                  <th className="bg-slate-50 px-2 py-2.5 text-center font-bold text-[#16263F] dark:bg-slate-800/60 dark:text-slate-100">
                    Volumen (m³)
                  </th>
                  {showWeightColumn && (
                    <th className="bg-slate-50 px-2 py-2.5 text-center font-bold text-[#16263F] dark:bg-slate-800/60 dark:text-slate-100">
                      Peso total (kg)
                    </th>
                  )}
                  <th className="w-12 px-2 py-2.5 text-center" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {measureRows.map((row, idx) => {
                  const b = parseFloat(String(row.bultos)) || 0;
                  const rowCbm = cubicajeM3FromDims(
                    row.l,
                    row.w,
                    row.h,
                    row.bultos,
                    row.reempaque === true,
                  );
                  const rowPesoTotal = roundUpMeasure(
                    b * (parseFloat(String(row.weight)) || 0),
                  );
                  const rowComplete = isQuickRowComplete(row);
                  const rowPartial = !rowComplete && quickRowHasPartialData(row);

                  return (
                    <tr
                      key={row.id}
                      className={`group transition-colors hover:bg-sky-50/60 dark:hover:bg-sky-950/20 ${
                        rowComplete
                          ? "border-l-[3px] border-l-emerald-400 bg-emerald-50/30 dark:bg-emerald-950/10"
                          : rowPartial
                            ? "border-l-[3px] border-l-amber-400 bg-amber-50/20 dark:bg-amber-950/10"
                            : "border-l-[3px] border-l-transparent odd:bg-white even:bg-slate-50/40 dark:odd:bg-slate-900 dark:even:bg-slate-800/30"
                      }`}
                    >
                      <td className="px-2 py-1.5 text-center">
                        {rowComplete ? (
                          <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-500" aria-label="Línea completa" />
                        ) : rowPartial ? (
                          <Circle className="mx-auto h-4 w-4 text-amber-400 fill-amber-100 dark:fill-amber-950/50" aria-label="Línea incompleta" />
                        ) : (
                          <span className="text-sm font-bold tabular-nums text-slate-300 dark:text-slate-600">
                            {idx + 1}
                          </span>
                        )}
                      </td>

                      {showReferenceColumn && (
                        <td className="px-2 py-1.5 align-top">
                          {referenceMode === "without" ? (
                            <span className="inline-flex w-full items-center justify-center rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-2 text-sm font-bold tabular-nums text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              {idx + 1}
                            </span>
                          ) : (
                          <input
                            type="text"
                            onChange={(e) => {
                              const v = e.target.value;
                              updateRowValue(row.id, "referencia", v);
                              const trimmed = v.trim();
                              if (trimmed) {
                                sourceReferencesRef.current[row.id] = trimmed;
                              } else {
                                delete sourceReferencesRef.current[row.id];
                              }
                              scheduleCatalogLookup(row.id, v);
                            }}
                            onBlur={(e) => {
                              const t = catalogDebounceRef.current[row.id];
                              if (t) {
                                clearTimeout(t);
                                delete catalogDebounceRef.current[row.id];
                              }
                              void runCatalogLookup(row.id, e.target.value);
                            }}
                            value={row.referencia || ""}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left text-sm font-semibold text-[#16263F] outline-none transition-all placeholder:text-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-600"
                            placeholder="Ej. WT-2524"
                          />
                          )}
                        </td>
                      )}

                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          onChange={(e) =>
                            updateRowValue(row.id, "bultos", e.target.value)
                          }
                          value={row.bultos ?? ""}
                          className="no-spinners w-full rounded-lg border border-blue-200 bg-blue-50/50 py-2 text-center text-sm font-bold tabular-nums text-blue-700 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300"
                          placeholder="1"
                        />
                      </td>

                      {showWeightColumn && (
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            onChange={(e) =>
                              updateRowValue(
                                row.id,
                                "weight",
                                sanitizeMeasureTyping(e.target.value),
                              )
                            }
                            onBlur={(e) =>
                              commitMeasureField(row.id, "weight", e.target.value)
                            }
                            value={row.weight ?? ""}
                            className="no-spinners w-full rounded-lg border border-slate-200 bg-white py-2 text-center text-sm font-semibold tabular-nums text-[#16263F] outline-none transition-all focus:border-[#16263F] focus:ring-2 focus:ring-[#16263F]/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                            placeholder="kg"
                            title="Peso por bulto (kg)"
                          />
                        </td>
                      )}

                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          onChange={(e) =>
                            updateRowValue(row.id, "l", sanitizeMeasureTyping(e.target.value))
                          }
                          onBlur={(e) => commitMeasureField(row.id, "l", e.target.value)}
                          value={row.l ?? ""}
                          className="no-spinners w-full rounded-lg border border-slate-200 bg-white py-2 text-center text-sm font-semibold tabular-nums text-[#16263F] outline-none transition-all focus:border-[#16263F] focus:ring-2 focus:ring-[#16263F]/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                          placeholder="cm"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          onChange={(e) =>
                            updateRowValue(row.id, "w", sanitizeMeasureTyping(e.target.value))
                          }
                          onBlur={(e) => commitMeasureField(row.id, "w", e.target.value)}
                          value={row.w ?? ""}
                          className="no-spinners w-full rounded-lg border border-slate-200 bg-white py-2 text-center text-sm font-semibold tabular-nums text-[#16263F] outline-none transition-all focus:border-[#16263F] focus:ring-2 focus:ring-[#16263F]/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                          placeholder="cm"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          onChange={(e) =>
                            updateRowValue(row.id, "h", sanitizeMeasureTyping(e.target.value))
                          }
                          onBlur={(e) => commitMeasureField(row.id, "h", e.target.value)}
                          value={row.h ?? ""}
                          className="no-spinners w-full rounded-lg border border-slate-200 bg-white py-2 text-center text-sm font-semibold tabular-nums text-[#16263F] outline-none transition-all focus:border-[#16263F] focus:ring-2 focus:ring-[#16263F]/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                          placeholder="cm"
                        />
                      </td>

                      <td className="bg-slate-50 px-2 py-1.5 text-center text-sm font-bold tabular-nums text-[#16263F] dark:bg-slate-800/60 dark:text-slate-100 md:text-base">
                        {formatMeasure2(rowCbm) || "0.00"}
                      </td>
                      {showWeightColumn && (
                        <td className="bg-slate-50 px-2 py-1.5 text-center text-sm font-bold tabular-nums text-[#16263F] dark:bg-slate-800/60 dark:text-slate-100 md:text-base">
                          {formatMeasure2(rowPesoTotal) || "0.00"}
                        </td>
                      )}
                      <td className="px-2 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => deleteRow(row.id)}
                          title="Eliminar línea"
                          className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-all hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
            </div>
          </div>

          <div className="isolate z-10 shrink-0 space-y-1.5 border-t border-slate-200 pt-2 dark:border-slate-600 sm:space-y-2 sm:pt-3">
            <button
              type="button"
              onClick={addRow}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 py-2 text-[11px] font-semibold text-slate-600 transition-all hover:border-slate-400 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:rounded-xl sm:py-3 sm:text-xs md:text-sm"
            >
              <Plus className="icon-sm" /> Agregar
            </button>
            <button
              type="button"
              onClick={saveOrder}
              className="flex w-full touch-target items-center justify-center gap-2 rounded-xl bg-[#16263F] py-2.5 text-sm font-bold text-white shadow-lg transition-all hover:bg-[#0f172a] active:scale-[0.99] sm:py-3 md:py-4"
            >
              <Check className="icon-md" />
              Guardar orden
            </button>
            <p className="hidden text-center text-[11px] text-slate-400 dark:text-slate-500 sm:block">
              Los cambios se guardan automáticamente mientras capturas
            </p>
          </div>
        </div>
      )}
    </div>
    <InventoryCsvExportModal
      open={csvExportOpen}
      raLabel={String(t.ra ?? "")}
      defaultNumero={String(t.ra ?? "").trim()}
      onCancel={() => setCsvExportOpen(false)}
      onConfirm={(numeroDocumento) => {
        const rows = measureRows as unknown as Record<string, unknown>[];
        if (countInventarioCsvRows(rows) === 0) {
          // eslint-disable-next-line no-alert
          alert("No hay líneas con datos para exportar.");
          setCsvExportOpen(false);
          return;
        }
        const variant = moduleType === "airway" ? "airway" : "quick";
        const raSafe = String(t.ra ?? "RA").replace(/[/\\?%*:|"<>]/g, "-");
        downloadInventarioCsv({
          numeroDocumento,
          measureRows: rows,
          variant,
          filenameBase: `inventario-${variant}-${raSafe}`,
        });
        setCsvExportOpen(false);
      }}
    />
    </>
  );
}

