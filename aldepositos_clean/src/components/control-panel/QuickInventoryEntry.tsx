"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Box,
  Check,
  Edit,
  Download,
  FileSpreadsheet,
  Plane,
  Plus,
  Trash2,
} from "lucide-react";
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
  weightMode: WeightMode;
  quickMode?: "normal" | "reempaque";
};

const generateId = () => Math.random().toString(36).substr(2, 9);
const CATALOG_DEBOUNCE_MS = 500;
const QUICK_AUTOSAVE_MS = 700;
const inventoryDraftKey = (taskId: string, kind: "quick" | "airway") =>
  `${kind}_inventory_draft_v1_${taskId}`;

function hasQuickRequiredData(
  rows: MeasureRow[],
  quickMode: "normal" | "reempaque",
): boolean {
  if (rows.length === 0) return false;
  return rows.every((row) => {
    const referencia = String(row.referencia ?? "").trim();
    const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
    const esReempaque = quickMode === "reempaque" && row.reempaque === true;
    const referenciaContenedora = String(row.referenciaContenedora ?? "").trim();
    const l = parseFloat(String(row.l ?? 0)) || 0;
    const w = parseFloat(String(row.w ?? 0)) || 0;
    const h = parseFloat(String(row.h ?? 0)) || 0;
    if (esReempaque) {
      return referencia.length > 0 && referenciaContenedora.length > 0;
    }
    return referencia.length > 0 && bultos > 0 && l > 0 && w > 0 && h > 0;
  });
}

