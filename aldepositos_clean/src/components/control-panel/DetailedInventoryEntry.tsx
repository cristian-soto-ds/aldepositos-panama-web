"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Box,
  Boxes,
  ClipboardCheck,
  Download,
  Edit,
  FileSpreadsheet,
  FileText,
  Package,
  Plus,
  Scale,
  Trash2,
} from "lucide-react";
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
import { M3Unit } from "@/components/control-panel/inventorySummaryUnits";
import {
  buildMeasurePatchFromCatalog,
  getReferenceCatalogItem,
  mergeCatalogIntoImportedRows,
  normalizePartNumber,
} from "@/lib/referenceCatalog";

type MeasureRow = {
  id: string;
  referencia?: string;
  descripcion?: string;
  bultos?: string | number;
  unidadesPorBulto?: string | number;
  pesoPorBulto?: string | number;
  l?: string | number;
  w?: string | number;
  h?: string | number;
  volumenM3?: string | number;
  unidad?: string;
  reempaque?: boolean;
  bultoContenedor?: string;
  referenciasContenedor?: string;
  referenciaContenedora?: string;
};

type Task = {
  id: string;
  ra: string;
  mainClient: string;
  provider: string;
  subClient: string;
  brand: string;
  expectedBultos: number;
  originalExpectedBultos: number;
  expectedCbm: number;
  expectedWeight: number;
  notes: string;
  currentBultos: number;
  status: string;
  measureData: MeasureRow[];
  weightMode: string;
  manualTotalWeight?: number;
  type?: string;
};

type DetailedInventoryEntryProps = {
  tasks: any[];
  onUpdateTask: (task: any) => void;
  onDeleteTask: (id: string) => void;
  onTransferTask: (task: any, newType: "quick" | "detailed" | "airway") => void;
  openManualModal: () => void;
  openEditModal: (task: any) => void;
  presenceUserKey?: string | null;
  presenceUserLabel?: string | null;
  presenceAvatarUrl?: string | null;
};

const generateId = () => Math.random().toString(36).slice(2, 11);
const CATALOG_DEBOUNCE_MS = 500;
const DETAILED_AUTOSAVE_MS = 700;
const detailedDraftKey = (taskId: string) =>
  `detailed_inventory_draft_v1_${taskId}`;
type AutosaveState = "idle" | "saving" | "saved" | "error";
type DetailedDraft = {
  updatedAt: number;
  rows: MeasureRow[];
};

