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
  FileSpreadsheet,
  LayoutGrid,
  Loader2,
  Plane,
  Plus,
  Ruler,
  Smartphone,
  Trash2,
} from "lucide-react";
import { ReekonCaptureView } from "@/components/control-panel/ReekonCaptureView";
import { tableScrollHostClass } from "@/lib/responsiveUi";
import {
  applyConsecutiveReferences,
  buildReferenceSnapshot,
  CAPTURE_LAYOUT_STORAGE_KEY,
  renumberConsecutiveReferences,
  restoreSourceReferences,
  taskHasImportedReferences,
  nextConsecutiveReference,
  type CaptureLayout,
  type ReferenceCaptureMode,
} from "@/lib/quickInventoryTypes";
import type { ControlPanelHome } from "@/components/control-panel/ControlPanelHome";
import { InventoryCsvExportModal } from "@/components/modals/InventoryCsvExportModal";
import {
  countInventarioCsvRows,
  downloadInventarioCsv,
} from "@/lib/exportInventarioCsv";
import { parseReferenciasFromExcel } from "@/lib/importReferenciasExcel";
import {
  getSharedWorkPresenceTabId,
  publishWorkPresence,
  clearWorkPresence,
} from "@/lib/panelPresence";
import { presenceVisibleLabel } from "@/lib/viewerIdentity";
import { InventoryReceptionCompact } from "@/components/control-panel/InventoryReceptionCompact";
import {
  buildMeasurePatchFromCatalog,
  getReferenceCatalogItem,
  mergeCatalogIntoImportedRows,
  normalizePartNumber,
  type InventoryCatalogModule,
} from "@/lib/referenceCatalog";

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
  descripcion?: string;
  bultos?: string | number;
  /** Und/bulto (p. ej. desde orden de recolección → RA rápido) */
  unidadesPorBulto?: string | number;
  /** Peso por bulto en kg si viene de captura detallada */
  pesoPorBulto?: string | number;
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
};

const inventoryDraftKey = (taskId: string, kind: "quick" | "airway") =>
  `${kind}_inventory_draft_v1_${taskId}`;