/** True si hay al menos un dato capturado (si está todo vacío => estado “sin registrar”). */
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
  const [weightMode, setWeightMode] = useState<WeightMode>("by_reference");
  const [quickMode, setQuickMode] = useState<"normal" | "reempaque">("normal");
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
  const latestModeRef = useRef<WeightMode>("by_reference");
  const latestQuickModeRef = useRef<"normal" | "reempaque">("normal");
  const latestTaskRef = useRef<Task | null>(null);
  const referenciasExcelRef = useRef<HTMLInputElement>(null);
  const [referenciasImportBusy, setReferenciasImportBusy] = useState(false);
  const [csvExportOpen, setCsvExportOpen] = useState(false);
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

    const bultos = measureRows.reduce((a, row) => {
      const isReempaque = quickMode === "reempaque" && row.reempaque === true;
      return a + (isReempaque ? 0 : parseFloat(String(row.bultos)) || 0);
    }, 0);
    const cbmNumber = measureRows.reduce((acc, row) => {
      const l = parseFloat(String(row.l)) || 0;
      const w = parseFloat(String(row.w)) || 0;
      const h = parseFloat(String(row.h)) || 0;
      const b = parseFloat(String(row.bultos)) || 0;
      const isReempaque = quickMode === "reempaque" && row.reempaque === true;
      return acc + (isReempaque ? 0 : ((l * w * h) / 1_000_000) * b);
    }, 0);

    let weight = 0;
    if (weightMode === "by_reference" || weightMode === "excel_fixed") {
      // Peso fijo a nivel de RA (desde Excel)
      weight = selectedTask.expectedWeight || 0;
    } else if (weightMode === "per_bundle") {
      weight = measureRows.reduce((acc, row) => {
        const rowWeight = parseFloat(String(row.weight)) || 0;
        const b = parseFloat(String(row.bultos)) || 0;
        return acc + rowWeight * b;
      }, 0);
    }

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
    const taskWeightMode = ((task.weightMode as WeightMode) || "by_reference") as WeightMode;

    const serverHasCapture = quickRowsHaveAnyCapture(taskRows);
    let rowsToUse = taskRows;
    let modeToUse = taskWeightMode;
    let quickModeToUse: "normal" | "reempaque" = "normal";
    if (typeof window !== "undefined") {
      const rawDraft = window.localStorage.getItem(
        inventoryDraftKey(task.id, moduleType),
      );
      if (rawDraft) {
        try {
          const parsed = JSON.parse(rawDraft) as QuickDraft;
          if (Array.isArray(parsed.rows) && parsed.rows.length > 0) {
            const draftHasCapture = quickRowsHaveAnyCapture(parsed.rows);
            if (!serverHasCapture && draftHasCapture) {
              rowsToUse = parsed.rows;
              modeToUse = parsed.weightMode || taskWeightMode;
              if (parsed.quickMode === "reempaque" || parsed.quickMode === "normal") {
                quickModeToUse = parsed.quickMode;
              }
            }
          }
        } catch {
          // ignore invalid draft
        }
      }
    }
    if (
      quickModeToUse === "normal" &&
      rowsToUse.some((r) => r.reempaque === true)
    ) {
      quickModeToUse = "reempaque";
    }

    setMeasureRows(rowsToUse);
    setWeightMode(modeToUse);
    setQuickMode(quickModeToUse);
    latestRowsRef.current = rowsToUse;
    latestModeRef.current = modeToUse;
    latestTaskRef.current = task;
    lastSavedHashRef.current = JSON.stringify({
      rows: rowsToUse,
      weightMode: modeToUse,
      quickMode: quickModeToUse,
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

  const addRow = () =>
    setMeasureRows((prev) => [
      ...prev,
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
    ]);

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
    setMeasureRows((prev) =>
      prev.length > 1 ? prev.filter((r) => r.id !== idToRemove) : prev,
    );
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

  const toggleReempaque = (rowId: string, enabled: boolean) => {
    setMeasureRows((prev) =>
      prev.map((row) =>
        row.id !== rowId
          ? row
          : {
              ...row,
              reempaque: enabled,
              l: enabled ? "" : row.l,
              w: enabled ? "" : row.w,
              h: enabled ? "" : row.h,
              bultos: enabled ? "0" : row.bultos,
              bultoContenedor: enabled ? row.bultoContenedor ?? "" : "",
              referenciasContenedor: enabled ? row.referenciasContenedor ?? "" : "",
              reempaqueRefs: enabled ? row.reempaqueRefs ?? [] : [],
              referenciaContenedora: enabled ? row.referenciaContenedora ?? "" : "",
            },
      ),
    );
  };

  const updateWeightMode = (mode: WeightMode) => {
    setWeightMode(mode);
  };

  const persistQuickDraft = (
    taskId: string,
    rows: MeasureRow[],
    mode: WeightMode,
    qMode: "normal" | "reempaque",
  ) => {
    if (typeof window === "undefined") return;
    const draft: QuickDraft = {
      updatedAt: Date.now(),
      rows: JSON.parse(JSON.stringify(rows)) as MeasureRow[],
      weightMode: mode,
      quickMode: qMode,
    };
    window.localStorage.setItem(
      inventoryDraftKey(taskId, moduleType),
      JSON.stringify(draft),
    );
  };

  const runAutosave = async (
    task: Task,
    rows: MeasureRow[],
    mode: WeightMode,
    qMode: "normal" | "reempaque",
    hash: string,
  ) => {
    if (isSavingRef.current) {
      queuedRef.current = true;
      queuedHashRef.current = hash;
      return;
    }
    isSavingRef.current = true;
    setAutosaveState("saving");

    const hasCapture = quickRowsHaveAnyCapture(rows);
    const totalsBultos = rows.reduce((a, row) => {
      const isReempaque = qMode === "reempaque" && row.reempaque === true;
      return a + (isReempaque ? 0 : parseFloat(String(row.bultos)) || 0);
    }, 0);
    const originalExpected = task.originalExpectedBultos || task.expectedBultos;
    const isCompleted =
      hasCapture &&
      totalsBultos >= task.expectedBultos &&
      hasQuickRequiredData(rows, qMode);

    const persistedRows = hasCapture ? rows : [];
    if (!hasCapture && typeof window !== "undefined") {
      window.localStorage.removeItem(inventoryDraftKey(task.id, moduleType));
    }

    const updatedTask: Task = {
      ...task,
      measureData: JSON.parse(JSON.stringify(persistedRows)),
      currentBultos: hasCapture ? totalsBultos : 0,
      weightMode: mode,
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
            weightMode: latestModeRef.current,
            quickMode: latestQuickModeRef.current,
          });
        queuedHashRef.current = "";
        if (latestTaskRef.current) {
          await runAutosave(
            latestTaskRef.current,
            latestRowsRef.current,
            latestModeRef.current,
            latestQuickModeRef.current,
            latestHash,
          );
        }
      }
    }
  };

  useEffect(() => {
    if (!selectedTask) return;
    latestRowsRef.current = measureRows;
    latestModeRef.current = weightMode;
    latestQuickModeRef.current = quickMode;
    latestTaskRef.current = selectedTask;
    const hash = JSON.stringify({ rows: measureRows, weightMode, quickMode });
    persistQuickDraft(selectedTask.id, measureRows, weightMode, quickMode);
    if (hash === lastSavedHashRef.current) return;

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(() => {
      void runAutosave(selectedTask, measureRows, weightMode, quickMode, hash);
    }, QUICK_AUTOSAVE_MS);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [measureRows, weightMode, quickMode, selectedTask, moduleType]);

  const saveOrder = () => {
    if (!selectedTask) return;
    const totals = calculateTotals();
    const hasCapture = quickRowsHaveAnyCapture(measureRows);
    const originalExpected =
      selectedTask.originalExpectedBultos || selectedTask.expectedBultos;
    const isCompleted =
      hasCapture &&
      totals.bultos >= selectedTask.expectedBultos &&
      hasQuickRequiredData(measureRows, quickMode);

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
      weightMode,
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

  const tableMinWidthClass =
    quickMode === "reempaque"
      ? showDetailedLineExtras
        ? "min-w-[1460px]"
        : "min-w-[1180px]"
      : showDetailedLineExtras
        ? "min-w-[1260px]"
        : "min-w-[980px]";

  // Lista de órdenes (sin task seleccionado) — encabezado fijo, solo la lista con barra de desplazamiento
  if (!selectedTask) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
          <div className="shrink-0 space-y-4 md:space-y-6 mb-4 md:mb-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 px-2 md:px-0">
              <h2 className="text-xl md:text-3xl font-black text-[#16263F] dark:text-slate-100 flex items-center gap-2 md:gap-3">
                {moduleType === "airway" ? (
                  <>
                    <Plane className="text-orange-500 w-5 h-5 md:w-8 md:h-8" />{" "}
                    GUÍA AÉREA
                  </>
                ) : (
                  <>
                    <Box className="text-[#16263F] dark:text-slate-100 w-5 h-5 md:w-8 md:h-8" />{" "}
                    INGRESO RÁPIDO
                  </>
                )}
              </h2>
              <button
                type="button"
                onClick={openManualModal}
                className="bg-white dark:bg-slate-900 hover:bg-slate-50 dark:bg-slate-800/60 text-[#16263F] dark:text-slate-100 border border-slate-200 dark:border-slate-600 px-4 py-2 md:px-5 md:py-2.5 rounded-xl font-bold shadow-sm transition cursor-pointer flex items-center justify-center gap-2 active:scale-95 text-[10px] md:text-xs uppercase tracking-widest w-full sm:w-auto"
              >
                <Plus size={16} /> Crear RA Manual
              </button>
            </div>

            <div className="flex flex-wrap bg-slate-200/50 p-1 rounded-xl w-full border border-slate-200 dark:border-slate-600 mx-2 md:mx-0">
              <button
                type="button"
                onClick={() => {
                  setViewMode("pending");
                  setClientFilter("Todos");
                }}
                className={`flex-1 min-w-[100px] px-4 py-2 rounded-lg text-[10px] md:text-xs font-black uppercase tracking-widest transition-all ${
                  viewMode === "pending"
                    ? "bg-white dark:bg-slate-900 shadow-sm text-blue-600 dark:text-blue-400"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200"
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
                className={`flex-1 min-w-[140px] px-4 py-2 rounded-lg text-[10px] md:text-xs font-black uppercase tracking-widest transition-all ${
                  viewMode === "priority"
                    ? "bg-red-500 shadow-sm text-white"
                    : "text-red-500 hover:bg-red-50"
                }`}
              >
                Prioridad Contenedor
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode("completed");
                  setClientFilter("Todos");
                }}
                className={`flex-1 min-w-[100px] px-4 py-2 rounded-lg text-[10px] md:text-xs font-black uppercase tracking-widest transition-all ${
                  viewMode === "completed"
                    ? "bg-white dark:bg-slate-900 shadow-sm text-green-600"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-200"
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
                className={`p-5 md:p-6 rounded-[1.5rem] md:rounded-[2rem] border shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col md:flex-row md:items-center justify-between group relative gap-4 ${
                  viewMode === "priority"
                    ? "bg-red-50 border-red-200"
                    : "bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-700"
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
                  <div className="flex justify-between items-start mb-4 pr-16 md:pr-20">
                    <div className="flex items-center gap-3">
                      <h3
                        className={`text-3xl md:text-4xl font-black tracking-tight truncate leading-none ${
                          viewMode === "priority"
                            ? "text-red-700"
                            : "text-[#16263F] dark:text-slate-100"
                        }`}
                      >
                        RA: {t.ra}
                      </h3>
                      {t.status === "in_progress" && (
                        <span className="px-2 py-1 rounded-md bg-amber-100 text-amber-700 text-[9px] font-black uppercase tracking-widest">
                          En curso
                        </span>
                      )}
                    </div>
                    <div
                      className={`px-3 py-1.5 rounded-xl text-center border min-w-[3.5rem] shadow-sm flex items-center gap-1.5 ${
                        viewMode === "priority"
                          ? "bg-red-100 text-red-700 border-red-200"
                          : "bg-[#F5F3FF] text-purple-700 border-[#EDE9FE]"
                      }`}
                    >
                      <span className="text-[9px] md:text-[10px] font-black uppercase tracking-widest">
                        BULTOS
                      </span>
                      <span className="text-xl md:text-2xl font-black leading-none">
                        {t.expectedBultos}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 border-t border-slate-100 dark:border-slate-700 pt-4 mt-2">
                    <div>
                      <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-0.5">
                        PROVEEDOR
                      </p>
                      <p className="text-xs md:text-sm font-bold text-[#16263F] dark:text-slate-100 truncate uppercase">
                        {t.provider}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-0.5">
                        MARCA / TRACKING
                      </p>
                      <p className="text-xs md:text-sm font-bold text-[#16263F] dark:text-slate-100 truncate uppercase">
                        {t.brand}
                      </p>
                    </div>
                  </div>
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

  const showWeightColumn = weightMode === "per_bundle";
  // La referencia debe poder capturarse en ambos modos.
  const showReferenceColumn = true;

  return (
    <>
    <div className="flex h-full min-h-0 w-full flex-1 flex-col animate-fade">
      <div className="shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-2 md:mb-3 px-2 md:px-0">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={clearTask}
            className="text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 md:bg-transparent px-4 py-2 md:px-0 md:py-0 rounded-lg md:rounded-none shadow-sm md:shadow-none font-bold hover:text-[#16263F] dark:text-slate-100 flex items-center gap-2 uppercase text-[10px] tracking-widest"
          >
            <ArrowLeft className="w-4 h-4" />{" "}
            <span className="hidden md:inline">Volver al listado</span>
          </button>
          <button
            type="button"
            onClick={() => setCsvExportOpen(true)}
            title="CSV (delimitado por comas), como en Excel"
            className="flex items-center gap-2 rounded-xl border-2 border-sky-400/80 bg-sky-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-sky-950 shadow-sm transition hover:border-sky-600 hover:bg-sky-100 dark:border-sky-500/50 dark:bg-sky-950/35 dark:text-sky-100 dark:hover:bg-sky-900/45"
          >
            <Download className="h-4 w-4 shrink-0 text-sky-700 dark:text-sky-300" />
            <span className="whitespace-nowrap">Descargar CSV</span>
          </button>
        </div>
        <div className="flex flex-col sm:flex-row w-full md:w-auto items-stretch md:items-center gap-2 md:gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
            <div className="rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setQuickMode("normal")}
                className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest ${
                  quickMode === "normal"
                    ? "bg-[#16263F] text-white"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-100"
                }`}
              >
                Normal
              </button>
              <button
                type="button"
                onClick={() => setQuickMode("reempaque")}
                className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest ${
                  quickMode === "reempaque"
                    ? "bg-amber-500 text-white"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-100"
                }`}
              >
                Con Reempaque
              </button>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 p-1 rounded-full flex text-[10px] md:text-sm font-bold text-slate-500 dark:text-slate-400 shadow-sm w-full sm:w-auto">
              <button
                type="button"
                onClick={() => updateWeightMode("by_reference")}
                className={`flex-1 sm:flex-none px-4 py-2 rounded-full transition-all ${
                  weightMode === "by_reference"
                    ? "bg-[#16263F] text-white shadow"
                    : "hover:bg-slate-50 dark:bg-slate-800/60"
                }`}
              >
                Por Referencia
              </button>
              <button
                type="button"
                onClick={() => updateWeightMode("per_bundle")}
                className={`flex-1 sm:flex-none px-4 py-2 rounded-full transition-all ${
                  weightMode === "per_bundle"
                    ? "bg-[#16263F] text-white shadow"
                    : "hover:bg-slate-50 dark:bg-slate-800/60"
                }`}
              >
                Por Peso
              </button>
            </div>
          </div>

          {t && (
            <div className="flex items-center gap-2">
              <span className="bg-white dark:bg-slate-900 text-[#16263F] dark:text-slate-100 border border-slate-200 dark:border-slate-600 px-4 py-2.5 rounded-full text-[10px] md:text-sm font-black shadow-sm text-center uppercase tracking-widest flex items-center justify-center gap-2 shrink-0">
                {moduleType === "airway" ? (
                  <Plane className="w-4 h-4 text-orange-500" />
                ) : (
                  <Box className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                )}{" "}
                RA-{t.ra}
              </span>
              <span
                key={autosaveTick}
                className={`px-3 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                  autosaveState === "saving"
                    ? "bg-amber-50 text-amber-700 border-amber-200"
                    : autosaveState === "saved"
                      ? "bg-green-50 text-green-700 border-green-200"
                      : autosaveState === "error"
                        ? "bg-red-50 text-red-700 border-red-200"
                        : "bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600"
                }`}
              >
                {autosaveState === "saving"
                  ? "Autoguardando..."
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
        <div className="flex h-full min-h-0 max-h-full flex-1 flex-col gap-1 overflow-hidden rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 shadow-sm sm:p-3 md:rounded-[2rem] md:shadow-lg lg:rounded-[3rem]">
          <InventoryReceptionCompact
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
            declared={originalExpected}
            physical={totals.bultos}
            faltantes={faltantes}
            totalCbm={totals.cbm}
            totalWeight={totals.weight}
            totalWeightDecimals={1}
          />

          <div className="inventory-table-scroll-host flex min-h-0 flex-1 basis-0 flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-[inset_0_0_0_1px_rgb(241,245,249)] dark:shadow-[inset_0_0_0_1px_rgb(30,41,59)]">
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto inventory-measures-scroll">
            <table
              className={`w-full border-collapse text-left text-sm md:min-w-full ${tableMinWidthClass}`}
            >
              <thead className="sticky top-0 z-20 border-b border-slate-200 dark:border-slate-600 bg-white/95 text-[9px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 shadow-sm backdrop-blur-sm md:text-[10px] supports-[backdrop-filter]:bg-white/90">
                <tr>
                  <th className="w-10 px-2 py-2 text-center">#</th>
                  {showReferenceColumn && (
                    <th className="w-32 px-2 py-2 text-left">REFERENCIA</th>
                  )}
                  {showReferenceColumn && showDetailedLineExtras && (
                    <th className="min-w-[120px] max-w-[200px] px-2 py-2 text-left">
                      Descripción
                    </th>
                  )}
                  {showReferenceColumn && showDetailedLineExtras && (
                    <th className="w-24 px-2 py-2 text-center">Und/bulto</th>
                  )}
                  <th className="w-28 px-2 py-2 text-center">BULTOS</th>
                  {quickMode === "reempaque" && (
                    <th className="w-24 px-2 py-2 text-center">REEMPAQUE</th>
                  )}
                  {quickMode === "reempaque" && (
                    <th className="w-28 px-2 py-2 text-center">REF CONT.</th>
                  )}
                  {showWeightColumn && (
                    <th className="w-28 px-2 py-2 text-center">PESO(KG)</th>
                  )}
                  <th className="w-24 px-2 py-2 text-center">L (CM)</th>
                  <th className="w-24 px-2 py-2 text-center">W (CM)</th>
                  <th className="w-24 px-2 py-2 text-center">H (CM)</th>
                  <th className="bg-slate-50 dark:bg-slate-800/60 px-2 py-2 text-center font-black text-[#16263F] dark:text-slate-100">
                    CBM TOTAL
                  </th>
                  <th className="w-12 px-2 py-2 text-center" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {measureRows.map((row, idx) => {
                  const l = parseFloat(String(row.l)) || 0;
                  const w = parseFloat(String(row.w)) || 0;
                  const h = parseFloat(String(row.h)) || 0;
                  const b = parseFloat(String(row.bultos)) || 0;
                  const isReempaque =
                    quickMode === "reempaque" && row.reempaque === true;
                  const rowCbm = isReempaque ? 0 : ((l * w * h) / 1_000_000) * b;
                  const containerRefOptions = measureRows
                    .filter((candidate) => candidate.id !== row.id && candidate.reempaque !== true)
                    .filter((candidate) => (parseFloat(String(candidate.bultos ?? 0)) || 0) > 0)
                    .map((candidate) => String(candidate.referencia ?? "").trim())
                    .filter((ref) => ref.length > 0);
                  const uniqueContainerRefOptions = Array.from(new Set(containerRefOptions));

                  return (
                    <tr
                      key={row.id}
                      className="group transition-colors odd:bg-white dark:bg-slate-900 even:bg-slate-50/60 dark:bg-slate-800/60 hover:bg-sky-50/80"
                    >
                      <td className="px-2 py-1 text-center text-base font-black text-slate-300 md:text-lg">
                        {idx + 1}
                      </td>

                      {showReferenceColumn && (
                        <td className="px-2 py-1 align-top">
                          <input
                            type="text"
                            onChange={(e) => {
                              const v = e.target.value;
                              updateRowValue(row.id, "referencia", v);
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
                            className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-left text-sm font-bold text-[#16263F] dark:text-slate-100 outline-none transition-all focus:border-[#16263F] focus:ring-1 focus:ring-[#16263F]/20"
                            placeholder="Referencia"
                          />
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

                      <td className="px-2 py-1">
                        <input
                          type="number"
                          disabled={isReempaque}
                          onChange={(e) =>
                            updateRowValue(row.id, "bultos", e.target.value)
                          }
                          value={row.bultos ?? ""}
                          className="no-spinners w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 py-1.5 text-center text-sm font-black text-blue-600 dark:text-blue-400 outline-none transition-all focus:border-blue-500 focus:ring-1 focus:ring-blue-500/25"
                          placeholder={isReempaque ? "--" : ""}
                        />
                      </td>

                      {quickMode === "reempaque" && (
                        <td className="px-2 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => toggleReempaque(row.id, !isReempaque)}
                            className={`rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wider ${
                              isReempaque
                                ? "bg-amber-500 text-white"
                                : "bg-slate-100 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                            }`}
                          >
                            {isReempaque ? "Sí" : "No"}
                          </button>
                        </td>
                      )}
                      {quickMode === "reempaque" && (
                        <td className="px-2 py-1">
                          {isReempaque ? (
                            <select
                              value={row.referenciaContenedora || ""}
                              onChange={(e) =>
                                updateRowValue(
                                  row.id,
                                  "referenciaContenedora",
                                  e.target.value,
                                )
                              }
                              className="w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-black text-amber-900 outline-none transition-all focus:border-amber-500"
                            >
                              <option value="">Selecciona referencia</option>
                              {uniqueContainerRefOptions.map((ref) => (
                                <option key={`${row.id}-host-${ref}`} value={ref}>
                                  {ref}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">
                              N/A
                            </span>
                          )}
                        </td>
                      )}

                      {showWeightColumn && (
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            onChange={(e) =>
                              updateRowValue(row.id, "weight", e.target.value)
                            }
                            value={row.weight ?? ""}
                            className="no-spinners w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 py-1.5 text-center text-sm font-bold text-[#16263F] dark:text-slate-100 outline-none transition-all focus:border-[#16263F] focus:ring-1 focus:ring-[#16263F]/20"
                            placeholder=""
                          />
                        </td>
                      )}

                      <td className="px-2 py-1">
                        <input
                          type="number"
                          disabled={isReempaque}
                          onChange={(e) =>
                            updateRowValue(row.id, "l", e.target.value)
                          }
                          value={row.l ?? ""}
                          className="no-spinners w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 py-1.5 text-center text-sm font-bold text-[#16263F] dark:text-slate-100 outline-none transition-all focus:border-[#16263F] focus:ring-1 focus:ring-[#16263F]/20"
                          placeholder={isReempaque ? "--" : ""}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          disabled={isReempaque}
                          onChange={(e) =>
                            updateRowValue(row.id, "w", e.target.value)
                          }
                          value={row.w ?? ""}
                          className="no-spinners w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 py-1.5 text-center text-sm font-bold text-[#16263F] dark:text-slate-100 outline-none transition-all focus:border-[#16263F] focus:ring-1 focus:ring-[#16263F]/20"
                          placeholder={isReempaque ? "--" : ""}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="number"
                          disabled={isReempaque}
                          onChange={(e) =>
                            updateRowValue(row.id, "h", e.target.value)
                          }
                          value={row.h ?? ""}
                          className="no-spinners w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 py-1.5 text-center text-sm font-bold text-[#16263F] dark:text-slate-100 outline-none transition-all focus:border-[#16263F] focus:ring-1 focus:ring-[#16263F]/20"
                          placeholder={isReempaque ? "--" : ""}
                        />
                      </td>

                      <td className="bg-slate-50 dark:bg-slate-800/60 px-2 py-1 text-center text-base font-black text-[#16263F] dark:text-slate-100 md:text-lg">
                        {rowCbm.toFixed(2)}
                      </td>
                      <td className="px-2 py-1 text-center">
                        <button
                          type="button"
                          onClick={() => deleteRow(row.id)}
                          className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-400 shadow-sm transition-all hover:bg-red-500 hover:text-white"
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

          <div className="isolate z-10 mt-1 shrink-0 border-t border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 pt-2 shadow-[0_-8px_24px_-10px_rgba(15,23,42,0.1)] md:pt-3">
            <input
              ref={referenciasExcelRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={onReferenciasExcelSelected}
            />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:gap-3">
              <button
                type="button"
                onClick={addRow}
                className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 py-3 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 transition-all hover:border-slate-400 hover:bg-slate-50 dark:bg-slate-800/60 hover:text-slate-600 dark:text-slate-300 md:rounded-full md:py-4 md:text-sm"
              >
                <Plus className="w-5 h-5" /> AGREGAR LÍNEA ADICIONAL
              </button>
              <button
                type="button"
                disabled={referenciasImportBusy}
                onClick={() => referenciasExcelRef.current?.click()}
                className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-300 bg-white dark:bg-slate-900 py-3 text-xs font-black uppercase tracking-widest text-emerald-800 transition-all hover:border-emerald-500 hover:bg-emerald-50 disabled:opacity-60 md:rounded-full md:py-4 md:text-sm"
              >
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                IMPORTAR REFERENCIAS (EXCEL)
              </button>
            </div>
            <button
              type="button"
              onClick={saveOrder}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0f172a] py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg transition-all hover:bg-black active:scale-95 md:rounded-full md:py-4 md:text-sm"
            >
              GUARDAR ORDEN <Check className="w-5 h-5" />
            </button>
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

