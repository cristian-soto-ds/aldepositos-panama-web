"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  User,
  Plus,
  UploadCloud,
  Loader2,
  Users,
  FileSpreadsheet,
  Box,
  FileText,
  Plane,
} from "lucide-react";

import type { Task } from "@/lib/types/task";

type ControlPanelHomeProps = {
  tasks: Task[];
  onImport: (tasks: Task[]) => void;
  openManualModal: () => void;
  userEmail: string | null;
};

const generateId = () => Math.random().toString(36).substr(2, 9);

export function ControlPanelHome({
  tasks,
  onImport,
  openManualModal,
  userEmail,
}: ControlPanelHomeProps) {
  const quickPending = tasks.filter(
    (t) => t.type === "quick" && t.status !== "completed"
  ).length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const totalBultos = tasks.reduce((a, b) => a + b.currentBultos, 0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsedData, setParsedData] = useState<Task[]>([]);
  const [extractedClient, setExtractedClient] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined" && !(window as any).XLSX) {
      const script = document.createElement("script");
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Buenos días";
    if (hour < 18) return "Buenas tardes";
    return "Buenas noches";
  };

  const currentDate = new Date().toLocaleDateString("es-PA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!(window as any).XLSX) {
      alert(
        "El procesador de archivos se está cargando. Inténtalo de nuevo en unos segundos."
      );
      return;
    }

    setSelectedFile(file);
    setIsProcessing(true);
    setShowImportModal(true);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const XLSX = (window as any).XLSX;
        const workbook = XLSX.read(
          new Uint8Array(evt.target?.result as ArrayBuffer),
          { type: "array" }
        );
        const rows = XLSX.utils.sheet_to_json(
          workbook.Sheets[workbook.SheetNames[0]],
          { header: 1 }
        );

        if (rows.length < 7) {
          alert("⚠️ Archivo inválido o sin formato correcto (Fila 6/7).");
          setShowImportModal(false);
          return;
        }

        let mainClient = "Desconocido";
        const row6 = rows[5] || [];
        for (const cell of row6) {
          if (cell && cell.toString().trim().length > 2) {
            mainClient = cell
              .toString()
              .replace(/\s*\(\d+\)\s*$/, "")
              .trim();
            break;
          }
        }

        const extracted: Task[] = [];
        for (let i = 6; i < rows.length; i++) {
          const r = rows[i];
          if (r && r[1]) {
            extracted.push({
              id: generateId(),
              ra: r[1].toString().trim(),
              mainClient,
              provider: r[3] || "N/A",
              subClient: r[4] || "N/A",
              brand: r[5] || "N/A",
              expectedBultos: parseFloat(r[6]) || 0,
              originalExpectedBultos: parseFloat(r[6]) || 0,
              expectedCbm: parseFloat(r[7]) || 0,
              expectedWeight: parseFloat(r[8]) || 0,
              notes: r[9] || "",
              currentBultos: 0,
              status: "pending",
              measureData: [],
              weightMode: "no_weight",
              manualTotalWeight: 0,
            });
          }
        }

        if (extracted.length > 0) {
          setExtractedClient(mainClient);
          setParsedData(extracted);
          setIsProcessing(false);
        } else {
          alert("No se encontraron RAs válidos.");
          setShowImportModal(false);
        }
      } catch (error) {
        console.error(error);
        alert("Error procesando el archivo Excel.");
        setShowImportModal(false);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const confirmImport = (type: Task["type"]) => {
    const finalTasks = parsedData.map((t) => ({ ...t, type }));
    onImport(finalTasks);
    setShowImportModal(false);
    setSelectedFile(null);
    setParsedData([]);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 md:space-y-8 animate-fade pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 md:gap-6 bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-slate-100">
        <div className="w-full flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center shrink-0 shadow-inner">
            <User className="text-blue-600 w-8 h-8" />
          </div>
          <div>
            <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mb-1">
              {currentDate}
            </p>
            <h2 className="text-2xl md:text-3xl font-extrabold text-[#16263F] tracking-tight">
              {getGreeting()},{" "}
              {userEmail ? userEmail.split("@")[0] : "Operador Aldepósitos"}
            </h2>
          </div>
        </div>
        <div className="w-full md:w-auto flex flex-wrap gap-3">
          <button
            onClick={openManualModal}
            className="flex-1 md:flex-none bg-white hover:bg-slate-50 text-[#16263F] border border-slate-200 px-6 py-3 md:py-4 rounded-2xl font-bold shadow-sm transition cursor-pointer flex items-center justify-center gap-2 active:scale-95 text-xs md:text-sm uppercase tracking-widest"
          >
            <Plus size={18} /> Crear Manual
          </button>
          <label className="flex-1 md:flex-none bg-green-600 hover:bg-green-700 text-white px-6 md:px-8 py-3 md:py-4 rounded-2xl font-black shadow-lg shadow-green-600/20 transition cursor-pointer flex items-center justify-center gap-2 md:gap-3 active:scale-95 text-xs md:text-sm uppercase tracking-wide">
            <UploadCloud size={20} /> Cargar Excel
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              onChange={handleFileChange}
              accept=".xlsx, .xls, .csv"
            />
          </label>
        </div>
      </div>

      {/* TODO: aquí podríamos reconstruir las tarjetas estadísticas y secciones adicionales,
          siguiendo el diseño original del panel de control. */}

      {showImportModal && (
        <div className="fixed inset-0 bg-[#16263F]/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade">
          <div className="bg-white w-full max-w-lg rounded-3xl md:rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#16263F] p-5 md:p-8 text-white shrink-0">
              <h3 className="text-lg md:text-2xl font-black tracking-tight flex items-center gap-2 md:gap-3">
                <FileSpreadsheet className="text-[#FFC400] w-5 h-5 md:w-6 md:h-6" />{" "}
                Relación de Carga
              </h3>
              <p className="text-blue-200 text-xs md:text-sm mt-1 truncate">
                {selectedFile?.name}
              </p>
            </div>
            <div className="p-5 md:p-8 space-y-5 md:space-y-6 overflow-y-auto">
              {isProcessing ? (
                <div className="text-center py-8">
                  <Loader2 className="w-12 h-12 mx-auto text-[#16263F] animate-spin mb-4" />
                  <h3 className="text-lg font-bold text-[#16263F]">
                    Procesando Excel...
                  </h3>
                </div>
              ) : (
                <>
                  <div className="bg-[#F8FAFC] border border-slate-200 p-4 md:p-6 rounded-2xl md:rounded-3xl flex items-start gap-4 md:gap-5 shadow-sm">
                    <div className="bg-blue-100 p-3 rounded-xl">
                      <Users className="text-blue-600 w-5 h-5 md:w-6 md:h-6" />
                    </div>
                    <div>
                      <p className="text-[#16263F] font-black text-sm md:text-lg uppercase tracking-tight">
                        {extractedClient}
                      </p>
                      <p className="text-slate-500 text-[10px] md:text-xs font-bold mt-1 uppercase tracking-widest">
                        Se detectaron{" "}
                        <span className="text-blue-600">
                          {parsedData.length} RA&apos;s
                        </span>{" "}
                        listos.
                      </p>
                    </div>
                  </div>

                  <p className="font-black text-[#16263F] text-center uppercase text-[10px] md:text-xs tracking-[0.2em]">
                    Asignar órdenes a módulo:
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                    <button
                      onClick={() => confirmImport("quick")}
                      className="flex flex-row sm:flex-col items-center justify-center gap-3 sm:gap-0 p-4 md:p-6 border-2 border-slate-100 rounded-2xl md:rounded-[2rem] hover:border-blue-500 hover:bg-blue-50 transition-all group shadow-sm"
                    >
                      <Box className="text-blue-500 sm:mb-3 group-hover:rotate-12 transition-transform w-6 h-6 md:w-8 md:h-8 shrink-0" />
                      <span className="font-black text-[#16263F] uppercase text-[10px] md:text-xs tracking-widest text-center leading-tight">
                        Captura de
                        <br className="hidden sm:block" />
                        Medidas
                      </span>
                    </button>
                    <button
                      onClick={() => confirmImport("detailed")}
                      className="flex flex-row sm:flex-col items-center justify-center gap-3 sm:gap-0 p-4 md:p-6 border-2 border-slate-100 rounded-2xl md:rounded-[2rem] hover:border-purple-500 hover:bg-purple-50 transition-all group shadow-sm"
                    >
                      <FileText className="text-purple-600 sm:mb-3 group-hover:rotate-12 transition-transform w-6 h-6 md:w-8 md:h-8 shrink-0" />
                      <span className="font-black text-[#16263F] uppercase text-[10px] md:text-xs tracking-widest text-center leading-tight">
                        Validación
                        <br className="hidden sm:block" />
                        Detallada
                      </span>
                    </button>
                    <button
                      onClick={() => confirmImport("airway")}
                      className="col-span-1 sm:col-span-2 flex flex-row items-center justify-center gap-3 p-4 md:p-6 border-2 border-slate-100 rounded-2xl md:rounded-[2rem] hover:border-orange-500 hover:bg-orange-50 transition-all group shadow-sm"
                    >
                      <Plane className="text-orange-500 group-hover:rotate-12 transition-transform w-6 h-6 shrink-0" />
                      <span className="font-black text-[#16263F] uppercase text-[10px] md:text-xs tracking-widest leading-tight">
                        Guía Aérea
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