function hasDetailedRequiredData(rows: MeasureRow[]): boolean {
  if (rows.length === 0) return false;
  return rows.every((row) => {
    const referencia = String(row.referencia ?? "").trim();
    const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
    const esReempaque = row.reempaque === true;
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

function detailedRowsHaveAnyCapture(rows: MeasureRow[]): boolean {
  return rows.some((row) => {
    const referencia = String(row.referencia ?? "").trim();
    const descripcion = String(row.descripcion ?? "").trim();
    const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
    const upb = parseFloat(String(row.unidadesPorBulto ?? 0)) || 0;
    const peso = parseFloat(String(row.pesoPorBulto ?? 0)) || 0;
    const l = parseFloat(String(row.l ?? 0)) || 0;
    const w = parseFloat(String(row.w ?? 0)) || 0;
    const h = parseFloat(String(row.h ?? 0)) || 0;
    const bultoContenedor = String(row.bultoContenedor ?? "").trim();
    const referenciasContenedor = String(row.referenciasContenedor ?? "").trim();
    const referenciaContenedora = String(row.referenciaContenedora ?? "").trim();
    return (
      referencia.length > 0 ||
      descripcion.length > 0 ||
      bultos > 0 ||
      upb > 0 ||
      peso > 0 ||
      l > 0 ||
      w > 0 ||
      h > 0 ||
      row.reempaque === true ||
      bultoContenedor.length > 0 ||
      referenciasContenedor.length > 0 ||
      referenciaContenedora.length > 0
    );
  });
}

export function DetailedInventoryEntry({
  tasks,
  onUpdateTask,
  onDeleteTask,
  onTransferTask,
  openManualModal,
  openEditModal,
  presenceUserKey = null,
  presenceUserLabel = null,
  presenceAvatarUrl = null,
}: DetailedInventoryEntryProps) {
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

  const detailedTasks = tasks.filter((t) => {
    if (t.type !== "detailed") return false;
    if (viewMode === "completed") {
      // Solo completados reales. "partial" es en curso/captura.
      return t.status === "completed";
    }
    if (viewMode === "priority") {
      return (
        t.status === "pending" &&
        (t.containerDraft === true || t.dispatched === true)
      );
    }
    return (
      (t.status === "pending" || t.status === "partial") &&
      !t.containerDraft &&
      !t.dispatched
    );
  });

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [clientFilter, setClientFilter] = useState("Todos");
  const [measureRows, setMeasureRows] = useState<MeasureRow[]>([]);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [autosaveTick, setAutosaveTick] = useState(0);
  const [detailedMode, setDetailedMode] = useState<"normal" | "reempaque">(
    "normal",
  );

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
    const tabId = getSharedWorkPresenceTabId();
    const send = () => {
      publishWorkPresence({
        tabId,
        userKey: key,
        userLabel: label,
        avatarUrl: presenceAvatarUrl?.trim() || null,
        ra: selectedTask ? String(selectedTask.ra ?? "").trim() : "",
        module: "detailed",
      });
    };
    send();
    const interval = window.setInterval(send, 12000);
    return () => {
      window.clearInterval(interval);
      void clearWorkPresence(tabId);
    };
  }, [selectedTask, presenceUserKey, presenceUserLabel, presenceAvatarUrl]);

  const groupedTasks = detailedTasks.reduce<Record<string, Task[]>>(
    (groups, task) => {
      const client = task.mainClient || "Sin Cliente";
      if (!groups[client]) groups[client] = [];
      groups[client].push(task);
      return groups;
    },
    {},
  );

  const clients = Object.keys(groupedTasks);
  const totalTasks = detailedTasks.length;

  const priorityCount = tasks.filter(
    (t) =>
      t.type === "detailed" &&
      t.status === "pending" &&
      (t.containerDraft || t.dispatched),
  ).length;

  let displayedTasks = detailedTasks;
  if (clientFilter !== "Todos" && clients.includes(clientFilter)) {
    displayedTasks = groupedTasks[clientFilter];
  }

  const calculateTotals = () => {
    if (!selectedTask) {
      return {
        bultos: 0,
        cbm: "0.000",
        weight: 0,
        unidades: 0,
      };
    }

    let bultos = 0;
    let weight = 0;
    let cbm = 0;
    let unidades = 0;

    measureRows.forEach((row) => {
      const rowBultos = parseFloat(String(row.bultos ?? 0)) || 0;
      const rowPesoPorBulto = parseFloat(String(row.pesoPorBulto ?? 0)) || 0;
      const rowUnidadesPorBulto =
        parseFloat(String(row.unidadesPorBulto ?? 0)) || 0;
      const l = parseFloat(String(row.l ?? 0)) || 0;
      const w = parseFloat(String(row.w ?? 0)) || 0;
      const h = parseFloat(String(row.h ?? 0)) || 0;
      const isReempaque = row.reempaque === true;
      const countedBultos = isReempaque ? 0 : rowBultos;

      bultos += countedBultos;
      weight += countedBultos * rowPesoPorBulto;
      unidades += countedBultos * rowUnidadesPorBulto;
      cbm += isReempaque ? 0 : ((l * w * h) / 1_000_000) * countedBultos;
    });

    return {
      bultos,
      cbm: cbm.toFixed(2),
      weight,
      unidades,
    };
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
              reempaque: false,
              bultoContenedor: "",
              referenciasContenedor: "",
              referenciaContenedora: "",
            },
          ];

    const serverHasCapture = detailedRowsHaveAnyCapture(taskRows);
    let rowsToUse = taskRows;
    if (typeof window !== "undefined") {
      const rawDraft = window.localStorage.getItem(detailedDraftKey(task.id));
      if (rawDraft) {
        try {
          const parsed = JSON.parse(rawDraft) as DetailedDraft;
          if (Array.isArray(parsed.rows) && parsed.rows.length > 0) {
            const draftHasCapture = detailedRowsHaveAnyCapture(parsed.rows);
            // Si el servidor ya tiene líneas (p. ej. enviadas desde orden de recolección),
            // no dejar que un borrador local vacío/antiguo las pise.
            if (!serverHasCapture && draftHasCapture) {
              rowsToUse = parsed.rows;
            }
          }
        } catch {
          // ignore invalid draft
        }
      }
    }

    setMeasureRows(rowsToUse);
    const hasReempaqueRows = rowsToUse.some((row) => row.reempaque === true);
    setDetailedMode(hasReempaqueRows ? "reempaque" : "normal");
    latestRowsRef.current = rowsToUse;
    latestTaskRef.current = task;
    lastSavedHashRef.current = JSON.stringify({ rows: rowsToUse });
    setAutosaveState("idle");
  };

  const clearTask = () => {
    setSelectedTask(null);
    setMeasureRows([]);
    activeTaskIdRef.current = null;
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  };

  const addRow = () => {
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
        reempaque: false,
        bultoContenedor: "",
        referenciasContenedor: "",
        referenciaContenedora: "",
      },
    ]);
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
            descripcion: "",
            bultos: r.bultos !== undefined ? String(r.bultos) : "",
            unidadesPorBulto: "",
            pesoPorBulto: "",
            l: "",
            w: "",
            h: "",
            reempaque: false,
            bultoContenedor: "",
            referenciasContenedor: "",
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

        void mergeCatalogIntoImportedRows("detailed", additions)
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
  ) => {
    setMeasureRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  };

  const runCatalogLookup = useCallback(async (rowId: string, rawReferencia: string) => {
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
    const patch = buildMeasurePatchFromCatalog("detailed", item);
    setMeasureRows((prev) =>
      prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
    );
  }, []);

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
              referenciaContenedora: enabled ? row.referenciaContenedora ?? "" : "",
            },
      ),
    );
  };

  const persistDetailedDraft = (taskId: string, rows: MeasureRow[]) => {
    if (typeof window === "undefined") return;
    const draft: DetailedDraft = {
      updatedAt: Date.now(),
      rows: JSON.parse(JSON.stringify(rows)) as MeasureRow[],
    };
    window.localStorage.setItem(detailedDraftKey(taskId), JSON.stringify(draft));
  };

  const runAutosave = async (task: Task, rows: MeasureRow[], hash: string) => {
    if (isSavingRef.current) {
      queuedRef.current = true;
      queuedHashRef.current = hash;
      return;
    }
    isSavingRef.current = true;
    setAutosaveState("saving");

    let bultos = 0;
    let weight = 0;
    let cbm = 0;
    rows.forEach((row) => {
      const rowBultos = parseFloat(String(row.bultos ?? 0)) || 0;
      const rowPesoPorBulto = parseFloat(String(row.pesoPorBulto ?? 0)) || 0;
      const l = parseFloat(String(row.l ?? 0)) || 0;
      const w = parseFloat(String(row.w ?? 0)) || 0;
      const h = parseFloat(String(row.h ?? 0)) || 0;
      const isReempaque = row.reempaque === true;
      const countedBultos = isReempaque ? 0 : rowBultos;
      bultos += countedBultos;
      weight += countedBultos * rowPesoPorBulto;
      cbm += isReempaque ? 0 : ((l * w * h) / 1_000_000) * countedBultos;
    });

    const hasCapture = detailedRowsHaveAnyCapture(rows);
    const originalExpected = task.originalExpectedBultos ?? task.expectedBultos;
    const isCompleted =
      hasCapture &&
      bultos >= task.expectedBultos &&
      hasDetailedRequiredData(rows);

    const persistedRows = hasCapture ? rows : [];
    if (!hasCapture && typeof window !== "undefined") {
      window.localStorage.removeItem(detailedDraftKey(task.id));
    }

    const updatedTask: Task = {
      ...task,
      measureData: JSON.parse(JSON.stringify(persistedRows)),
      currentBultos: hasCapture ? bultos : 0,
      expectedWeight: weight > 0 ? weight : task.expectedWeight,
      expectedCbm: cbm > 0 ? parseFloat(cbm.toFixed(2)) : task.expectedCbm,
      status: isCompleted ? "completed" : hasCapture ? "partial" : "pending",
      originalExpectedBultos: originalExpected,
    };

    try {
      await Promise.resolve((onUpdateTask as (t: Task) => unknown)(updatedTask));
      if (activeTaskIdRef.current === task.id) setSelectedTask(updatedTask);
      lastSavedHashRef.current = hash;
      setAutosaveState("saved");
      setAutosaveTick((v) => v + 1);
    } catch {
      setAutosaveState("error");
    } finally {
      isSavingRef.current = false;
      if (queuedRef.current && queuedHashRef.current !== lastSavedHashRef.current) {
        queuedRef.current = false;
        const latestHash = queuedHashRef.current || JSON.stringify({ rows: latestRowsRef.current });
        queuedHashRef.current = "";
        if (latestTaskRef.current) {
          await runAutosave(latestTaskRef.current, latestRowsRef.current, latestHash);
        }
      }
    }
  };

  useEffect(() => {
    if (!selectedTask) return;
    latestRowsRef.current = measureRows;
    latestTaskRef.current = selectedTask;
    const hash = JSON.stringify({ rows: measureRows });
    persistDetailedDraft(selectedTask.id, measureRows);
    if (hash === lastSavedHashRef.current) return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      void runAutosave(selectedTask, measureRows, hash);
    }, DETAILED_AUTOSAVE_MS);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [measureRows, selectedTask]);

  const saveOrder = () => {
    if (!selectedTask) return;

    const { bultos, weight, cbm } = calculateTotals();
    const originalExpected =
      selectedTask.originalExpectedBultos ?? selectedTask.expectedBultos;
    const hasCapture = detailedRowsHaveAnyCapture(measureRows);
    const isCompleted =
      hasCapture &&
      bultos >= selectedTask.expectedBultos &&
      hasDetailedRequiredData(measureRows);

    const persistedRows = hasCapture ? measureRows : [];
    if (!hasCapture && typeof window !== "undefined") {
      window.localStorage.removeItem(detailedDraftKey(selectedTask.id));
    }

    const updatedTask: Task = {
      ...selectedTask,
      measureData: JSON.parse(JSON.stringify(persistedRows)),
      currentBultos: hasCapture ? bultos : 0,
      expectedWeight: weight > 0 ? weight : selectedTask.expectedWeight,
      expectedCbm: parseFloat(cbm) > 0 ? parseFloat(cbm) : selectedTask.expectedCbm,
      status: isCompleted ? "completed" : hasCapture ? "partial" : "pending",
      originalExpectedBultos: originalExpected,
    };

    onUpdateTask(updatedTask);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(detailedDraftKey(selectedTask.id));
    }
    setAutosaveState("saved");
    clearTask();
  };

  if (!selectedTask) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 flex-col animate-fade overflow-y-auto">
        <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
          <div className="shrink-0 space-y-4 md:space-y-6 mb-4 md:mb-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 px-2 md:px-0">
              <h2 className="text-xl md:text-3xl font-black text-[#16263F] dark:text-slate-100 flex items-center gap-2 md:gap-3">
                <ClipboardCheck className="text-[#16263F] dark:text-slate-100 w-5 h-5 md:w-8 md:h-8" />{" "}
                INGRESO DETALLADO
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
                className={`flex-1 min-w-[140px] px-4 py-2 rounded-lg text-[10px] md:text-xs font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                  viewMode === "priority"
                    ? "bg-red-500 shadow-sm text-white"
                    : "text-red-500 hover:bg-red-50"
                }`}
              >
                Prioridad Contenedor
                {priorityCount > 0 && (
                  <span
                    className={`w-5 h-5 flex items-center justify-center rounded-full text-[9px] ${
                      viewMode === "priority"
                        ? "bg-white dark:bg-slate-900 text-red-600"
                        : "bg-red-500 text-white"
                    }`}
                  >
                    {priorityCount}
                  </span>
                )}
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
                  TODOS ({totalTasks})
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

          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-20">
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
                                onTransferTask(t, "airway");
                                setTransferOpenId(null);
                              }}
                              className="w-full px-4 py-2 text-left text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:bg-slate-800/60"
                            >
                              → Guía Aérea
                            </button>
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
                        {t.status === "partial" && (
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

  const t = selectedTask!;
  const totals = calculateTotals();
  const originalExpected =
    t.originalExpectedBultos && t.originalExpectedBultos !== 0
      ? t.originalExpectedBultos
      : t.expectedBultos || 0;
  const faltantes = originalExpected - totals.bultos;

  return (
    <>
    <div className="flex h-full min-h-0 w-full flex-1 flex-col animate-fade">
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col">
        <div className="mb-2 flex shrink-0 flex-col items-start justify-between gap-3 px-2 md:mb-3 md:flex-row md:items-center md:px-0">
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
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <div className="flex items-center gap-2">
              <div className="rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => setDetailedMode("normal")}
                  className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                    detailedMode === "normal"
                      ? "bg-[#16263F] text-white"
                      : "text-slate-600 dark:text-slate-300 hover:bg-slate-100"
                  }`}
                >
                  Normal
                </button>
                <button
                  type="button"
                  onClick={() => setDetailedMode("reempaque")}
                  className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                    detailedMode === "reempaque"
                      ? "bg-amber-500 text-white"
                      : "text-slate-600 dark:text-slate-300 hover:bg-slate-100"
                  }`}
                >
                  Con Reempaque
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
            <span className="bg-white dark:bg-slate-900 text-[#16263F] dark:text-slate-100 border border-slate-200 dark:border-slate-600 px-6 py-3 rounded-xl text-[10px] md:text-sm font-black shadow-sm text-center uppercase tracking-widest flex items-center justify-center gap-2 shrink-0">
              <ClipboardCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" /> RA-{t.ra}
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
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden pr-1">
          <div className="flex h-full min-h-0 max-h-full flex-1 flex-col gap-1 overflow-hidden rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 shadow-xl sm:p-3 md:shadow-2xl lg:rounded-[3rem]">
            <div className="flex min-w-0 shrink-0 flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-3">
              <div className="relative min-w-0 flex-1 overflow-x-hidden rounded-2xl border-2 border-slate-200 dark:border-slate-600/90 dark:border-slate-600/90 bg-white dark:bg-slate-900 shadow-md ring-1 ring-slate-900/[0.04]">
                <div
                  className="absolute left-0 top-0 h-full w-1.5 rounded-l-2xl bg-[#16263F]"
                  aria-hidden
                />
                <div className="pl-3 pr-3 pb-3 pt-3 sm:pl-5 sm:pr-5 sm:pb-4 sm:pt-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2.5 border-b-2 border-slate-100 dark:border-slate-700 pb-3 sm:gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#16263F] text-white shadow-md ring-2 ring-[#16263F]/20">
                      <ClipboardCheck className="h-5 w-5" aria-hidden />
                    </span>
                    <h4 className="min-w-0 flex-1 text-sm font-black uppercase tracking-wide text-[#16263F] dark:text-slate-100 sm:text-base">
                      Datos originales
                    </h4>
                    <span className="inline-flex shrink-0 items-center rounded-full border-2 border-blue-200/80 bg-blue-50 dark:bg-blue-950/45 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-blue-800 shadow-sm sm:text-[11px]">
                      Ingreso detallado
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
                    <div className="rounded-xl border-2 border-slate-100 dark:border-slate-700 bg-slate-50/95 dark:bg-slate-800/95 px-3 py-2.5 shadow-sm sm:py-3">
                      <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 sm:text-[11px]">
                        Proveedor / naviera
                      </p>
                      <p className="break-words text-sm font-bold leading-snug text-[#16263F] dark:text-slate-100 sm:text-base">
                        {t.provider}
                      </p>
                    </div>
                    <div className="rounded-xl border-2 border-slate-100 dark:border-slate-700 bg-slate-50/95 dark:bg-slate-800/95 px-3 py-2.5 shadow-sm sm:py-3">
                      <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 sm:text-[11px]">
                        Marca · tracking
                      </p>
                      <p className="break-words text-sm font-bold leading-snug text-[#16263F] dark:text-slate-100 sm:text-base">
                        {t.brand}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:col-span-2 sm:grid-cols-2 sm:gap-3">
                      <div className="rounded-xl border-2 border-sky-200/80 bg-gradient-to-br from-sky-50 to-sky-100/40 px-3 py-2.5 shadow-sm sm:py-3">
                        <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-sky-800 sm:text-[11px]">
                          Volumen en documento
                        </p>
                        <p className="flex flex-wrap items-baseline gap-1 text-lg font-black tabular-nums text-sky-950 sm:text-xl">
                          {t.expectedCbm ?? 0}
                          <M3Unit
                            size="md"
                            className="font-black text-sky-800 text-sm sm:text-base"
                          />
                        </p>
                      </div>
                      <div className="rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2.5 shadow-sm sm:py-3">
                        <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-600 dark:text-slate-300 sm:text-[11px]">
                          Peso en documento
                        </p>
                        <p className="text-lg font-black tabular-nums text-slate-900 dark:text-slate-100 sm:text-xl">
                          {t.expectedWeight ?? 0}
                          <span className="ml-1 text-sm font-bold text-slate-500 dark:text-slate-400 sm:text-base">
                            kg
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 rounded-xl border-2 border-dashed border-amber-400/70 bg-gradient-to-br from-amber-50/95 to-orange-50/50 px-3 py-2.5 shadow-sm sm:mt-4 sm:px-4 sm:py-3">
                    <p className="mb-1.5 flex items-center gap-2 text-[10px] font-black uppercase tracking-wide text-amber-900 sm:text-[11px]">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-200/60 text-amber-900">
                        <FileText className="h-4 w-4" aria-hidden />
                      </span>
                      Expedidor · notas
                    </p>
                    <p className="text-sm font-semibold leading-relaxed text-amber-950/95 sm:text-[15px]">
                      {t.subClient}
                      {t.notes ? (
                        <>
                          <span className="mx-2 inline font-light text-amber-700/50">
                            |
                          </span>
                          {t.notes}
                        </>
                      ) : null}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex min-w-0 shrink-0 flex-col gap-2 lg:w-[min(100%,24.5rem)] lg:border-l lg:border-slate-200 dark:border-slate-600 lg:pl-4">
                <div className="rounded-xl bg-[#16263F] px-3 py-2 shadow-md ring-1 ring-black/10">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/85">
                    Captura actual
                  </p>
                  <p className="mt-0.5 text-balance text-sm font-black leading-snug text-white sm:text-[0.95rem]">
                    Bultos · totales líneas
                  </p>
                </div>
                <div className="grid min-w-0 grid-cols-2 gap-2">
                  <div className="flex min-h-[4.75rem] min-w-0 flex-col justify-between rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-gradient-to-b from-white to-slate-50/90 px-2.5 py-2 shadow-sm sm:min-h-[5rem] sm:px-3 sm:py-2.5">
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-white shadow-sm sm:h-9 sm:w-9 sm:rounded-xl">
                        <Package className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden />
                      </span>
                      <p className="min-w-0 text-[9px] font-black uppercase leading-tight tracking-wide text-slate-600 dark:text-slate-300 sm:text-[11px]">
                        Declarados
                      </p>
                    </div>
                    <p className="text-[1.6rem] font-black tabular-nums leading-none tracking-tight text-[#16263F] dark:text-slate-100 sm:text-[1.85rem]">
                      {originalExpected}
                    </p>
                  </div>
                  <div className="flex min-h-[4.75rem] min-w-0 flex-col justify-between rounded-xl border-2 border-violet-300 bg-gradient-to-b from-violet-50 to-violet-100/40 px-2.5 py-2 shadow-sm sm:min-h-[5rem] sm:px-3 sm:py-2.5">
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white shadow-sm sm:h-9 sm:w-9 sm:rounded-xl">
                        <Boxes className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden />
                      </span>
                      <p className="min-w-0 text-[9px] font-black uppercase leading-tight tracking-wide text-violet-900 sm:text-[11px]">
                        Físicos
                      </p>
                    </div>
                    <p className="text-[1.6rem] font-black tabular-nums leading-none tracking-tight text-violet-950 sm:text-[1.85rem]">
                      {totals.bultos}
                    </p>
                  </div>
                  <div
                    className={`col-span-2 flex min-h-[4.25rem] items-center justify-between gap-3 rounded-xl border-2 px-3 py-2 shadow-sm sm:min-h-[4.5rem] sm:py-2.5 ${
                      faltantes > 0
                        ? "border-amber-400 bg-gradient-to-r from-amber-50 to-amber-100/40"
                        : faltantes < 0
                          ? "border-red-400 bg-gradient-to-r from-red-50 to-red-100/35"
                          : "border-emerald-400 bg-gradient-to-r from-emerald-50 to-emerald-100/40"
                    }`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white shadow-sm sm:h-9 sm:w-9 sm:rounded-xl ${
                          faltantes > 0
                            ? "bg-amber-600"
                            : faltantes < 0
                              ? "bg-red-600"
                              : "bg-emerald-600"
                        }`}
                      >
                        <Scale className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-wide text-slate-900 dark:text-slate-100 sm:text-[11px]">
                          Diferencia
                        </p>
                        <p
                          className={`text-[9px] font-bold uppercase tracking-wide sm:text-[10px] ${
                            faltantes === 0
                              ? "text-emerald-800"
                              : faltantes > 0
                                ? "text-amber-900"
                                : "text-red-800"
                          }`}
                        >
                          {faltantes === 0
                            ? "Cuadra con declarado"
                            : faltantes > 0
                              ? "Faltan por contar"
                              : "Revisar exceso"}
                        </p>
                      </div>
                    </div>
                    <p
                      className={`shrink-0 text-3xl font-black tabular-nums leading-none sm:text-[2.25rem] ${
                        faltantes > 0
                          ? "text-amber-800"
                          : faltantes < 0
                            ? "text-red-600"
                            : "text-emerald-800"
                      }`}
                    >
                      {faltantes}
                    </p>
                  </div>
                  <div className="col-span-2 rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-slate-50/90 dark:bg-slate-800/90 px-3 py-2 shadow-sm sm:py-2.5">
                    <p className="mb-1.5 text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 sm:mb-2 sm:text-[10px]">
                      Resumen tabla
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
                          Unidades
                        </p>
                        <p className="text-base font-black tabular-nums text-[#16263F] dark:text-slate-100 sm:text-lg">
                          {totals.unidades}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
                          Volumen
                        </p>
                        <p className="flex flex-wrap items-baseline gap-1 text-base font-black tabular-nums text-[#16263F] dark:text-slate-100 sm:text-lg">
                          {Number(totals.cbm).toFixed(2)}
                          <M3Unit size="sm" className="text-xs font-black sm:text-sm" />
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
                          Peso
                        </p>
                        <p className="text-base font-black tabular-nums text-[#16263F] dark:text-slate-100 sm:text-lg">
                          {totals.weight.toFixed(2)}
                          <span className="ml-1 text-sm font-bold text-slate-500 dark:text-slate-400">
                            kg
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="inventory-table-scroll-host flex min-h-0 flex-1 basis-0 flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-[inset_0_0_0_1px_rgb(241,245,249)] dark:shadow-[inset_0_0_0_1px_rgb(30,41,59)]">
              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto inventory-measures-scroll">
              <table className={`w-full border-collapse text-left text-sm ${detailedMode === "reempaque" ? "min-w-[1500px]" : "min-w-[1240px]"}`}>
                <thead className="sticky top-0 z-20 border-b border-slate-200 dark:border-slate-600 bg-white/95 text-[9px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 shadow-sm backdrop-blur-sm md:text-[10px] supports-[backdrop-filter]:bg-white/90">
                  <tr>
                    <th className="w-10 px-2 py-2 text-center">#</th>
                    <th className="w-32 px-2 py-2 text-left">REFERENCIA</th>
                    <th className="w-40 px-2 py-2 text-left">DESCRIPCIÓN</th>
                    <th className="w-20 border-b border-purple-100 bg-purple-50 px-2 py-2 text-center text-purple-600">
                      BULTOS
                    </th>
                    <th className="w-24 px-2 py-2 text-center">UND/BULTO</th>
                    <th className="w-20 bg-slate-50 dark:bg-slate-800/60 px-2 py-2 text-center">
                      TOT UND
                    </th>
                    <th className="w-24 px-2 py-2 text-center">PESO/B (KG)</th>
                    <th className="w-20 bg-slate-50 dark:bg-slate-800/60 px-2 py-2 text-center">
                      PESO TOT
                    </th>
                    {detailedMode === "reempaque" && (
                      <th className="w-24 px-2 py-2 text-center">REEMPAQUE</th>
                    )}
                    {detailedMode === "reempaque" && (
                      <th className="w-28 px-2 py-2 text-center">REF CONT.</th>
                    )}
                    <th className="w-20 px-2 py-2 text-center">L (CM)</th>
                    <th className="w-20 px-2 py-2 text-center">W (CM)</th>
                    <th className="w-20 px-2 py-2 text-center">H (CM)</th>
                    <th className="w-24 bg-slate-50 dark:bg-slate-800/60 px-2 py-2 text-center">
                      CBM/BULTO
                    </th>
                    <th className="w-28 border-b border-blue-100 bg-blue-50 dark:bg-blue-950/45 px-2 py-2 text-center font-black text-blue-700 dark:text-blue-300">
                      CUBICAJE TOT
                    </th>
                    <th className="w-12 px-2 py-2 text-center" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {measureRows.map((row, idx) => {
                    const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
                    const undPerBulto =
                      parseFloat(String(row.unidadesPorBulto ?? 0)) || 0;
                    const totalUnidades = bultos * undPerBulto;

                    const pesoPorBulto =
                      parseFloat(String(row.pesoPorBulto ?? 0)) || 0;
                    const pesoTotal = bultos * pesoPorBulto;

                    const l = parseFloat(String(row.l ?? 0)) || 0;
                    const w = parseFloat(String(row.w ?? 0)) || 0;
                    const h = parseFloat(String(row.h ?? 0)) || 0;
                    const isReempaque =
                      detailedMode === "reempaque" && row.reempaque === true;
                    const cbmPorBulto = isReempaque ? 0 : (l * w * h) / 1_000_000;
                    const cubicajeTotal = cbmPorBulto * bultos;
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
                        <td className="px-2 py-1 text-center text-sm font-black text-slate-300">
                          {idx + 1}
                        </td>

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
                            className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-left text-xs font-bold text-[#16263F] dark:text-slate-100 outline-none transition-all focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            placeholder="Ref..."
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="text"
                            onChange={(e) =>
                              updateRowValue(row.id, "descripcion", e.target.value)
                            }
                            value={row.descripcion || ""}
                            className="w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-left text-xs font-medium text-slate-600 dark:text-slate-300 outline-none transition-all focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            placeholder="Desc..."
                          />
                        </td>

                        <td className="bg-purple-50/50 px-2 py-1">
                          <input
                            type="number"
                            disabled={isReempaque}
                            onChange={(e) =>
                              updateRowValue(row.id, "bultos", e.target.value)
                            }
                            value={row.bultos ?? ""}
                            className="no-spinners w-full rounded-lg border border-purple-200 bg-white dark:bg-slate-900 py-1 text-center text-sm font-black text-purple-700 outline-none transition-all focus:border-purple-400"
                            placeholder={isReempaque ? "--" : "0"}
                          />
                        </td>

                        <td className="px-2 py-1">
                          <input
                            type="number"
                            onChange={(e) =>
                              updateRowValue(
                                row.id,
                                "unidadesPorBulto",
                                e.target.value,
                              )
                            }
                            value={row.unidadesPorBulto ?? ""}
                            className="no-spinners w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 py-1 text-center text-sm font-bold text-[#16263F] dark:text-slate-100 outline-none transition-all focus:border-slate-400"
                            placeholder="0"
                          />
                        </td>

                        <td className="bg-slate-50 dark:bg-slate-800/60 px-2 py-1 text-center text-sm font-black text-[#16263F] dark:text-slate-100">
                          {totalUnidades}
                        </td>

                        <td className="px-2 py-1">
                          <input
                            type="number"
                            step="0.01"
                            onChange={(e) =>
                              updateRowValue(
                                row.id,
                                "pesoPorBulto",
                                e.target.value,
                              )
                            }
                            value={row.pesoPorBulto ?? ""}
                            className="no-spinners w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 py-1 text-center text-sm font-bold text-[#16263F] dark:text-slate-100 outline-none transition-all focus:border-slate-400"
                            placeholder="0.0"
                          />
                        </td>

                        <td className="bg-slate-50 dark:bg-slate-800/60 px-2 py-1 text-center text-sm font-black text-[#16263F] dark:text-slate-100">
                          {pesoTotal.toFixed(2)}
                        </td>
                        {detailedMode === "reempaque" && (
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
                              {isReempaque ? "Si" : "No"}
                            </button>
                          </td>
                        )}
                        {detailedMode === "reempaque" && (
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
                              className="w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-black text-amber-900 outline-none transition-all focus:border-amber-500"
                            >
                              <option value="">Selecciona referencia</option>
                              {uniqueContainerRefOptions.map((ref) => (
                                <option key={`${row.id}-host-${ref}`} value={ref}>
                                  {ref}
                                </option>
                              ))}
                            </select>
                            ) : (
                              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">N/A</span>
                            )}
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
                            className="no-spinners w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 py-1 text-center text-sm font-bold text-[#16263F] dark:text-slate-100 outline-none transition-all focus:border-slate-400"
                            placeholder={isReempaque ? "--" : "0"}
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
                            className="no-spinners w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 py-1 text-center text-sm font-bold text-[#16263F] dark:text-slate-100 outline-none transition-all focus:border-slate-400"
                            placeholder={isReempaque ? "--" : "0"}
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
                            className="no-spinners w-full rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 py-1 text-center text-sm font-bold text-[#16263F] dark:text-slate-100 outline-none transition-all focus:border-slate-400"
                            placeholder={isReempaque ? "--" : "0"}
                          />
                        </td>

                        <td className="bg-slate-50 dark:bg-slate-800/60 px-2 py-1 text-center text-xs font-bold text-slate-500 dark:text-slate-400">
                          {cbmPorBulto.toFixed(2)}
                        </td>

                        <td className="bg-blue-50 dark:bg-blue-950/50 px-2 py-1 text-center text-sm font-black text-blue-700 dark:text-blue-300">
                          {cubicajeTotal.toFixed(2)}
                        </td>

                        <td className="px-2 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => deleteRow(row.id)}
                            className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-400 shadow-sm transition-all hover:bg-red-500 hover:text-white"
                          >
                            <Trash2 size={14} />
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
                GUARDAR ORDEN DETALLADA <Box className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
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
        const raSafe = String(t.ra ?? "RA").replace(/[/\\?%*:|"<>]/g, "-");
        downloadInventarioCsv({
          numeroDocumento,
          measureRows: rows,
          variant: "detailed",
          filenameBase: `inventario-detallado-${raSafe}`,
        });
        setCsvExportOpen(false);
      }}
    />
    </>
  );
}

