"use client";

import React, { useEffect, useState } from "react";
import "./reports-print.css";
import { downloadReportExcel } from "@/lib/exportReportExcel";
import { downloadReportPdfFromExcel } from "@/lib/exportReportPdfFromExcel";
import { openReportPrintWindow } from "@/lib/buildReportPrintHtml";
import type { Task as TaskModel } from "@/lib/types/task";
import { ReportPdfExportLayout } from "./ReportPdfExportLayout";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  Eye,
  FileText,
  FileSpreadsheet,
  Loader2,
  Printer,
  Search,
  Trash2,
} from "lucide-react";

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
  measureData: any[];
  weightMode: string;
  manualTotalWeight: number;
  type?: "quick" | "detailed" | "airway";
};

type CompletedReportsModuleProps = {
  tasks: Task[];
  /** Elimina un reporte/RA (abre el modal de confirmación global). */
  onDeleteTask?: (id: string) => void;
};

export function CompletedReportsModule({
  tasks,
  onDeleteTask,
}: CompletedReportsModuleProps) {
  const completedTasks = tasks.filter(
    (t) => t.status === "completed" || t.status === "partial",
  );

  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);
  const [isViewingReports, setIsViewingReports] = useState(false);
  const [singleViewTask, setSingleViewTask] = useState<Task | null>(null);

  const [clientFilter, setClientFilter] = useState("Todos");
  const [typeFilter, setTypeFilter] = useState<"Todos" | "quick" | "detailed">(
    "Todos",
  );
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [isDownloadingExcel, setIsDownloadingExcel] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  let tasksToPrint: Task[] = [];
  if (singleViewTask) {
    tasksToPrint = [singleViewTask];
  } else if (isViewingReports && selectedReportIds.length > 0) {
    tasksToPrint = completedTasks.filter((t) =>
      selectedReportIds.includes(t.id),
    );
  }

  const reportViewId = singleViewTask
    ? singleViewTask.id
    : isViewingReports && selectedReportIds.length > 0
      ? [...selectedReportIds].sort().join("|")
      : "";

  const titleRa =
    singleViewTask?.ra ??
    (isViewingReports && selectedReportIds.length > 0
      ? completedTasks.find((t) => selectedReportIds.includes(t.id))?.ra
      : undefined) ??
    "";

  useEffect(() => {
    if (!reportViewId) return;
    const prev = document.title;
    document.title = `Reporte RA-${titleRa} | Aldepositos`;
    return () => {
      document.title = prev;
    };
  }, [reportViewId, titleRa]);

  useEffect(() => {
    if (!reportViewId) setExportError(null);
  }, [reportViewId]);

  const handleDownloadPdf = async () => {
    if (tasksToPrint.length === 0) return;
    setExportError(null);
    setIsDownloadingPdf(true);
    try {
      await downloadReportPdfFromExcel({
        tasks: tasksToPrint as TaskModel[],
      });
    } catch (e) {
      console.error("[Reports PDF] Fallo al generar PDF:", e);
      setExportError(
        e instanceof Error ? e.message : "Error al generar el PDF.",
      );
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const handleDownloadExcel = async (tasks: Task[]) => {
    if (tasks.length === 0) return;
    setExportError(null);
    setIsDownloadingExcel(true);
    try {
      await downloadReportExcel({
        tasks: tasks as TaskModel[],
      });
    } catch (e) {
      console.error("[Reports Excel] Fallo al generar Excel:", e);
      setExportError(
        e instanceof Error ? e.message : "Error al generar el Excel.",
      );
    } finally {
      setIsDownloadingExcel(false);
    }
  };

  const handlePrintReport = () => {
    if (tasksToPrint.length === 0) return;
    const currentDate = new Date().toLocaleDateString("es-PA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    openReportPrintWindow(tasksToPrint as TaskModel[], currentDate);
  };

  const clients = [
    ...new Set(completedTasks.map((t) => t.mainClient || "Sin Cliente")),
  ];

  let displayedTasks = completedTasks;
  if (clientFilter !== "Todos") {
    displayedTasks = displayedTasks.filter(
      (t) => (t.mainClient || "Sin Cliente") === clientFilter,
    );
  }
  if (typeFilter !== "Todos") {
    displayedTasks = displayedTasks.filter((t) =>
      typeFilter === "quick"
        ? t.type === "quick" || t.type === "airway" || !t.type
        : t.type === typeFilter,
    );
  }

  const toggleSelection = (id: string) => {
    setSelectedReportIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  };

  const isAllSelected =
    displayedTasks.length > 0 && selectedReportIds.length === displayedTasks.length;

  const handleSelectAll = () => {
    if (isAllSelected) {
      setSelectedReportIds([]);
    } else {
      setSelectedReportIds(displayedTasks.map((t) => t.id));
    }
  };

  if (tasksToPrint.length > 0) {
    const currentDate = new Date().toLocaleDateString("es-PA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    return (
      <div className="relative flex h-full w-full animate-fade flex-col bg-[var(--panel-bg-subtle)]">
        <div className="reports-print-toolbar panel-card sticky top-0 z-50 flex shrink-0 items-center justify-between border-b-0 p-4 md:px-8">
          <button
            type="button"
            onClick={() => {
              singleViewTask ? setSingleViewTask(null) : setIsViewingReports(false);
            }}
            className="flex items-center gap-2 rounded-lg bg-[var(--panel-surface-muted)] px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-600 transition-colors hover:text-[var(--panel-heading)] dark:text-slate-300"
          >
            <ArrowLeft className="w-4 h-4" /> Volver
          </button>
          <div className="flex flex-wrap justify-end gap-2 sm:gap-3">
            <button
              type="button"
              disabled={isDownloadingExcel}
              onClick={() => void handleDownloadExcel(tasksToPrint)}
              className="bg-emerald-600 text-white px-4 md:px-6 py-2.5 rounded-lg font-black shadow-md hover:bg-emerald-700 transition-colors flex items-center gap-2 uppercase text-[10px] md:text-xs tracking-widest disabled:opacity-70"
            >
              {isDownloadingExcel ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-4 h-4" />
              )}
              Descargar Excel
            </button>
            <button
              type="button"
              onClick={handlePrintReport}
              className="bg-[#16263F] text-white px-4 md:px-6 py-2.5 rounded-lg font-black shadow-md hover:bg-[#0f1b2e] transition-colors flex items-center gap-2 uppercase text-[10px] md:text-xs tracking-widest dark:bg-blue-600 dark:hover:bg-blue-500"
              title="En el diálogo de impresión: Más opciones → desactivá Encabezados y pies de página"
            >
              <Printer className="w-4 h-4" />
              Imprimir
            </button>
            <button
              type="button"
              disabled={isDownloadingPdf}
              onClick={handleDownloadPdf}
              className="bg-slate-700 text-white px-4 md:px-6 py-2.5 rounded-lg font-black shadow-md hover:bg-slate-800 transition-colors flex items-center gap-2 uppercase text-[10px] md:text-xs tracking-widest disabled:opacity-70"
            >
              {isDownloadingPdf ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              Descargar PDF
            </button>
          </div>
        </div>

        {exportError && (
          <div
            role="status"
            className="shrink-0 border-b border-red-100 bg-red-50 px-4 py-2 text-[11px] font-bold text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300 md:px-8"
          >
            {exportError}
          </div>
        )}

        <div
          id="reports-print-root"
          className="custom-scrollbar flex flex-1 flex-col items-center gap-8 overflow-y-auto bg-[var(--panel-bg)] p-4 md:p-8"
        >
          {tasksToPrint.map((t) => (
            <div
              key={t.id}
              className="report-preview-frame print-container w-full max-w-[8.5in]"
            >
              <ReportPdfExportLayout
                task={t as TaskModel}
                currentDate={currentDate}
                compact={false}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col animate-fade relative">
      <div className="max-w-4xl mx-auto w-full flex flex-col h-full">
        {exportError && (
          <div
            role="status"
            className="mx-2 mb-3 shrink-0 rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-[11px] font-bold text-red-700 dark:border-red-900/40 dark:bg-red-950/35 dark:text-red-300 md:mx-0"
          >
            {exportError}
          </div>
        )}
        <div className="shrink-0 space-y-4 md:space-y-6 mb-4 md:mb-6 px-2 md:px-0">
          <h2 className="flex items-center gap-2 text-xl font-black text-[#16263F] dark:text-slate-100 md:gap-3 md:text-3xl">
            <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400 md:h-8 md:w-8" />{" "}
            REPORTES
          </h2>

          <div className="panel-card flex flex-col items-center justify-between gap-4 rounded-[1.5rem] p-4 md:flex-row">
            <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
              {clients.length > 0 && (
                <div className="flex flex-col">
                  <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1 ml-1">
                    Filtrar por Cliente
                  </label>
                  <div className="relative">
                    <select
                      value={clientFilter}
                      onChange={(e) => setClientFilter(e.target.value)}
                      className="panel-input w-full cursor-pointer appearance-none rounded-xl py-2.5 pl-4 pr-10 text-xs font-bold uppercase sm:w-48"
                    >
                      <option value="Todos">TODOS LOS CLIENTES</option>
                      {clients.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                  </div>
                </div>
              )}

              <div className="flex flex-col">
                <label className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1 ml-1">
                  Tipo de Ingreso
                </label>
                <div className="relative">
                  <select
                    value={typeFilter}
                    onChange={(e) =>
                      setTypeFilter(e.target.value as typeof typeFilter)
                    }
                    className="panel-input w-full cursor-pointer appearance-none rounded-xl py-2.5 pl-4 pr-10 text-xs font-bold uppercase sm:w-48"
                  >
                    <option value="Todos">TODOS LOS MÓDULOS</option>
                    <option value="quick">Ingreso Rápido</option>
                    <option value="detailed">Ingreso Detallado</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                </div>
              </div>
            </div>

            {displayedTasks.length > 0 && (
              <button
                type="button"
                onClick={handleSelectAll}
                className="w-full shrink-0 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800/60 dark:bg-blue-950/55 dark:text-blue-200 dark:hover:bg-blue-900/45 md:w-auto"
              >
                {isAllSelected ? "Desmarcar Resultados" : "Seleccionar Resultados"}
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-24">
          <div className="grid grid-cols-1 gap-3 md:gap-4 px-2 md:px-0">
            {displayedTasks.length === 0 ? (
              <div className="panel-card flex flex-col items-center rounded-[2rem] p-8 text-center font-bold text-slate-400 dark:text-slate-500 md:p-16">
                <Search className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
                No se encontraron reportes finalizados con estos filtros.
              </div>
            ) : (
              displayedTasks.map((t) => {
                const isSelected = selectedReportIds.includes(t.id);
                const moduleName =
                  t.type === "quick"
                    ? "RÁPIDO"
                    : t.type === "detailed"
                      ? "DETALLADO"
                      : "AÉREA";

                return (
                  <div
                    key={t.id}
                    className={`panel-card group flex cursor-pointer items-center rounded-[1.5rem] p-4 transition-all md:p-6 ${
                      isSelected
                        ? "border-blue-500 bg-blue-50 shadow-md ring-2 ring-blue-500/20 dark:border-blue-500/70 dark:bg-blue-950/50"
                        : "hover:border-blue-300 dark:hover:border-blue-700/60"
                    }`}
                    onClick={() => setSingleViewTask(t)}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelection(t.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleSelection(t.id);
                        }
                      }}
                      className={`w-6 h-6 rounded border flex items-center justify-center shrink-0 mr-4 md:mr-6 transition-colors hover:scale-110 ${
                        isSelected
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "border-slate-300 bg-[var(--panel-surface)] dark:border-slate-600"
                      }`}
                    >
                      {isSelected && <Check size={16} strokeWidth={4} />}
                    </div>

                    <div className="flex flex-col md:flex-row md:items-center justify-between flex-1 gap-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                              t.status === "partial"
                                ? "bg-orange-100 text-orange-700 dark:bg-orange-950/55 dark:text-orange-300"
                                : "bg-green-100 text-green-700 dark:bg-emerald-950/55 dark:text-emerald-300"
                            }`}
                          >
                            {t.status === "partial" ? "Parcial" : "Completado"}
                          </span>
                          <span
                            className={`rounded-md px-2 py-0.5 text-[9px] font-black uppercase leading-normal tracking-wide ${
                              t.type === "detailed"
                                ? "bg-purple-100 text-purple-700 dark:bg-purple-950/55 dark:text-purple-300"
                                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                            }`}
                          >
                            {moduleName}
                          </span>
                          <span className="mx-1 text-slate-300 dark:text-slate-600">|</span>
                          <p className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest truncate max-w-[120px]">
                            {t.mainClient}
                          </p>
                        </div>
                        <h3 className="text-xl font-black leading-tight text-[#16263F] transition-colors group-hover:text-blue-600 dark:text-slate-100 dark:group-hover:text-blue-400 md:text-2xl">
                          RA: {t.ra}
                        </h3>
                        <p className="text-[10px] md:text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">
                          {t.provider}
                          {t.brand ? ` — ${t.brand}` : ""}
                        </p>
                      </div>
                      <div className="text-left md:text-right flex items-center gap-2 md:gap-4 justify-end mt-2 md:mt-0">
                        <button
                          type="button"
                          title="Descargar Excel"
                          disabled={isDownloadingExcel}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDownloadExcel([t]);
                          }}
                          className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-600 transition-colors hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-800/60 dark:bg-emerald-950/45 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                        >
                          {isDownloadingExcel ? (
                            <Loader2 size={18} className="animate-spin" />
                          ) : (
                            <FileSpreadsheet size={18} />
                          )}
                        </button>
                        {onDeleteTask && (
                          <button
                            type="button"
                            title="Eliminar reporte"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteTask(t.id);
                            }}
                            className="flex h-10 w-10 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-500 transition-colors hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-900/50"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                        <div className="text-right">
                          <p className="text-sm md:text-lg font-black text-[#16263F] dark:text-slate-100 leading-none">
                            {t.currentBultos} BULTOS
                          </p>
                        </div>
                        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-[var(--panel-surface-muted)] text-slate-400 transition-colors group-hover:bg-blue-100 group-hover:text-blue-600 dark:border-slate-600 dark:text-slate-400 dark:group-hover:bg-blue-950/50 dark:group-hover:text-blue-300">
                          <Eye size={18} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {selectedReportIds.length > 0 && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#16263F] text-white px-6 py-4 rounded-[1.5rem] shadow-2xl flex items-center gap-6 no-print z-50 animate-fade">
            <span className="font-black text-xs uppercase tracking-widest">
              {selectedReportIds.length} Seleccionados
            </span>
            <div className="h-6 w-[1px] bg-slate-600" />
            <button
              type="button"
              onClick={() => void handleDownloadExcel(
                completedTasks.filter((t) => selectedReportIds.includes(t.id)),
              )}
              disabled={isDownloadingExcel}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-colors shadow-lg shadow-emerald-500/30 disabled:opacity-70"
            >
              {isDownloadingExcel ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <FileSpreadsheet size={16} />
              )}{" "}
              Excel
            </button>
            <button
              type="button"
              onClick={() => setIsViewingReports(true)}
              className="flex items-center gap-2 bg-blue-500 hover:bg-blue-400 px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-colors shadow-lg shadow-blue-500/30"
            >
              <Printer size={16} /> Generar PDF
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
