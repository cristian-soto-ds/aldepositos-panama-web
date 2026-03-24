"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  Box,
  ClipboardCheck,
  Edit,
  Plus,
  Trash2,
} from "lucide-react";

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
};

const generateId = () => Math.random().toString(36).slice(2, 11);
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
    const l = parseFloat(String(row.l ?? 0)) || 0;
    const w = parseFloat(String(row.w ?? 0)) || 0;
    const h = parseFloat(String(row.h ?? 0)) || 0;
    return referencia.length > 0 && bultos > 0 && l > 0 && w > 0 && h > 0;
  });
}

export function DetailedInventoryEntry({
  tasks,
  onUpdateTask,
  onDeleteTask,
  onTransferTask,
  openManualModal,
  openEditModal,
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
      return t.status === "completed" || t.status === "partial";
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

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);
  const queuedRef = useRef(false);
  const queuedHashRef = useRef<string>("");
  const lastSavedHashRef = useRef<string>("");
  const activeTaskIdRef = useRef<string | null>(null);
  const latestRowsRef = useRef<MeasureRow[]>([]);
  const latestTaskRef = useRef<Task | null>(null);

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

      bultos += rowBultos;
      weight += rowBultos * rowPesoPorBulto;
      unidades += rowBultos * rowUnidadesPorBulto;
      cbm += ((l * w * h) / 1_000_000) * rowBultos;
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
            },
          ];

    let rowsToUse = taskRows;
    if (typeof window !== "undefined") {
      const rawDraft = window.localStorage.getItem(detailedDraftKey(task.id));
      if (rawDraft) {
        try {
          const parsed = JSON.parse(rawDraft) as DetailedDraft;
          if (Array.isArray(parsed.rows) && parsed.rows.length > 0) {
            rowsToUse = parsed.rows;
          }
        } catch {
          // ignore invalid draft
        }
      }
    }

    setMeasureRows(rowsToUse);
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
      },
    ]);
  };

  const deleteRow = (idToRemove: string) => {
    setMeasureRows((prev) =>
      prev.length > 1 ? prev.filter((r) => r.id !== idToRemove) : prev,
    );
  };

  const updateRowValue = (id: string, field: keyof MeasureRow, value: string) => {
    setMeasureRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
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
      bultos += rowBultos;
      weight += rowBultos * rowPesoPorBulto;
      cbm += ((l * w * h) / 1_000_000) * rowBultos;
    });

    const originalExpected = task.originalExpectedBultos ?? task.expectedBultos;
    const isCompleted =
      bultos >= task.expectedBultos && hasDetailedRequiredData(rows);
    const updatedTask: Task = {
      ...task,
      measureData: JSON.parse(JSON.stringify(rows)),
      currentBultos: bultos,
      expectedWeight: weight > 0 ? weight : task.expectedWeight,
      expectedCbm: cbm > 0 ? parseFloat(cbm.toFixed(2)) : task.expectedCbm,
      status: isCompleted ? "completed" : "partial",
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
    const isCompleted =
      bultos >= selectedTask.expectedBultos &&
      hasDetailedRequiredData(measureRows);

    const updatedTask: Task = {
      ...selectedTask,
      measureData: JSON.parse(JSON.stringify(measureRows)),
      currentBultos: bultos,
      expectedWeight: weight > 0 ? weight : selectedTask.expectedWeight,
      expectedCbm: parseFloat(cbm) > 0 ? parseFloat(cbm) : selectedTask.expectedCbm,
      status: isCompleted ? "completed" : "partial",
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
      <div className="w-full h-full flex flex-col animate-fade">
        <div className="max-w-4xl mx-auto w-full flex flex-col h-full">
          <div className="shrink-0 space-y-4 md:space-y-6 mb-4 md:mb-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 px-2 md:px-0">
              <h2 className="text-xl md:text-3xl font-black text-[#16263F] flex items-center gap-2 md:gap-3">
                <ClipboardCheck className="text-[#16263F] w-5 h-5 md:w-8 md:h-8" />{" "}
                INGRESO DETALLADO
              </h2>
              <button
                type="button"
                onClick={openManualModal}
                className="bg-white hover:bg-slate-50 text-[#16263F] border border-slate-200 px-4 py-2 md:px-5 md:py-2.5 rounded-xl font-bold shadow-sm transition cursor-pointer flex items-center justify-center gap-2 active:scale-95 text-[10px] md:text-xs uppercase tracking-widest w-full sm:w-auto"
              >
                <Plus size={16} /> Crear RA Manual
              </button>
            </div>

            <div className="flex flex-wrap bg-slate-200/50 p-1 rounded-xl w-full border border-slate-200 mx-2 md:mx-0">
              <button
                type="button"
                onClick={() => {
                  setViewMode("pending");
                  setClientFilter("Todos");
                }}
                className={`flex-1 min-w-[100px] px-4 py-2 rounded-lg text-[10px] md:text-xs font-black uppercase tracking-widest transition-all ${
                  viewMode === "pending"
                    ? "bg-white shadow-sm text-blue-600"
                    : "text-slate-500 hover:text-slate-700"
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
                        ? "bg-white text-red-600"
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
                    ? "bg-white shadow-sm text-green-600"
                    : "text-slate-500 hover:text-slate-700"
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
                      : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
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
                        : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
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
                <div className="bg-white p-8 md:p-16 rounded-[2rem] border border-slate-200 text-center font-bold text-slate-400">
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
                        : "bg-white border-slate-100"
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
                          className="text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 p-2 rounded-xl transition-colors"
                          title="Transferir a otro módulo"
                        >
                          <ArrowRightLeft size={16} />
                        </button>
                        {transferOpenId === t.id && (
                          <div className="absolute right-0 top-full mt-1 py-1 bg-white rounded-xl border border-slate-200 shadow-lg z-30 min-w-[180px]">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onTransferTask(t, "quick");
                                setTransferOpenId(null);
                              }}
                              className="w-full px-4 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50"
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
                              className="w-full px-4 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50"
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
                        className="text-slate-400 hover:text-blue-600 hover:bg-blue-50 p-2 rounded-xl transition-colors"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteTask(t.id);
                        }}
                        className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-2 rounded-xl transition-colors"
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
                                : "text-[#16263F]"
                            }`}
                          >
                            RA: {t.ra}
                          </h3>
                        {t.status === "partial" && (
                          <span className="px-2 py-1 rounded-md bg-amber-100 text-amber-700 text-[9px] font-black uppercase tracking-widest">
                            Pendiente por terminar
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
                      <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 mt-2">
                        <div>
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">
                            PROVEEDOR
                          </p>
                          <p className="text-xs md:text-sm font-bold text-[#16263F] truncate uppercase">
                            {t.provider}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">
                            MARCA / TRACKING
                          </p>
                          <p className="text-xs md:text-sm font-bold text-[#16263F] truncate uppercase">
                            {t.brand}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="w-full md:w-14 h-12 md:h-14 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 group-hover:bg-slate-100 group-hover:text-[#16263F] transition-all shrink-0 hidden sm:flex">
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
    <div className="w-full h-full flex flex-col animate-fade">
      <div className="max-w-[1600px] mx-auto w-full flex flex-col h-full">
        <div className="shrink-0 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 md:mb-6 px-2 md:px-0">
          <button
            type="button"
            onClick={clearTask}
            className="text-slate-500 bg-white md:bg-transparent px-4 py-2 md:px-0 md:py-0 rounded-lg md:rounded-none shadow-sm md:shadow-none font-bold hover:text-[#16263F] flex items-center gap-2 uppercase text-[10px] tracking-widest"
          >
            <ArrowLeft className="w-4 h-4" />{" "}
            <span className="hidden md:inline">Volver al listado</span>
          </button>
          <div className="flex items-center gap-2">
            <span className="bg-white text-[#16263F] border border-slate-200 px-6 py-3 rounded-xl text-[10px] md:text-sm font-black shadow-sm text-center uppercase tracking-widest flex items-center justify-center gap-2 shrink-0">
              <ClipboardCheck className="w-5 h-5 text-blue-600" /> RA-{t.ra}
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
                      : "bg-slate-50 text-slate-600 border-slate-200"
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

        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-20">
          <div className="bg-white p-4 md:p-8 rounded-2xl md:rounded-[3rem] border border-slate-100 shadow-xl md:shadow-2xl space-y-6 md:space-y-8">
            <div className="bg-[#F8FAFC] border border-slate-100 rounded-[1.5rem] md:rounded-[2rem] p-6 shadow-sm">
              <h4 className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-widest mb-4 border-b border-slate-200 pb-3">
                DATOS ORIGINALES DE CARGA
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6 pb-4 border-b border-slate-200">
                <div className="col-span-2 lg:col-span-2">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                    PROVEEDOR
                  </p>
                  <p className="text-sm font-black text-[#16263F] uppercase truncate">
                    {t.provider}
                  </p>
                </div>
                <div className="col-span-2 lg:col-span-1">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                    MARCA / TRACKING
                  </p>
                  <p className="text-sm font-black text-[#16263F] uppercase truncate">
                    {t.brand}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                    VOLUMEN EST.
                  </p>
                  <p className="text-sm font-black text-slate-700">
                    {t.expectedCbm ?? 0}{" "}
                    <span className="text-xs font-bold text-slate-500">m³</span>
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                    PESO EST.
                  </p>
                  <p className="text-sm font-black text-slate-700">
                    {t.expectedWeight ?? 0}{" "}
                    <span className="text-xs font-bold text-slate-500">kg</span>
                  </p>
                </div>
              </div>
              <div className="pt-4">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  EXPEDIDOR / NOTAS
                </p>
                <p className="text-sm font-medium text-slate-600 italic uppercase">
                  {t.subClient}{" "}
                  {t.notes ? (
                    <>
                      <span className="mx-2 font-light text-slate-300">|</span>{" "}
                      {t.notes}
                    </>
                  ) : (
                    ""
                  )}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 pb-4 border-b border-slate-100">
              <div className="p-4 md:p-6 bg-white rounded-2xl md:rounded-3xl border border-slate-200 flex flex-col justify-center">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5">
                  BULTOS DECLARADOS
                </p>
                <p className="text-3xl md:text-4xl font-black text-[#16263F] leading-none">
                  {originalExpected}
                </p>
              </div>
              <div className="p-4 md:p-6 bg-[#F5F3FF] rounded-2xl md:rounded-3xl border border-[#EDE9FE] flex flex-col justify-center">
                <p className="text-[9px] font-black text-purple-600 uppercase tracking-widest mb-1.5">
                  BULTOS FÍSICOS
                </p>
                <p className="text-3xl md:text-4xl font-black text-purple-700 leading-none">
                  {totals.bultos}
                </p>
              </div>
              <div
                className={`p-4 md:p-6 rounded-2xl md:rounded-3xl border flex flex-col justify-center ${
                  faltantes > 0
                    ? "bg-orange-50 border-orange-200"
                    : faltantes < 0
                      ? "bg-red-50 border-red-200"
                      : "bg-[#F0FDF4] border-green-200"
                }`}
              >
                <p
                  className={`text-[9px] font-black uppercase tracking-widest mb-1.5 ${
                    faltantes > 0
                      ? "text-orange-600"
                      : faltantes < 0
                        ? "text-red-600"
                        : "text-green-600"
                  }`}
                >
                  DIFERENCIA BODEGA
                </p>
                <p
                  className={`text-3xl md:text-4xl font-black leading-none ${
                    faltantes > 0
                      ? "text-orange-600"
                      : faltantes < 0
                        ? "text-red-600"
                        : "text-green-600"
                  }`}
                >
                  {faltantes}
                </p>
              </div>
              <div className="p-4 md:p-6 text-center lg:text-right flex flex-col justify-center">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  RESUMEN ADICIONAL
                </p>
                <p className="text-xl md:text-2xl font-black text-[#16263F] leading-none">
                  {totals.unidades}{" "}
                  <span className="text-xs font-bold text-slate-400">Und</span>
                  <span className="text-slate-300 font-light mx-2">|</span>
                  {Number(totals.cbm).toFixed(2)}{" "}
                  <span className="text-xs font-bold text-slate-400">m³</span>
                  <span className="text-slate-300 font-light mx-2">|</span>
                  {totals.weight.toFixed(2)}{" "}
                  <span className="text-xs font-bold text-slate-400">kg</span>
                </p>
              </div>
            </div>

            <div className="overflow-x-auto w-full custom-scrollbar pb-4">
              <table className="w-full text-sm text-left min-w-[1300px] border-collapse">
                <thead className="bg-white text-slate-500 font-black uppercase text-[10px] tracking-widest border-b border-slate-200">
                  <tr>
                    <th className="px-2 py-4 w-10 text-center">#</th>
                    <th className="px-2 py-4 w-32 text-left">REFERENCIA</th>
                    <th className="px-2 py-4 w-40 text-left">DESCRIPCIÓN</th>
                    <th className="px-2 py-4 w-20 text-center text-purple-600 bg-purple-50 rounded-tl-lg border-b border-purple-100">
                      BULTOS
                    </th>
                    <th className="px-2 py-4 w-24 text-center">UND/BULTO</th>
                    <th className="px-2 py-4 w-20 text-center bg-slate-50">
                      TOT UND
                    </th>
                    <th className="px-2 py-4 w-24 text-center">PESO/B (KG)</th>
                    <th className="px-2 py-4 w-20 text-center bg-slate-50">
                      PESO TOT
                    </th>
                    <th className="px-2 py-4 w-20 text-center">L (CM)</th>
                    <th className="px-2 py-4 w-20 text-center">W (CM)</th>
                    <th className="px-2 py-4 w-20 text-center">H (CM)</th>
                    <th className="px-2 py-4 w-24 text-center bg-slate-50">
                      CBM/BULTO
                    </th>
                    <th className="px-2 py-4 bg-blue-50 text-blue-700 text-center font-black rounded-tr-lg border-b border-blue-100 w-28">
                      CUBICAJE TOT
                    </th>
                    <th className="px-2 py-4 w-12 text-center" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
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
                    const cbmPorBulto = (l * w * h) / 1_000_000;
                    const cubicajeTotal = cbmPorBulto * bultos;

                    return (
                      <tr
                        key={row.id}
                        className="group hover:bg-slate-50 transition-colors"
                      >
                        <td className="p-2 text-center font-black text-slate-300 text-sm">
                          {idx + 1}
                        </td>

                        <td className="p-2">
                          <input
                            type="text"
                            onChange={(e) =>
                              updateRowValue(row.id, "referencia", e.target.value)
                            }
                            value={row.referencia || ""}
                            className="w-full bg-white border border-slate-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-lg py-2 px-2 text-left font-bold text-[#16263F] text-xs outline-none transition-all"
                            placeholder="Ref..."
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            onChange={(e) =>
                              updateRowValue(row.id, "descripcion", e.target.value)
                            }
                            value={row.descripcion || ""}
                            className="w-full bg-white border border-slate-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-lg py-2 px-2 text-left font-medium text-slate-600 text-xs outline-none transition-all"
                            placeholder="Desc..."
                          />
                        </td>

                        <td className="p-2 bg-purple-50/50">
                          <input
                            type="number"
                            onChange={(e) =>
                              updateRowValue(row.id, "bultos", e.target.value)
                            }
                            value={row.bultos ?? ""}
                            className="no-spinners w-full bg-white border border-purple-200 focus:border-purple-400 rounded-lg py-2 text-center font-black text-purple-700 text-sm outline-none transition-all"
                            placeholder="0"
                          />
                        </td>

                        <td className="p-2">
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
                            className="no-spinners w-full bg-white border border-slate-200 focus:border-slate-400 rounded-lg py-2 text-center font-bold text-[#16263F] text-sm outline-none transition-all"
                            placeholder="0"
                          />
                        </td>

                        <td className="p-2 text-center font-black text-[#16263F] text-sm bg-slate-50">
                          {totalUnidades}
                        </td>

                        <td className="p-2">
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
                            className="no-spinners w-full bg-white border border-slate-200 focus:border-slate-400 rounded-lg py-2 text-center font-bold text-[#16263F] text-sm outline-none transition-all"
                            placeholder="0.0"
                          />
                        </td>

                        <td className="p-2 text-center font-black text-[#16263F] text-sm bg-slate-50">
                          {pesoTotal.toFixed(2)}
                        </td>

                        <td className="p-2">
                          <input
                            type="number"
                            onChange={(e) =>
                              updateRowValue(row.id, "l", e.target.value)
                            }
                            value={row.l ?? ""}
                            className="no-spinners w-full bg-white border border-slate-200 focus:border-slate-400 rounded-lg py-2 text-center font-bold text-[#16263F] text-sm outline-none transition-all"
                            placeholder="0"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            onChange={(e) =>
                              updateRowValue(row.id, "w", e.target.value)
                            }
                            value={row.w ?? ""}
                            className="no-spinners w-full bg-white border border-slate-200 focus:border-slate-400 rounded-lg py-2 text-center font-bold text-[#16263F] text-sm outline-none transition-all"
                            placeholder="0"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            onChange={(e) =>
                              updateRowValue(row.id, "h", e.target.value)
                            }
                            value={row.h ?? ""}
                            className="no-spinners w-full bg-white border border-slate-200 focus:border-slate-400 rounded-lg py-2 text-center font-bold text-[#16263F] text-sm outline-none transition-all"
                            placeholder="0"
                          />
                        </td>

                        <td className="p-2 text-center font-bold text-slate-500 text-xs bg-slate-50">
                          {cbmPorBulto.toFixed(2)}
                        </td>

                        <td className="p-2 text-center font-black text-blue-700 text-sm bg-blue-50/50">
                          {cubicajeTotal.toFixed(2)}
                        </td>

                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => deleteRow(row.id)}
                            className="w-8 h-8 rounded-lg bg-red-50 text-red-400 hover:bg-red-500 hover:text-white transition-all shadow-sm mx-auto flex items-center justify-center"
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

            <div className="flex flex-col md:flex-row gap-4 pt-6">
              <button
                type="button"
                onClick={addRow}
                className="flex-1 py-4 md:py-5 bg-white rounded-full border-2 border-dashed border-slate-300 text-slate-500 font-black hover:bg-slate-50 hover:border-slate-400 hover:text-slate-600 transition-all flex items-center justify-center gap-2 text-sm uppercase tracking-widest"
              >
                <Plus className="w-5 h-5" /> AGREGAR LÍNEA ADICIONAL
              </button>
              <button
                type="button"
                onClick={saveOrder}
                className="flex-1 py-4 md:py-5 bg-[#0f172a] text-white font-black rounded-full shadow-lg hover:bg-black transition-all active:scale-95 text-sm uppercase tracking-widest flex justify-center items-center gap-2"
              >
                GUARDAR ORDEN DETALLADA <Box className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

