"use client";

import React, { useEffect, useRef, useState } from "react";
import "./reports-print.css";
import {
  buildReportPdfFilename,
  exportReportPdfFromExportRoot,
  PDF_EXPORT_WIDTH_PX,
  waitForReportDomReady,
} from "./reportsPdfExport";
import type { Task as TaskModel } from "@/lib/types/task";
import { ReportPdfExportLayout } from "./ReportPdfExportLayout";
import { BrandLogoMark } from "@/components/brand/BrandLogoMark";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  Eye,
  FileText,
  Loader2,
  Printer,
  Search,
  Zap,
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
  onDeleteTask: (id: string) => void;
  onUpdateTask: (task: Task) => void;
  onAddTasks: (tasks: Task[]) => void;
};

export function CompletedReportsModule({
  tasks,
  onDeleteTask,
  onUpdateTask,
  onAddTasks,
}: CompletedReportsModuleProps) {
  const completedTasks = tasks.filter(
    (t) => t.status === "completed" || t.status === "partial",
  );

  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);
  const [isViewingReports, setIsViewingReports] = useState(false);
  const [singleViewTask, setSingleViewTask] = useState<Task | null>(null);
  const [splitTaskConfig, setSplitTaskConfig] = useState<Task | null>(null);

  const [clientFilter, setClientFilter] = useState("Todos");
  const [typeFilter, setTypeFilter] = useState<
    "Todos" | "quick" | "detailed" | "airway"
  >("Todos");
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [pdfExportError, setPdfExportError] = useState<string | null>(null);
  /** Solo el árbol de exportación PDF (off-screen), no la vista en pantalla */
  const pdfExportLayoutRef = useRef<HTMLDivElement>(null);

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
    if (!reportViewId) setPdfExportError(null);
  }, [reportViewId]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPdf = async () => {
    if (tasksToPrint.length === 0) return;
    setPdfExportError(null);
    setIsDownloadingPdf(true);
    try {
      const root = pdfExportLayoutRef.current;
      if (!root) {
        const err = new Error("[Reports PDF] pdfExportLayoutRef no montado.");
        console.error(err);
        setPdfExportError("No se pudo acceder al contenedor de exportación PDF.");
        return;
      }

      await waitForReportDomReady();
      const filename = buildReportPdfFilename(tasksToPrint);
      await exportReportPdfFromExportRoot(root, filename);
    } catch (e) {
      console.error("[Reports PDF] Fallo al generar PDF:", e);
      setPdfExportError(
        e instanceof Error ? e.message : "Error al generar el PDF.",
      );
    } finally {
      setIsDownloadingPdf(false);
    }
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
    displayedTasks = displayedTasks.filter((t) => t.type === typeFilter);
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
      <div className="w-full h-full flex flex-col animate-fade bg-slate-100/50 relative">
        {/* Vista exclusiva para PDF: fuera de pantalla, estilos inline (no captura la UI de pantalla) */}
        <div
          aria-hidden
          style={{
            position: "fixed",
            left: "-14000px",
            top: 0,
            zIndex: -1,
            pointerEvents: "none",
            width: `${PDF_EXPORT_WIDTH_PX}px`,
            overflow: "visible",
          }}
        >
          <div
            ref={pdfExportLayoutRef}
            id="report-pdf-export-root"
            style={{
              width: `${PDF_EXPORT_WIDTH_PX}px`,
              backgroundColor: "#ffffff",
              boxSizing: "border-box",
            }}
          >
            {tasksToPrint.map((t) => (
              <ReportPdfExportLayout
                key={`pdf-export-${t.id}`}
                task={t as TaskModel}
                currentDate={currentDate}
                compact={tasksToPrint.length > 1}
              />
            ))}
          </div>
        </div>

        <div className="reports-print-toolbar shrink-0 flex justify-between items-center p-4 md:px-8 border-b border-slate-200 bg-white shadow-sm z-50 sticky top-0">
          <button
            type="button"
            onClick={() => {
              singleViewTask ? setSingleViewTask(null) : setIsViewingReports(false);
            }}
            className="text-slate-500 hover:text-[#16263F] font-bold flex items-center gap-2 uppercase text-[10px] tracking-widest px-4 py-2 bg-slate-50 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Volver
          </button>
          <div className="flex gap-3">
            {singleViewTask && (
              <button
                type="button"
                onClick={() => setSplitTaskConfig(singleViewTask)}
                className="bg-orange-500 text-white px-4 md:px-6 py-2.5 rounded-lg font-black shadow-md hover:bg-orange-600 transition-colors flex items-center gap-2 uppercase text-[10px] md:text-xs tracking-widest"
              >
                <Zap className="w-4 h-4" /> Parcializar Orden
              </button>
            )}
            <button
              type="button"
              onClick={handlePrint}
              title="En el diálogo de impresión desactiva «Encabezados y pies de página» para ocultar fecha y URL."
              className="bg-blue-600 text-white px-4 md:px-6 py-2.5 rounded-lg font-black shadow-md hover:bg-blue-700 transition-colors flex items-center gap-2 uppercase text-[10px] md:text-xs tracking-widest"
            >
              <Printer className="w-4 h-4" /> Imprimir{" "}
              {tasksToPrint.length > 1 ? `(${tasksToPrint.length})` : ""}
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

        {pdfExportError && (
          <div
            role="status"
            className="shrink-0 px-4 md:px-8 py-2 bg-red-50 border-b border-red-100 text-red-700 text-[11px] font-bold"
          >
            {pdfExportError}
          </div>
        )}

        <div
          id="reports-print-root"
          className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-8 flex flex-col items-center gap-8"
        >
          {tasksToPrint.map((t, index) => {
            const measureRows = (t.measureData || []) as any[];
            const isDetailed = t.type === "detailed";
            const showWeightColumn = t.weightMode === "per_bundle" || isDetailed;
            const showReferenceColumn =
              t.weightMode === "by_reference" || isDetailed;

            let totalWeight = t.expectedWeight || 0;
            let totalUnidades = 0;

            if (isDetailed) {
              totalWeight = measureRows.reduce(
                (acc, row) =>
                  acc +
                  (parseFloat(String(row.pesoPorBulto ?? 0)) || 0) *
                    (parseFloat(String(row.bultos ?? 0)) || 0),
                0,
              );
              totalUnidades = measureRows.reduce(
                (acc, row) =>
                  acc +
                  (parseFloat(String(row.unidadesPorBulto ?? 0)) || 0) *
                    (parseFloat(String(row.bultos ?? 0)) || 0),
                0,
              );
            } else if (t.weightMode === "per_bundle") {
              const calcWeight = measureRows.reduce(
                (acc, row) =>
                  acc +
                  (parseFloat(String(row.weight ?? 0)) || 0) *
                    (parseFloat(String(row.bultos ?? 0)) || 0),
                0,
              );
              if (calcWeight > 0) totalWeight = calcWeight;
            }

            const totals = {
              bultos: measureRows.reduce(
                (a, b) => a + (parseFloat(String(b.bultos ?? 0)) || 0),
                0,
              ),
              cbm: measureRows
                .reduce((acc, row) => {
                  const l = parseFloat(String(row.l ?? 0)) || 0;
                  const w = parseFloat(String(row.w ?? 0)) || 0;
                  const h = parseFloat(String(row.h ?? 0)) || 0;
                  const b = parseFloat(String(row.bultos ?? 0)) || 0;
                  return acc + ((l * w * h) / 1_000_000) * b;
                }, 0)
                .toFixed(2),
              weight: totalWeight,
              unidades: totalUnidades,
            };

            return (
              <div
                key={t.id}
                data-report-sheet
                className={`print-container report-document-sheet relative w-full max-w-[8.5in] min-h-[11in] bg-white shadow-xl ring-1 ring-slate-200/80 rounded-sm max-md:rounded-lg flex flex-col ${
                  index < tasksToPrint.length - 1
                    ? "break-after-page print-page-break"
                    : ""
                }`}
              >
                <div className="report-letter-inner p-6 md:p-10 lg:p-11 flex flex-col flex-1 min-h-0 box-border">
                <div className="border-b-4 border-[#16263F] pb-6 mb-6 flex flex-col sm:flex-row sm:justify-between sm:items-stretch gap-5">
                  <div className="flex items-center gap-4 md:gap-5 min-w-0">
                    <BrandLogoMark variant="reportHeader" />
                    <div className="min-w-0">
                      <h1 className="text-2xl md:text-[28px] font-black text-[#16263F] tracking-tight leading-none">
                        ALDEPOSITOS
                      </h1>
                      <p className="text-[10px] md:text-[11px] font-bold text-slate-500 uppercase tracking-[0.2em] mt-2">
                        Servicios logísticos integrales
                      </p>
                    </div>
                  </div>
                  <div className="text-left sm:text-right border-l-4 border-blue-600 pl-4 sm:min-w-[11rem] flex flex-col justify-center">
                    <h2 className="text-sm md:text-base font-black text-slate-800 uppercase tracking-wide leading-snug">
                      Reporte de ingreso
                      <br />
                      {isDetailed ? "detallado" : "rápido"}
                    </h2>
                    <p className="text-[11px] font-bold text-slate-500 mt-2 tabular-nums">
                      Fecha: {currentDate}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 md:gap-4 mb-7">
                  <div className="bg-slate-100/90 p-4 md:p-5 rounded-md border border-slate-200 flex flex-col justify-between">
                    <div>
                      <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.14em] mb-1.5">
                        CLIENTE / CONSIGNATARIO
                      </p>
                      <p className="text-sm md:text-[15px] font-black text-[#16263F] uppercase leading-tight">
                        {t.mainClient}
                      </p>
                    </div>
                    <div className="mt-3 md:mt-4 pt-3 md:pt-0">
                      <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.14em] mb-1.5">
                        EXPEDIDOR
                      </p>
                      <p className="text-xs font-bold text-slate-800 uppercase">
                        {t.subClient}
                      </p>
                    </div>
                  </div>
                  <div className="bg-slate-100/90 p-4 md:p-5 rounded-md border border-slate-200">
                    <div className="pb-3 mb-3">
                      <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.14em] mb-1.5">
                        NÚMERO DE RECEPCIÓN (RA)
                      </p>
                      <p className="text-xl md:text-[26px] font-black text-[#16263F] uppercase tracking-tight">
                        RA-{t.ra}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200">
                      <div className="min-w-0">
                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.12em] mb-1">
                          PROVEEDOR
                        </p>
                        <p className="text-[10px] font-bold text-slate-800 uppercase leading-snug break-words">
                          {t.provider}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.12em] mb-1">
                          MARCA / TRACKING
                        </p>
                        <p className="text-[10px] font-bold text-slate-800 uppercase leading-snug break-words">
                          {t.brand}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <h3 className="text-[11px] font-black text-[#16263F] uppercase tracking-[0.18em] mb-2.5 pl-3 border-l-4 border-blue-600">
                  Resumen físico consolidado
                </h3>

                <div className="flex border border-slate-200 rounded-md overflow-hidden mb-7 shadow-sm">
                  <div className="flex-1 p-3 md:p-4 bg-white text-center border-r border-slate-200">
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.1em] mb-1">
                      Bultos físicos
                    </p>
                    <p className="text-2xl md:text-[26px] font-black text-[#16263F] tabular-nums">
                      {totals.bultos}
                    </p>
                  </div>
                  {isDetailed && (
                    <div className="flex-1 p-3 md:p-4 bg-purple-50/80 text-center border-r border-slate-200">
                      <p className="text-[9px] font-black text-violet-700 uppercase tracking-[0.1em] mb-1">
                        Total unidades
                      </p>
                      <p className="text-2xl md:text-[26px] font-black text-violet-800 tabular-nums">
                        {totals.unidades}
                      </p>
                    </div>
                  )}
                  <div className="flex-1 p-3 md:p-4 bg-slate-100/90 text-center border-r border-slate-200">
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.1em] mb-1">
                      Volumen total (CBM)
                    </p>
                    <p className="text-2xl md:text-[26px] font-black text-[#16263F] tabular-nums">
                      {totals.cbm} <span className="text-sm">m³</span>
                    </p>
                  </div>
                  <div className="flex-1 p-3 md:p-4 bg-white text-center">
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-[0.1em] mb-1">
                      Peso total
                    </p>
                    <p className="text-2xl md:text-[26px] font-black text-[#16263F] tabular-nums">
                      {totals.weight.toFixed(2)}{" "}
                      <span className="text-sm">kg</span>
                    </p>
                  </div>
                </div>

                <h3 className="text-[11px] font-black text-[#16263F] uppercase tracking-[0.18em] mb-2.5 mt-6 pl-3 border-l-4 border-blue-600">
                  Detalle de dimensiones
                </h3>

                {isDetailed ? (
                  <table
                    className="w-full text-left mb-7 border-collapse border border-slate-200"
                    style={{ fontSize: "9px" }}
                  >
                    <thead>
                      <tr className="text-white font-bold uppercase tracking-wider text-[8px]">
                        <th className="px-2 py-3 border border-white/20 text-center w-[3%] bg-[#16263F]">
                          #
                        </th>
                        <th className="px-2 py-3 border border-white/20 text-left w-[12%] bg-[#16263F]">
                          REFERENCIA
                        </th>
                        <th className="px-2 py-3 border border-white/20 text-left w-[18%] bg-[#16263F]">
                          DESCRIPCIÓN
                        </th>
                        <th className="px-2 py-3 border border-white/20 text-center w-[6%] bg-[#16263F]">
                          BULTOS
                        </th>
                        <th className="px-2 py-3 border border-white/20 text-center w-[6%] bg-[#16263F]">
                          UND/B
                        </th>
                        <th className="px-2 py-3 border border-white/20 text-center w-[7%] bg-[#16263F]">
                          TOT UND
                        </th>
                        <th className="px-2 py-3 border border-white/20 text-center w-[7%] bg-[#16263F]">
                          PESO/B
                        </th>
                        <th className="px-2 py-3 border border-white/20 text-center w-[8%] bg-[#16263F]">
                          PESO TOT
                        </th>
                        <th className="px-2 py-3 border border-white/20 text-center w-[5%] bg-[#16263F]">
                          L
                        </th>
                        <th className="px-2 py-3 border border-white/20 text-center w-[5%] bg-[#16263F]">
                          W
                        </th>
                        <th className="px-2 py-3 border border-white/20 text-center w-[5%] bg-[#16263F]">
                          H
                        </th>
                        <th className="px-2 py-3 border border-white/20 text-center w-[8%] bg-[#16263F]">
                          CBM/B
                        </th>
                        <th className="px-2 py-3 border border-white/25 text-center w-[10%] bg-blue-600">
                          TOT CBM
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {measureRows.map((row, idx) => {
                        const bultos =
                          parseFloat(String(row.bultos ?? 0)) || 0;
                        const undPerBulto =
                          parseFloat(String(row.unidadesPorBulto ?? 0)) || 0;
                        const pesoPorBulto =
                          parseFloat(String(row.pesoPorBulto ?? 0)) || 0;
                        const l = parseFloat(String(row.l ?? 0)) || 0;
                        const w = parseFloat(String(row.w ?? 0)) || 0;
                        const h = parseFloat(String(row.h ?? 0)) || 0;

                        const totalUnidades = bultos * undPerBulto;
                        const pesoTotal = bultos * pesoPorBulto;
                        const cbmPorBulto = (l * w * h) / 1_000_000;
                        const cubicajeTotal = cbmPorBulto * bultos;

                        return (
                          <tr
                            key={idx}
                            className="even:bg-slate-100/70 text-slate-800 font-medium"
                          >
                            <td className="px-2 py-2.5 border border-slate-200 text-center font-bold">
                              {idx + 1}
                            </td>
                            <td className="px-2 py-2.5 border border-slate-200 uppercase break-words whitespace-normal">
                              {row.referencia || "-"}
                            </td>
                            <td className="px-2 py-2.5 border border-slate-200 uppercase break-words whitespace-normal">
                              {row.descripcion || "-"}
                            </td>
                            <td className="px-2 py-2.5 border border-slate-200 text-center font-bold bg-violet-50/80 text-violet-900">
                              {bultos}
                            </td>
                            <td className="px-2 py-2.5 border border-slate-200 text-center">
                              {undPerBulto}
                            </td>
                            <td className="px-2 py-2.5 border border-slate-200 text-center font-bold">
                              {totalUnidades}
                            </td>
                            <td className="px-2 py-2.5 border border-slate-200 text-center">
                              {pesoPorBulto.toFixed(2)}
                            </td>
                            <td className="px-2 py-2.5 border border-slate-200 text-center font-bold">
                              {pesoTotal.toFixed(2)}
                            </td>
                            <td className="px-2 py-2.5 border border-slate-200 text-center text-slate-500">
                              {l}
                            </td>
                            <td className="px-2 py-2.5 border border-slate-200 text-center text-slate-500">
                              {w}
                            </td>
                            <td className="px-2 py-2.5 border border-slate-200 text-center text-slate-500">
                              {h}
                            </td>
                            <td className="px-2 py-2.5 border border-slate-200 text-center text-slate-400">
                              {cbmPorBulto.toFixed(2)}
                            </td>
                            <td className="px-2 py-2.5 border border-slate-200 text-center font-bold text-blue-900 bg-blue-50/40">
                              {cubicajeTotal.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <table
                    className="w-full text-left mb-7 border-collapse border border-slate-200"
                    style={{ fontSize: "9px" }}
                  >
                    <thead>
                      <tr className="text-white font-bold uppercase tracking-wider text-[8px]">
                        <th className="px-3 py-3 border border-white/20 text-center w-[5%] bg-[#16263F]">
                          #
                        </th>
                        {showReferenceColumn && (
                          <th className="px-3 py-3 border border-white/20 bg-[#16263F]">
                            Referencia
                          </th>
                        )}
                        <th className="px-3 py-3 border border-white/20 text-center w-[10%] bg-[#16263F]">
                          Bultos
                        </th>
                        {showWeightColumn && (
                          <th className="px-3 py-3 border border-white/20 text-center w-[10%] bg-[#16263F]">
                            Peso(kg)
                          </th>
                        )}
                        <th className="px-3 py-3 border border-white/20 text-center w-[10%] bg-[#16263F]">
                          L
                        </th>
                        <th className="px-3 py-3 border border-white/20 text-center w-[10%] bg-[#16263F]">
                          W
                        </th>
                        <th className="px-3 py-3 border border-white/20 text-center w-[10%] bg-[#16263F]">
                          H
                        </th>
                        <th className="px-3 py-3 border border-white/25 text-center w-[15%] bg-blue-600">
                          Total CBM
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {measureRows.map((row, idx) => {
                        const l = parseFloat(String(row.l ?? 0)) || 0;
                        const w = parseFloat(String(row.w ?? 0)) || 0;
                        const h = parseFloat(String(row.h ?? 0)) || 0;
                        const b = parseFloat(String(row.bultos ?? 0)) || 0;
                        const rowCbm = ((l * w * h) / 1_000_000) * b;
                        return (
                          <tr
                            key={idx}
                            className="even:bg-slate-100/70 text-slate-800 font-medium"
                          >
                            <td className="px-3 py-2.5 border border-slate-200 text-center font-bold">
                              {idx + 1}
                            </td>
                            {showReferenceColumn && (
                              <td className="px-3 py-2.5 border border-slate-200 uppercase">
                                {row.referencia || "-"}
                              </td>
                            )}
                            <td className="px-3 py-2.5 border border-slate-200 text-center font-bold bg-violet-50/80 text-violet-900">
                              {row.bultos}
                            </td>
                            {showWeightColumn && (
                              <td className="px-3 py-2.5 border border-slate-200 text-center">
                                {row.weight || "-"}
                              </td>
                            )}
                            <td className="px-3 py-2.5 border border-slate-200 text-center text-slate-500">
                              {row.l || 0}
                            </td>
                            <td className="px-3 py-2.5 border border-slate-200 text-center text-slate-500">
                              {row.w || 0}
                            </td>
                            <td className="px-3 py-2.5 border border-slate-200 text-center text-slate-500">
                              {row.h || 0}
                            </td>
                            <td className="px-3 py-2.5 border border-slate-200 text-center font-bold text-blue-900 bg-blue-50/40">
                              {rowCbm.toFixed(2)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {t.notes && (
                  <div className="mb-7">
                    <h3 className="text-[11px] font-black text-[#16263F] uppercase tracking-[0.18em] mb-2.5 pl-3 border-l-4 border-blue-600">
                      Observaciones
                    </h3>
                    <div className="p-4 bg-white border border-slate-200 rounded-md text-xs text-slate-700 font-medium uppercase leading-relaxed">
                      {t.notes}
                    </div>
                  </div>
                )}

                <div className="mt-auto pt-6 border-t border-slate-200 text-center">
                  <p className="text-[8px] font-bold text-slate-400 uppercase tracking-[0.16em]">
                    Aldepositos · documento generado por Warehouse OS
                  </p>
                </div>
                </div>
              </div>
            );
          })}
        </div>

        {splitTaskConfig && (
          <SplitOrderModal
            task={splitTaskConfig}
            onClose={() => setSplitTaskConfig(null)}
            onConfirm={(splitValues, suffix) => {
              const t = splitTaskConfig;
              if (!t) return;

              let newOriginalRows = JSON.parse(
                JSON.stringify(t.measureData || []),
              ) as any[];
              const splitRows: any[] = [];

              newOriginalRows.forEach((row) => {
                const key = String(row.id ?? "");
                const splitQty = splitValues[key] || 0;
                const currentBultos =
                  parseFloat(String(row.bultos ?? 0)) || 0;
                if (splitQty > 0 && currentBultos > 0) {
                  splitRows.push({
                    ...row,
                    id: `split-${key}-${Date.now()}`,
                    bultos: splitQty,
                  });
                  row.bultos = currentBultos - splitQty;
                }
              });

              newOriginalRows = newOriginalRows.filter((r) => {
                const b = parseFloat(String(r.bultos ?? 0)) || 0;
                return b > 0;
              });

              const recalc = (rows: any[]) => {
                let b = 0;
                let c = 0;
                let w = 0;
                let u = 0;
                rows.forEach((row) => {
                  const rb = parseFloat(String(row.bultos ?? 0)) || 0;
                  const rw =
                    parseFloat(
                      String(
                        t.type === "detailed"
                          ? row.pesoPorBulto ?? 0
                          : row.weight ?? 0,
                      ),
                    ) || 0;
                  const ru =
                    parseFloat(String(row.unidadesPorBulto ?? 0)) || 0;
                  const l = parseFloat(String(row.l ?? 0)) || 0;
                  const wi = parseFloat(String(row.w ?? 0)) || 0;
                  const h = parseFloat(String(row.h ?? 0)) || 0;

                  b += rb;
                  u += rb * ru;
                  if (t.type === "detailed" || t.weightMode === "per_bundle") {
                    w += rb * rw;
                  }
                  c += ((l * wi * h) / 1_000_000) * rb;
                });
                if (t.type !== "detailed" && t.weightMode !== "per_bundle") {
                  w =
                    (t.originalExpectedBultos || 0) > 0
                      ? (t.expectedWeight / t.originalExpectedBultos) * b
                      : t.expectedWeight;
                }
                return {
                  bultos: b,
                  cbm: parseFloat(c.toFixed(2)),
                  weight: w,
                  unidades: u,
                };
              };

              const totNew = recalc(splitRows);
              const totOrig = recalc(newOriginalRows);

              const newTask: Task = {
                ...t,
                id: `${t.id}-${Date.now()}`,
                ra: `${t.ra}${suffix}`,
                measureData: splitRows,
                currentBultos: totNew.bultos,
                expectedBultos: totNew.bultos,
                originalExpectedBultos: totNew.bultos,
                expectedWeight: totNew.weight,
                expectedCbm: totNew.cbm,
                status: "partial",
              };

              if (totOrig.bultos > 0) {
                const updatedOriginal: Task = {
                  ...t,
                  measureData: newOriginalRows,
                  currentBultos: totOrig.bultos,
                  expectedWeight: totOrig.weight,
                  expectedCbm: totOrig.cbm,
                  status: totOrig.bultos === 0 ? "completed" : "partial",
                };
                onUpdateTask(updatedOriginal);
              } else {
                onDeleteTask(t.id);
              }

              onAddTasks([newTask]);
              setSplitTaskConfig(null);
              setSingleViewTask(null);
              // eslint-disable-next-line no-alert
              alert(
                `✅ Orden parcializada correctamente. Se generó el RA: ${newTask.ra}`,
              );
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col animate-fade relative">
      <div className="max-w-4xl mx-auto w-full flex flex-col h-full">
        <div className="shrink-0 space-y-4 md:space-y-6 mb-4 md:mb-6 px-2 md:px-0">
          <h2 className="text-xl md:text-3xl font-black text-[#16263F] flex items-center gap-2 md:gap-3">
            <FileText className="text-purple-600 w-5 h-5 md:w-8 md:h-8" />{" "}
            REPORTES
          </h2>

          <div className="bg-white p-4 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
              {clients.length > 0 && (
                <div className="flex flex-col">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 ml-1">
                    Filtrar por Cliente
                  </label>
                  <div className="relative">
                    <select
                      value={clientFilter}
                      onChange={(e) => setClientFilter(e.target.value)}
                      className="appearance-none w-full sm:w-48 bg-slate-50 border border-slate-200 text-[#16263F] font-bold py-2.5 pl-4 pr-10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer text-xs uppercase"
                    >
                      <option value="Todos">TODOS LOS CLIENTES</option>
                      {clients.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  </div>
                </div>
              )}

              <div className="flex flex-col">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 ml-1">
                  Tipo de Ingreso
                </label>
                <div className="relative">
                  <select
                    value={typeFilter}
                    onChange={(e) =>
                      setTypeFilter(e.target.value as typeof typeFilter)
                    }
                    className="appearance-none w-full sm:w-48 bg-slate-50 border border-slate-200 text-[#16263F] font-bold py-2.5 pl-4 pr-10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer text-xs uppercase"
                  >
                    <option value="Todos">TODOS LOS MÓDULOS</option>
                    <option value="quick">Ingreso Rápido</option>
                    <option value="detailed">Ingreso Detallado</option>
                    <option value="airway">Guía Aérea</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              </div>
            </div>

            {displayedTasks.length > 0 && (
              <button
                type="button"
                onClick={handleSelectAll}
                className="w-full md:w-auto text-xs font-black text-blue-600 bg-blue-50 hover:bg-blue-100 px-4 py-2.5 rounded-xl uppercase tracking-widest transition-colors shrink-0"
              >
                {isAllSelected ? "Desmarcar Resultados" : "Seleccionar Resultados"}
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-24">
          <div className="grid grid-cols-1 gap-3 md:gap-4 px-2 md:px-0">
            {displayedTasks.length === 0 ? (
              <div className="bg-white p-8 md:p-16 rounded-[2rem] border border-slate-200 text-center font-bold text-slate-400 flex flex-col items-center">
                <Search className="w-12 h-12 text-slate-300 mb-4" />
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
                    className={`bg-white p-4 md:p-6 rounded-[1.5rem] border transition-all cursor-pointer flex items-center group ${
                      isSelected
                        ? "border-blue-500 bg-blue-50 shadow-md ring-2 ring-blue-500/20"
                        : "border-slate-200 shadow-sm hover:border-blue-300"
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
                          : "border-slate-300 bg-white"
                      }`}
                    >
                      {isSelected && <Check size={16} strokeWidth={4} />}
                    </div>

                    <div className="flex flex-col md:flex-row md:items-center justify-between flex-1 gap-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest ${
                              t.status === "partial"
                                ? "bg-orange-100 text-orange-700"
                                : "bg-green-100 text-green-700"
                            }`}
                          >
                            {t.status === "partial" ? "Parcial" : "Completado"}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest ${
                              t.type === "detailed"
                                ? "bg-purple-100 text-purple-700"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {moduleName}
                          </span>
                          <span className="text-slate-300 mx-1">|</span>
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest truncate max-w-[120px]">
                            {t.mainClient}
                          </p>
                        </div>
                        <h3 className="text-xl md:text-2xl font-black text-[#16263F] leading-tight group-hover:text-blue-600 transition-colors">
                          RA: {t.ra}
                        </h3>
                        <p className="text-[10px] md:text-xs font-bold text-slate-500 uppercase">
                          {t.provider}
                          {t.brand ? ` — ${t.brand}` : ""}
                        </p>
                      </div>
                      <div className="text-left md:text-right flex items-center gap-4 justify-end mt-2 md:mt-0">
                        <div className="text-right">
                          <p className="text-sm md:text-lg font-black text-[#16263F] leading-none">
                            {t.currentBultos} BULTOS
                          </p>
                        </div>
                        <div className="w-10 h-10 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors border border-slate-200">
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

type SplitOrderModalProps = {
  task: Task;
  onClose: () => void;
  onConfirm: (splitValues: Record<string, number>, suffix: string) => void;
};

function SplitOrderModal({ task, onClose, onConfirm }: SplitOrderModalProps) {
  const [splitValues, setSplitValues] = useState<Record<string, number>>({});
  const [suffix, setSuffix] = useState("-P1");

  const handleSplitChange = (rowId: string, val: string, max: number) => {
    let num = parseInt(val || "0", 10) || 0;
    if (num < 0) num = 0;
    if (num > max) num = max;
    setSplitValues((prev) => ({ ...prev, [rowId]: num }));
  };

  const handleSave = () => {
    const hasItems = Object.values(splitValues).some((v) => v > 0);
    if (!hasItems) {
      // eslint-disable-next-line no-alert
      alert("Selecciona al menos un bulto para crear el parcial.");
      return;
    }
    onConfirm(splitValues, suffix);
  };

  return (
    <div className="fixed inset-0 bg-[#16263F]/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade no-print">
      <div className="bg-white w-full max-w-4xl rounded-[2rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="bg-orange-500 p-5 md:p-6 text-white shrink-0 flex justify-between items-center">
          <div>
            <h3 className="text-lg md:text-xl font-black tracking-tight flex items-center gap-2">
              <Zap className="w-5 h-5" /> PARCIALIZAR ORDEN: RA-{task.ra}
            </h3>
            <p className="text-orange-100 text-xs mt-1 font-bold">
              Selecciona las cantidades de cada línea que deseas separar en un
              nuevo parcial.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-orange-200 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5 rotate-180" />
          </button>
        </div>

        <div className="p-5 md:p-8 overflow-y-auto flex-1 custom-scrollbar">
          <div className="overflow-x-auto hide-scrollbar border border-slate-200 rounded-2xl">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="bg-slate-50 text-slate-500 font-black uppercase text-[10px] tracking-widest border-b border-slate-200">
                <tr>
                  <th className="px-4 py-4 w-10 text-center">#</th>
                  <th className="px-4 py-4">Referencia</th>
                  <th className="px-4 py-4">Descripción</th>
                  <th className="px-4 py-4 text-center">Disp.</th>
                  <th className="px-4 py-4 text-center bg-orange-50 text-orange-700 w-40">
                    Bultos a Extraer
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(task.measureData || []).map((row: any, idx: number) => {
                  const key = String(row.id ?? idx);
                  const available =
                    parseFloat(String(row.bultos ?? 0)) || 0;
                  return (
                    <tr
                      key={key}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-4 py-3 text-center font-bold text-slate-400">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-3 font-bold text-[#16263F] uppercase">
                        {row.referencia || "-"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 uppercase">
                        {row.descripcion || "-"}
                      </td>
                      <td className="px-4 py-3 text-center font-black text-lg text-slate-700">
                        {available}
                      </td>
                      <td className="px-4 py-3 bg-orange-50/30">
                        <input
                          type="number"
                          max={available}
                          min={0}
                          value={splitValues[key] ?? ""}
                          onChange={(e) =>
                            handleSplitChange(key, e.target.value, available)
                          }
                          className="w-full bg-white border-2 border-orange-200 focus:border-orange-500 focus:ring-4 focus:ring-orange-500/20 rounded-xl py-2 text-center font-black text-orange-600 text-lg outline-none transition-all"
                          placeholder="0"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex flex-col md:flex-row items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
            <div className="flex-1 w-full flex items-center gap-3">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Sufijo del Nuevo Parcial:
              </label>
              <div className="flex items-center text-lg font-black text-[#16263F]">
                RA-{task.ra}
                <input
                  type="text"
                  value={suffix}
                  onChange={(e) => setSuffix(e.target.value)}
                  className="ml-2 bg-white border border-slate-300 rounded-lg px-3 py-1.5 w-24 focus:border-blue-500 outline-none uppercase text-blue-600"
                />
              </div>
            </div>
            <div className="text-[10px] text-slate-400 font-bold uppercase w-full md:w-auto text-right">
              * Se crearán dos inventarios separados y los cálculos de volumen y
              peso se ajustarán automáticamente.
            </div>
          </div>
        </div>

        <div className="flex gap-3 p-5 md:p-6 border-t border-slate-100 bg-white shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-4 bg-white border border-slate-200 text-slate-500 font-bold rounded-xl hover:bg-slate-50 transition-colors uppercase text-xs tracking-widest"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex-1 py-4 bg-orange-500 text-white font-black rounded-xl shadow-lg hover:bg-orange-600 transition-colors uppercase text-xs tracking-widest flex items-center justify-center gap-2"
          >
            Generar Parcial <ArrowLeft className="w-4 h-4 rotate-180" />
          </button>
        </div>
      </div>
    </div>
  );
}