const generateId = () => Math.random().toString(36).substr(2, 9);
const CATALOG_DEBOUNCE_MS = 500;
const QUICK_AUTOSAVE_MS = 700;
const QUICK_WEIGHT_MODE: WeightMode = "per_bundle";

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
    const descripcion = String(row.descripcion ?? "").trim();
    const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
    const upb = parseFloat(String(row.unidadesPorBulto ?? 0)) || 0;
    const pesoDet = parseFloat(String(row.pesoPorBulto ?? 0)) || 0;
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
      descripcion.length > 0 ||
      bultos > 0 ||
      upb > 0 ||
      pesoDet > 0 ||
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

  useEffect(() => {
    const closeTransfer = () => setTransferOpenId(null);
    if (transferOpenId) {
      document.addEventListener("click", closeTransfer);
      return () => document.removeEventListener("click", closeTransfer);
    }
  }, [transferOpenId]);

  const moduleTasks = tasks.filter((t) => {
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
  const referenciasExcelRef = useRef<HTMLInputElement>(null);
  const [referenciasImportBusy, setReferenciasImportBusy] = useState(false);
  const [csvExportOpen, setCsvExportOpen] = useState(false);
  const [captureLayout, setCaptureLayout] = useState<CaptureLayout>("table");
  const [referenceMode, setReferenceMode] = useState<ReferenceCaptureMode>("with");
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const sourceReferencesRef = useRef<Record<string, string>>({});
  const catalogDebounceRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
  const catalogSeqRef = useRef<Record<string, number>>({});

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

  const groupedTasks = moduleTasks.reduce<Record<string, Task[]>>((groups, task) => {
    const client = task.mainClient || "Sin Cliente";
    if (!groups[client]) groups[client] = [];
    groups[client].push(task);
    return groups;
  }, {});

  const clients = Object.keys(groupedTasks);
  const totalModuleTasks = moduleTasks.length;

  let displayedTasks = moduleTasks;
  if (clientFilter !== "Todos" && clients.includes(clientFilter)) {
    displayedTasks = groupedTasks[clientFilter];
  }

  const calculateTotals = () => {
    if (!selectedTask) return { bultos: 0, cbm: "0.000", weight: 0 };

    const bultos = measureRows.reduce(
      (a, row) => a + (parseFloat(String(row.bultos)) || 0),
      0,
    );
    const cbmNumber = measureRows.reduce((acc, row) => {
      const l = parseFloat(String(row.l)) || 0;
      const w = parseFloat(String(row.w)) || 0;
      const h = parseFloat(String(row.h)) || 0;
      const b = parseFloat(String(row.bultos)) || 0;
      return acc + ((l * w * h) / 1_000_000) * b;
    }, 0);

    let weight = measureRows.reduce((acc, row) => {
      const rowWeight = parseFloat(String(row.weight)) || 0;
      const b = parseFloat(String(row.bultos)) || 0;
      return acc + rowWeight * b;
    }, 0);

    return { bultos, cbm: cbmNumber.toFixed(2), weight };
  };

  const handleSelectTask = (task: Task) => {
    setSelectedTask(task);
    activeTaskIdRef.current = task.id;

    const taskRows =
      task.measureData && task.measureData.length > 0
        ? (JSON.parse(JSON.stringify(task.measureData)) as MeasureRow[])
        : [
            {
              id: generateId(),
              referencia: "",
              descripcion: "",
              bultos: "",
              unidadesPorBulto: "",
              pesoPorBulto: "",
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
      if (savedLayout === "table" || savedLayout === "reekon") {
        layoutToUse = savedLayout;
      }
      if (rawDraft) {
        try {
          const parsed = JSON.parse(rawDraft) as QuickDraft;
          if (Array.isArray(parsed.rows) && parsed.rows.length > 0) {
            const draftHasCapture = quickRowsHaveAnyCapture(parsed.rows);
            if (!serverHasCapture && draftHasCapture) {
              rowsToUse = parsed.rows;
            } else if (serverHasCapture) {
              rowsToUse = taskRows;
            } else {
              rowsToUse = parsed.rows;
            }
          }
          if (parsed.referenceMode === "with" || parsed.referenceMode === "without") {
            refModeToUse = parsed.referenceMode;
          }
          if (parsed.captureLayout === "table" || parsed.captureLayout === "reekon") {
            layoutToUse = parsed.captureLayout;
          }
        } catch {
          // ignore invalid draft
        }
      }
    }

    if (refModeToUse === "without") {
      rowsToUse = applyConsecutiveReferences(rowsToUse);
    }

    if (taskHasImportedReferences(serverRows)) {
      sourceReferencesRef.current = Object.fromEntries(
        rowsToUse.map((row, i) => [
          row.id,
          String(serverRows[i]?.referencia ?? row.referencia ?? ""),
        ]),
      );
    } else {
      sourceReferencesRef.current = buildReferenceSnapshot(rowsToUse);
    }

    const firstPending = rowsToUse.find((r) => !isQuickRowComplete(r));
    setExpandedRowId(firstPending?.id ?? rowsToUse[0]?.id ?? null);
    setReferenceMode(refModeToUse);
    setCaptureLayout(layoutToUse);
    setMeasureRows(rowsToUse);
    latestRowsRef.current = rowsToUse;
    latestTaskRef.current = task;
    lastSavedHashRef.current = JSON.stringify({
      rows: rowsToUse,
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
      setMeasureRows((prev) => {
        sourceReferencesRef.current = buildReferenceSnapshot(prev);
        return applyConsecutiveReferences(prev);
      });
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
          descripcion: "",
          bultos: referenceMode === "without" ? "1" : "",
          unidadesPorBulto: "",
          pesoPorBulto: "",
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

  const onReferenciasExcelSelected: React.ChangeEventHandler<
    HTMLInputElement
  > = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setReferenciasImportBusy(true);
    try {
      const { rows, sourceColumnLabel, error } =
        await parseReferenciasFromExcel(file);
      if (error) {
        // eslint-disable-next-line no-alert
        alert(error);
        return;
      }
      if (rows.length === 0) {
        // eslint-disable-next-line no-alert
        alert("No hay referencias para importar.");
        return;
      }
      const mod: InventoryCatalogModule =
        moduleType === "airway" ? "airway" : "quick";

      setMeasureRows((prev) => {
        const existing = new Set(
          prev
            .map((r) => String(r.referencia ?? "").trim().toUpperCase())
            .filter(Boolean),
        );
        const additions: MeasureRow[] = [];
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
            bultos: r.bultos !== undefined ? String(r.bultos) : "",
            l: "",
            w: "",
            h: "",
            weight: "",
            reempaque: false,
            bultoContenedor: "",
            referenciasContenedor: "",
            reempaqueRefs: [],
            referenciaContenedora: "",
          });
        }
        if (additions.length === 0) {
          // eslint-disable-next-line no-alert
          alert(
            skipped > 0
              ? "Todas las referencias del archivo ya están en la tabla."
              : "No se añadieron filas nuevas.",
          );
          return prev;
        }

        setReferenceMode("with");
        for (const row of additions) {
          sourceReferencesRef.current[row.id] = String(row.referencia ?? "");
        }

        const appendDeduped = (p: MeasureRow[], toAppend: MeasureRow[]) => {
          const ex = new Set(
            p.map((r) => String(r.referencia ?? "").trim().toUpperCase()).filter(Boolean),
          );
          const reallyNew = toAppend.filter((row) => {
            const key = String(row.referencia ?? "").trim().toUpperCase();
            return key && !ex.has(key);
          });
          if (reallyNew.length === 0) return p;
          return [...p, ...reallyNew];
        };

        void mergeCatalogIntoImportedRows(mod, additions)
          .then(({ rows: enriched, catalogMatched }) => {
            setMeasureRows((p) => appendDeduped(p, enriched));
            // eslint-disable-next-line no-alert
            alert(
              `Añadidas ${enriched.length} fila(s). Columna usada: «${sourceColumnLabel}».` +
                (skipped ? ` Omitidas ${skipped} duplicada(s).` : "") +
                (catalogMatched > 0
                  ? ` ${catalogMatched} reconocida(s) en el catálogo (medidas y datos rellenados).`
                  : ""),
            );
          })
          .catch((err) => {
            console.error(err);
            setMeasureRows((p) => appendDeduped(p, additions));
            // eslint-disable-next-line no-alert
            alert(
              `Añadidas ${additions.length} fila(s). No se pudo consultar el catálogo; revisa la conexión.` +
                (skipped ? ` Omitidas ${skipped} duplicada(s).` : ""),
            );
          });

        return prev;
      });
    } catch (err) {
      console.error(err);
      // eslint-disable-next-line no-alert
      alert("No se pudo leer el archivo. Usa formato .xlsx o .xls.");
    } finally {
      setReferenciasImportBusy(false);
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
    field: keyof MeasureRow,
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
        prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
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
      rows: JSON.parse(JSON.stringify(rows)) as MeasureRow[],
      weightMode: QUICK_WEIGHT_MODE,
      referenceMode: refMode,
      captureLayout: layout,
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

    const persistedRows = hasCapture ? rows : [];
    if (!hasCapture && typeof window !== "undefined") {
      window.localStorage.removeItem(inventoryDraftKey(task.id, moduleType));
    }

    const updatedTask: Task = {
      ...task,
      measureData: JSON.parse(JSON.stringify(persistedRows)),
      currentBultos: hasCapture ? totalsBultos : 0,
      weightMode: QUICK_WEIGHT_MODE,
      status: isCompleted ? "completed" : hasCapture ? "in_progress" : "pending",
      originalExpectedBultos: originalExpected,
      manualTotalWeight:
        task.manualTotalWeight !== undefined ? task.manualTotalWeight : 0,
    };

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

    const persistedRows = hasCapture ? measureRows : [];
    if (!hasCapture && typeof window !== "undefined") {
      window.localStorage.removeItem(
        inventoryDraftKey(selectedTask.id, moduleType),
      );
    }

    const updatedTask: Task = {
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
    };

    onUpdateTask(updatedTask);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(
        inventoryDraftKey(selectedTask.id, moduleType),
      );
    }
    setAutosaveState("saved");
    clearTask();
  };

  const showDetailedLineExtras = useMemo(
    () =>
      measureRows.some(
        (row) =>
          String(row.descripcion ?? "").trim() !== "" ||
          String(row.unidadesPorBulto ?? "").trim() !== "" ||
          String(row.pesoPorBulto ?? "").trim() !== "",
      ),
    [measureRows],
  );

  const tableMinWidthClass = showDetailedLineExtras
    ? "min-w-[1420px]"
    : "min-w-[1180px]";

  // Lista de órdenes (sin task seleccionado) — encabezado fijo, solo la lista con barra de desplazamiento
  if (!selectedTask) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
          <div className="shrink-0 space-y-4 md:space-y-6 mb-4 md:mb-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 px-2 md:px-0">
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

            <div className="flex flex-wrap bg-slate-100/80 p-1 rounded-xl w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-800/50 mx-2 md:mx-0">
              <button
                type="button"
                onClick={() => {
                  setViewMode("pending");
                  setClientFilter("Todos");
                }}
                className={`flex-1 min-w-[100px] px-4 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                  viewMode === "pending"
                    ? "bg-white dark:bg-slate-900 shadow-sm text-blue-600 dark:text-blue-400"
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
                className={`flex-1 min-w-[140px] px-4 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                  viewMode === "priority"
                    ? "bg-red-500 shadow-sm text-white"
                    : "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                }`}
              >
                Prioridad contenedor
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode("completed");
                  setClientFilter("Todos");
                }}
                className={`flex-1 min-w-[100px] px-4 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                  viewMode === "completed"
                    ? "bg-white dark:bg-slate-900 shadow-sm text-emerald-600"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                Completados
              </button>
            </div>

            {clients.length > 0 && (
              <div className="flex gap-2 md:gap-3 overflow-x-auto pb-2 px-2 md:px-0 hide-scrollbar">
            <button
              type="button"
              onClick={() => setClientFilter("Todos")}
              className={`shrink-0 px-6 py-2.5 rounded-full text-[10px] md:text-xs font-black uppercase tracking-widest transition-all border ${
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
                className={`shrink-0 px-6 py-2.5 rounded-full text-[10px] md:text-xs font-black uppercase tracking-widest transition-all border ${
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

          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar pr-2 pb-20">
            <div className="grid grid-cols-1 gap-3 md:gap-4 px-2 md:px-0">
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
                displayedTasks.map((t) => (
              <div
                key={t.id}
                className={`p-5 md:p-6 rounded-2xl border shadow-sm hover:shadow-lg hover:border-blue-200 dark:hover:border-blue-800 transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between group relative gap-4 ${
                  viewMode === "priority"
                    ? "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"
                }`}
              >
                <div className="absolute top-4 right-4 z-20 flex gap-2 items-center">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTransferOpenId((prev) => (prev === t.id ? null : t.id));
                      }}
                      className="text-slate-400 dark:text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 p-2 rounded-xl transition-colors"
                      title="Transferir a otro módulo"
                    >
                      <ArrowRightLeft size={16} />
                    </button>
                    {transferOpenId === t.id && (
                      <div className="absolute right-0 top-full mt-1 py-1 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-600 shadow-lg z-30 min-w-[180px]">
                        {moduleType === "quick" ? (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onTransferTask(t, "detailed");
                                setTransferOpenId(null);
                              }}
                              className="w-full px-4 py-2 text-left text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:bg-slate-800/60"
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
                              className="w-full px-4 py-2 text-left text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:bg-slate-800/60"
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
                              className="w-full px-4 py-2 text-left text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:bg-slate-800/60"
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
                              className="w-full px-4 py-2 text-left text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:bg-slate-800/60"
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
                    className="text-slate-400 dark:text-slate-500 hover:text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:bg-blue-950/45 p-2 rounded-xl transition-colors"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteTask(t.id);
                    }}
                    className="text-slate-400 dark:text-slate-500 hover:text-red-500 hover:bg-red-50 p-2 rounded-xl transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div
                  className="flex-1 w-full"
                  onClick={() => handleSelectTask(t)}
                >
                  <div className="flex justify-between items-start mb-3 pr-16 md:pr-20">
                    <div className="flex items-center gap-3">
                      <h3
                        className={`text-2xl md:text-3xl font-bold tracking-tight truncate leading-none ${
                          viewMode === "priority"
                            ? "text-red-700 dark:text-red-300"
                            : "text-[#16263F] dark:text-slate-100"
                        }`}
                      >
                        RA {t.ra}
                      </h3>
                      {t.status === "in_progress" && (
                        <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold dark:bg-amber-950/50 dark:text-amber-200">
                          En curso
                        </span>
                      )}
                    </div>
                    <div
                      className={`px-3 py-1.5 rounded-xl text-center border min-w-[3.5rem] shadow-sm flex flex-col items-center gap-0.5 ${
                        viewMode === "priority"
                          ? "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-800"
                          : "bg-violet-50 text-violet-800 border-violet-200 dark:bg-violet-950/40 dark:text-violet-200 dark:border-violet-800"
                      }`}
                    >
                      <span className="text-[9px] font-semibold leading-none">
                        Bultos
                      </span>
                      <span className="text-xl md:text-2xl font-bold leading-none tabular-nums">
                        {t.expectedBultos}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-700 pt-3">
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 mb-0.5">
                        Proveedor
                      </p>
                      <p className="text-xs md:text-sm font-semibold text-[#16263F] dark:text-slate-100 truncate">
                        {t.provider}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 mb-0.5">
                        Marca / tracking
                      </p>
                      <p className="text-xs md:text-sm font-semibold text-[#16263F] dark:text-slate-100 truncate">
                        {t.brand}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] font-medium text-blue-600 dark:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    Clic para capturar medidas →
                  </p>
                </div>
                <div className="w-full md:w-14 h-12 md:h-14 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700 flex items-center justify-center text-slate-400 dark:text-slate-500 group-hover:bg-slate-100 group-hover:text-[#16263F] dark:text-slate-100 transition-all shrink-0 hidden sm:flex">
                  <ArrowRight className="w-5 h-5" />
                </div>
              </div>
            ))
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Vista de captura de medidas
  const t = selectedTask;
  const totals = calculateTotals();
  const originalExpected =
    t?.originalExpectedBultos !== undefined && t.originalExpectedBultos !== 0
      ? t.originalExpectedBultos
      : t?.expectedBultos || 0;
  const faltantes = originalExpected - totals.bultos;

  const showWeightColumn = true;
  // La referencia debe poder capturarse en ambos modos.
  const showReferenceColumn = true;
  const completedRows = measureRows.filter((row) => isQuickRowComplete(row)).length;

  if (captureLayout === "reekon") {
    return (
      <>
        <ReekonCaptureView
          measureRows={measureRows}
          referenceMode={referenceMode}
          activeRowId={expandedRowId}
          onActiveRowChange={setExpandedRowId}
          onUpdateRow={(id, field, value) => updateRowValue(id, field, value)}
          onReferenceChange={(id, value) => {
            updateRowValue(id, "referencia", value);
            sourceReferencesRef.current[id] = value;
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
      <div className="shrink-0 mb-2 px-2 md:px-0">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={clearTask}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-[#16263F] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
            >
              <ArrowLeft className="h-4 w-4" />
              Volver al listado
            </button>
            <button
              type="button"
              onClick={() => setCsvExportOpen(true)}
              title="Descargar CSV compatible con Excel"
              className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-900 transition hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100 dark:hover:bg-sky-900/50"
            >
              <Download className="h-4 w-4" />
              Exportar CSV
            </button>
          </div>

          {t && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-600 dark:bg-slate-800/50">
                <button
                  type="button"
                  onClick={() => setCaptureLayoutWithPersist("table")}
                  className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-semibold transition sm:px-3 sm:text-xs ${
                    captureLayout === "table"
                      ? "bg-white text-[#16263F] shadow-sm dark:bg-slate-900 dark:text-slate-100"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                  }`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Tabla</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCaptureLayoutWithPersist("reekon")}
                  className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[11px] font-medium text-slate-500 transition hover:text-slate-800 dark:text-slate-400 sm:px-3 sm:text-xs"
                >
                  <Smartphone className="h-3.5 w-3.5" />
                  Reekon
                </button>
              </div>
              <span className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-[#16263F] shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100">
                {moduleType === "airway" ? (
                  <Plane className="h-4 w-4 text-orange-500" />
                ) : (
                  <Box className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                )}
                RA-{t.ra}
              </span>
              <span
                key={autosaveTick}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold ${
                  autosaveState === "saving"
                    ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                    : autosaveState === "saved"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                      : autosaveState === "error"
                        ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
                        : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300"
                }`}
              >
                {autosaveState === "saving" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : autosaveState === "saved" ? (
                  <Cloud className="h-3.5 w-3.5" />
                ) : autosaveState === "error" ? (
                  <CloudOff className="h-3.5 w-3.5" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                {autosaveState === "saving"
                  ? "Guardando…"
                  : autosaveState === "saved"
                    ? "Guardado"
                    : autosaveState === "error"
                      ? "Error al guardar"
                      : "Listo"}
              </span>
            </div>
          )}
        </div>
      </div>

      {t && (
        <div className="flex h-full min-h-0 max-h-full flex-1 flex-col gap-2 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:p-3">
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
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/90 px-3 py-2 dark:border-slate-600 dark:bg-slate-800/50">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Ruler className="h-4 w-4 text-slate-500 dark:text-slate-400" aria-hidden />
                  <div>
                    <p className="text-sm font-bold text-[#16263F] dark:text-slate-100">
                      Captura de medidas
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {referenceMode === "with"
                        ? "Referencias del RA, bultos, peso y dimensiones en cm"
                        : "Numeración consecutiva — solo bultos y dimensiones"}
                    </p>
                  </div>
                </div>
                <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-900">
                  <span className="hidden text-[10px] font-semibold text-slate-500 dark:text-slate-400 sm:inline">
                    Referencias
                  </span>
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-600 dark:bg-slate-800">
                    <button
                      type="button"
                      onClick={() => switchReferenceMode("with")}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition sm:px-3 sm:py-1.5 sm:text-xs ${
                        referenceMode === "with"
                          ? "bg-[#16263F] text-white shadow-sm"
                          : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900"
                      }`}
                    >
                      Con referencias
                    </button>
                    <button
                      type="button"
                      onClick={() => switchReferenceMode("without")}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition sm:px-3 sm:py-1.5 sm:text-xs ${
                        referenceMode === "without"
                          ? "bg-[#16263F] text-white shadow-sm"
                          : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900"
                      }`}
                    >
                      Sin referencias
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  {completedRows} completas
                </span>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span>{measureRows.length} líneas</span>
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
                  {showReferenceColumn && showDetailedLineExtras && (
                    <th className="min-w-[120px] max-w-[200px] px-2 py-2.5 text-left">
                      Descripción
                    </th>
                  )}
                  {showReferenceColumn && showDetailedLineExtras && (
                    <th className="w-24 px-2 py-2.5 text-center">Und/bulto</th>
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
                  const l = parseFloat(String(row.l)) || 0;
                  const w = parseFloat(String(row.w)) || 0;
                  const h = parseFloat(String(row.h)) || 0;
                  const b = parseFloat(String(row.bultos)) || 0;
                  const pesoPorBulto = parseFloat(String(row.weight)) || 0;
                  const rowCbm = ((l * w * h) / 1_000_000) * b;
                  const rowPesoTotal = b * pesoPorBulto;
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
                              sourceReferencesRef.current[row.id] = v;
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

                      {showReferenceColumn && showDetailedLineExtras && (
                        <td className="px-2 py-1 align-top">
                          <input
                            type="text"
                            value={row.descripcion ?? ""}
                            onChange={(e) =>
                              updateRowValue(row.id, "descripcion", e.target.value)
                            }
                            className="w-full min-w-[100px] rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-left text-xs font-semibold text-[#16263F] dark:text-slate-100 outline-none transition-all focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
                            placeholder="Descripción"
                          />
                        </td>
                      )}
                      {showReferenceColumn && showDetailedLineExtras && (
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            value={row.unidadesPorBulto ?? ""}
                            onChange={(e) =>
                              updateRowValue(
                                row.id,
                                "unidadesPorBulto",
                                e.target.value.replace(/\D+/g, ""),
                              )
                            }
                            inputMode="numeric"
                            className="no-spinners w-full rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/25 py-1.5 text-center text-sm font-bold text-[#16263F] dark:text-slate-100 outline-none transition-all focus:border-indigo-500"
                            placeholder="—"
                          />
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
                              updateRowValue(row.id, "weight", e.target.value)
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
                            updateRowValue(row.id, "l", e.target.value)
                          }
                          value={row.l ?? ""}
                          className="no-spinners w-full rounded-lg border border-slate-200 bg-white py-2 text-center text-sm font-semibold tabular-nums text-[#16263F] outline-none transition-all focus:border-[#16263F] focus:ring-2 focus:ring-[#16263F]/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                          placeholder="cm"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          onChange={(e) =>
                            updateRowValue(row.id, "w", e.target.value)
                          }
                          value={row.w ?? ""}
                          className="no-spinners w-full rounded-lg border border-slate-200 bg-white py-2 text-center text-sm font-semibold tabular-nums text-[#16263F] outline-none transition-all focus:border-[#16263F] focus:ring-2 focus:ring-[#16263F]/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                          placeholder="cm"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          onChange={(e) =>
                            updateRowValue(row.id, "h", e.target.value)
                          }
                          value={row.h ?? ""}
                          className="no-spinners w-full rounded-lg border border-slate-200 bg-white py-2 text-center text-sm font-semibold tabular-nums text-[#16263F] outline-none transition-all focus:border-[#16263F] focus:ring-2 focus:ring-[#16263F]/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                          placeholder="cm"
                        />
                      </td>

                      <td className="bg-slate-50 px-2 py-1.5 text-center text-sm font-bold tabular-nums text-[#16263F] dark:bg-slate-800/60 dark:text-slate-100 md:text-base">
                        {rowCbm.toFixed(2)}
                      </td>
                      {showWeightColumn && (
                        <td className="bg-slate-50 px-2 py-1.5 text-center text-sm font-bold tabular-nums text-[#16263F] dark:bg-slate-800/60 dark:text-slate-100 md:text-base">
                          {rowPesoTotal > 0 ? rowPesoTotal.toFixed(1) : "0.0"}
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

          <div className="isolate z-10 shrink-0 space-y-2 border-t border-slate-200 pt-3 dark:border-slate-600">
            <input
              ref={referenciasExcelRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={onReferenciasExcelSelected}
            />
            {captureLayout === "table" && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={addRow}
                className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 py-3 text-xs font-semibold text-slate-600 transition-all hover:border-slate-400 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 md:text-sm"
              >
                <Plus className="h-4 w-4" /> Agregar línea
              </button>
              <button
                type="button"
                disabled={referenciasImportBusy}
                onClick={() => referenciasExcelRef.current?.click()}
                className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/50 py-3 text-xs font-semibold text-emerald-800 transition-all hover:border-emerald-400 hover:bg-emerald-50 disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200 md:text-sm"
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Importar desde Excel
              </button>
            </div>
            )}
            <button
              type="button"
              onClick={saveOrder}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#16263F] py-3.5 text-sm font-bold text-white shadow-lg transition-all hover:bg-[#0f172a] active:scale-[0.99] md:py-4"
            >
              <Check className="h-5 w-5" />
              Guardar orden
            </button>
            <p className="text-center text-[11px] text-slate-400 dark:text-slate-500">
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

