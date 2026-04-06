 "use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Box,
  Calculator,
  Check,
  FileDown,
  Printer,
  Truck,
  X,
} from "lucide-react";
import type { ControlPanelHome } from "@/components/control-panel/ControlPanelHome";
import { downloadRelacionCargaExcel } from "@/lib/exportRelacionCargaExcel";

type Task = Parameters<typeof ControlPanelHome>[0]["tasks"][number];

type DispatchEntryProps = {
  tasks: Task[];
  onUpdateTask: (task: Task) => void;
  containerToEdit: {
    loadedIds: string[];
    containerInfo: ContainerInfo;
  } | null;
  clearEdit: () => void;
  /** Nombre completo del operador (fallback “Cargado por” en exportaciones si no hay responsable). */
  operatorDisplayName?: string | null;
};

type ContainerInfo = {
  type: string;
  consignment: string;
  number: string;
  bl: string;
  seal1: string;
  seal2: string;
  responsible: string;
  date: string;
  tare?: number;
};

type DetailedRow = {
  id: string;
  ra: string;
  partial: string;
  provider: string;
  subClient: string;
  brand: string;
  date: string;
  ref: string;
  desc: string;
  bultos: number;
  weight: string;
  cbm: string;
};

function normalizeDispatchDescription(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text) continue;
    const lower = text.toLowerCase();
    if (lower === "sin descripción" || lower === "sin descripcion") continue;
    return text;
  }
  return "N/A";
}

const capacityMap: Record<
  string,
  { name: string; maxCbm: number; tare: number }
> = {
  "20": { name: "Contenedor 20'", maxCbm: 28, tare: 2300 },
  "40": { name: "Contenedor 40'", maxCbm: 56, tare: 3900 },
  furgon: { name: "Contenedor 40' HQ", maxCbm: 70, tare: 0 },
};

/** Inventario cerrado: listo para planificar en relación de carga. */
function isInventoryComplete(t: Task): boolean {
  return t.status === "completed";
}

/** Sin medir / sin ingresar aún. */
function isAwaitingEntry(t: Task): boolean {
  return t.status === "pending";
}

/** Medición iniciada pero no terminada (ingreso rápido o detallado). */
function isInventoryInProgress(t: Task): boolean {
  return t.status === "in_progress" || t.status === "partial";
}

/** Orden en bodega: pendientes primero, luego en proceso, luego listos. */
function warehouseListRank(t: Task): number {
  if (isAwaitingEntry(t)) return 0;
  if (isInventoryInProgress(t)) return 1;
  if (isInventoryComplete(t)) return 2;
  return 1;
}

export function DispatchEntry({
  tasks,
  onUpdateTask,
  containerToEdit,
  clearEdit,
  operatorDisplayName = null,
}: DispatchEntryProps) {
  const availableTasks = useMemo(
    () => tasks.filter((t) => !t.dispatched),
    [tasks],
  );

  const [selectedClientFilter, setSelectedClientFilter] =
    useState<string>("Todos");
  const [loadedIds, setLoadedIds] = useState<string[]>([]);
  const [isPrinting, setIsPrinting] = useState(false);
  const [showLoadPlanner, setShowLoadPlanner] = useState(false);
  const [containerInfo, setContainerInfo] = useState<ContainerInfo>({
    type: "40",
    consignment: "",
    number: "",
    bl: "",
    seal1: "",
    seal2: "",
    responsible: "",
    date: new Date().toISOString().split("T")[0]!,
    tare: capacityMap["40"].tare,
  });
  const pendingDraftTasks = useMemo(
    () => tasks.filter((t) => t.containerDraft === true && !t.dispatched),
    [tasks],
  );

  useEffect(() => {
    if (containerToEdit) {
      setLoadedIds(containerToEdit.loadedIds);
      setShowLoadPlanner(true);
      const incoming = containerToEdit.containerInfo;
      setContainerInfo({
        ...incoming,
        tare:
          typeof incoming.tare === "number"
            ? incoming.tare
            : capacityMap[incoming.type]?.tare ?? capacityMap["40"].tare,
      });
      clearEdit();
    }
  }, [containerToEdit, clearEdit]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem("dispatch_container_info_draft");
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as Partial<ContainerInfo>;
      setContainerInfo((prev) => ({
        ...prev,
        ...saved,
        tare:
          typeof saved.tare === "number"
            ? saved.tare
            : typeof prev.tare === "number"
              ? prev.tare
              : capacityMap[prev.type]?.tare ?? capacityMap["40"].tare,
      }));
    } catch {
      // ignore corrupted draft
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      "dispatch_container_info_draft",
      JSON.stringify(containerInfo),
    );
  }, [containerInfo]);

  useEffect(() => {
    if (loadedIds.length > 0 || pendingDraftTasks.length === 0) return;
    setLoadedIds(pendingDraftTasks.map((t) => t.id));
  }, [pendingDraftTasks, loadedIds.length]);

  const uniqueClients = useMemo(
    () =>
      Array.from(
        new Set(availableTasks.map((t) => t.mainClient).filter(Boolean)),
      ),
    [availableTasks],
  );

  const loadedTasks = useMemo(
    () => availableTasks.filter((t) => loadedIds.includes(t.id)),
    [availableTasks, loadedIds],
  );

  let pendingTasksList = availableTasks.filter((t) => !loadedIds.includes(t.id));
  if (selectedClientFilter !== "Todos") {
    pendingTasksList = pendingTasksList.filter(
      (t) => t.mainClient === selectedClientFilter,
    );
  }

  const getTaskWeight = (t: Task): number => {
    // Inventario detallado: un solo total por RA (expectedWeight = lo inventariado).
    if (t.status !== "pending" && t.type === "detailed") {
      const fromCapture = parseFloat(String(t.expectedWeight ?? 0)) || 0;
      if (fromCapture > 0) return fromCapture;
    }
    if (t.measureData && t.measureData.length > 0 && t.status !== "pending") {
      if (t.type === "detailed") {
        const detailedWeight = t.measureData.reduce((acc: number, row: any) => {
          const b = parseFloat(String(row.bultos ?? 0)) || 0;
          const pesoPorBulto =
            parseFloat(String(row.pesoPorBulto ?? 0)) || 0;
          return acc + b * pesoPorBulto;
        }, 0);
        if (detailedWeight > 0) return detailedWeight;
      } else if (t.weightMode === "per_bundle") {
        const quickWeight = t.measureData.reduce((acc: number, row: any) => {
          const b = parseFloat(String(row.bultos ?? 0)) || 0;
          const rowWeight = parseFloat(String(row.weight ?? 0)) || 0;
          return acc + b * rowWeight;
        }, 0);
        if (quickWeight > 0) return quickWeight;
      }
    }
    return parseFloat(String(t.expectedWeight ?? 0)) || 0;
  };

  const currentWeight = loadedTasks.reduce(
    (sum, t) => sum + getTaskWeight(t),
    0,
  );

  const getTaskCbm = (t: Task): number => {
    // Pendiente => siempre 0.00 CBM.
    if (t.status === "pending") return 0;
    // Inventario detallado: cubicaje total por RA (expectedCbm = lo inventariado).
    if (t.type === "detailed") {
      const fromCapture = parseFloat(String(t.expectedCbm ?? 0)) || 0;
      if (fromCapture > 0) return fromCapture;
    }
    if (!t.measureData || t.measureData.length === 0) return 0;
    return t.measureData.reduce((acc: number, row: any) => {
      const l = parseFloat(String(row.l ?? 0)) || 0;
      const w = parseFloat(String(row.w ?? 0)) || 0;
      const h = parseFloat(String(row.h ?? 0)) || 0;
      const b = parseFloat(String(row.bultos ?? 0)) || 0;
      return acc + ((l * w * h) / 1_000_000) * b;
    }, 0);
  };

  const currentCbm = loadedTasks.reduce(
    (sum, t) => sum + getTaskCbm(t),
    0,
  );
  const currentBultos = loadedTasks.reduce(
    (sum, t) =>
      sum +
      (parseInt(
        String(
          t.status === "pending"
            ? t.expectedBultos
            : t.currentBultos ?? t.expectedBultos,
        ),
        10,
      ) || 0),
    0,
  );

  const excelPrimaryClient = useMemo(() => {
    const set = new Set(
      loadedTasks
        .map((t) => String(t.mainClient || "").trim())
        .filter(Boolean),
    );
    if (set.size === 0) return "—";
    if (set.size === 1) return [...set][0]!;
    return "VARIOS";
  }, [loadedTasks]);

  const excelTrackingRef = useMemo(() => {
    const tracking = (containerInfo.bl || "").trim();
    if (tracking) return tracking;
    const c = (containerInfo.consignment || "").trim();
    if (c) return c;
    const brand = loadedTasks[0]?.brand;
    if (brand && String(brand).trim()) return String(brand).trim();
    return "";
  }, [containerInfo.consignment, containerInfo.bl, loadedTasks]);

  const excelExportedBy = useMemo(() => {
    const r = (containerInfo.responsible || "").trim();
    if (r) return r;
    const op = (operatorDisplayName || "").trim();
    if (op && !op.includes("@")) return op;
    return "Operador";
  }, [containerInfo.responsible, operatorDisplayName]);

  const resolvedTare =
    typeof containerInfo.tare === "number"
      ? containerInfo.tare
      : capacityMap[containerInfo.type]?.tare ?? capacityMap["40"].tare;

  const maxCbm = capacityMap[containerInfo.type].maxCbm;
  const percentFilled = maxCbm > 0 ? (currentCbm / maxCbm) * 100 : 0;

  const progressColor =
    percentFilled > 95
      ? "bg-red-500"
      : percentFilled > 80
        ? "bg-orange-500"
        : "bg-green-500";
  const progressText =
    percentFilled > 100
      ? "¡SOBRECAPACIDAD!"
      : percentFilled > 80
        ? "CAPACIDAD ÓPTIMA"
        : "CON ESPACIO";

  const handleToggleLoad = (id: string) => {
    setLoadedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
    const taskObj = availableTasks.find((t) => t.id === id);
    if (taskObj) {
      const isNowLoaded = !loadedIds.includes(id);
      onUpdateTask({
        ...taskObj,
        containerDraft: isNowLoaded,
      });
    }
  };

  const handleConfirmDispatch = () => {
    if (loadedIds.length === 0) {
      // eslint-disable-next-line no-alert
      alert("⚠️ La lista de la Relación de Carga está vacía.");
      return;
    }

    const finalInfo: ContainerInfo = {
      ...containerInfo,
      tare:
        typeof containerInfo.tare === "number"
          ? containerInfo.tare
          : capacityMap[containerInfo.type]?.tare ?? capacityMap["40"].tare,
    };
    if (!finalInfo.number.trim()) {
      finalInfo.number = `POR-ASIGNAR-${Math.floor(Math.random() * 1000)}`;
    }
    if (!finalInfo.responsible.trim()) {
      finalInfo.responsible = "Operador Sistema";
    }

    // eslint-disable-next-line no-alert
    if (
      !window.confirm(
        `¿Confirmar la salida de ${loadedIds.length} órdenes?\n\nAl confirmar, las órdenes serán marcadas como despachadas y quedarán disponibles en el historial de contenedores.`,
      )
    ) {
      return;
    }

    const today = new Date().toISOString().split("T")[0]!;

    loadedTasks.forEach((t) => {
      onUpdateTask({
        ...t,
        dispatched: true,
        containerDraft: false,
        dispatchInfo: finalInfo,
        date: t.date || today,
      });
    });

    setLoadedIds([]);
    setShowLoadPlanner(false);
  };

  const getDetailedRows = (): DetailedRow[] => {
    const rows: DetailedRow[] = [];
    loadedTasks.forEach((t) => {
      const detailedOneRa =
        t.type === "detailed" &&
        t.status !== "pending" &&
        Array.isArray(t.measureData) &&
        t.measureData.length > 0;

      if (detailedOneRa) {
        const bultos = t.currentBultos || t.expectedBultos;
        const tw = getTaskWeight(t);
        const tc = getTaskCbm(t);
        rows.push({
          id: t.id,
          ra: t.ra,
          partial: t.status === "partial" ? "SÍ" : "NO",
          provider: t.provider || "N/A",
          subClient: t.subClient || "N/A",
          brand: t.brand || "N/A",
          date: t.date || containerInfo.date,
          ref: `RA-${t.ra}`,
          desc: normalizeDispatchDescription(t.notes),
          bultos,
          weight: tw > 0 ? tw.toFixed(2) : "",
          cbm: tc.toFixed(2),
        });
        return;
      }

      if (t.measureData && t.measureData.length > 0 && t.status !== "pending") {
        let perRefWeightPerBundle = 0;
        if (t.weightMode === "by_reference") {
          const totalBultos = t.measureData.reduce((acc: number, row: any) => {
            const b = parseFloat(String(row.bultos ?? 0)) || 0;
            return acc + b;
          }, 0);
          if (totalBultos > 0) {
            perRefWeightPerBundle =
              (parseFloat(String(t.expectedWeight ?? 0)) || 0) / totalBultos;
          }
        }

        t.measureData.forEach((m: any, idx: number) => {
          const bultos = parseFloat(String(m.bultos ?? 0)) || 0;
          const l = parseFloat(String(m.l ?? 0)) || 0;
          const w = parseFloat(String(m.w ?? 0)) || 0;
          const h = parseFloat(String(m.h ?? 0)) || 0;
          const cbm = ((l * w * h) / 1_000_000) * bultos;

          let lineWeight = 0;
          if (t.weightMode === "per_bundle") {
            const rowWeight = parseFloat(String(m.weight ?? 0)) || 0;
            lineWeight = bultos * rowWeight;
          } else if (t.weightMode === "by_reference" && perRefWeightPerBundle > 0) {
            lineWeight = bultos * perRefWeightPerBundle;
          }

          const desc = normalizeDispatchDescription(t.notes, m.descripcion);

          rows.push({
            id: `${t.id}-${idx}`,
            ra: t.ra,
            partial: t.status === "partial" ? "SÍ" : "NO",
            provider: t.provider || "N/A",
            subClient: t.subClient || "N/A",
            brand: t.brand || "N/A",
            date: t.date || containerInfo.date,
            ref: m.referencia || "S/R",
            desc,
            bultos,
            weight:
              lineWeight > 0
                ? lineWeight.toFixed(2)
                : "",
            cbm: cbm.toFixed(2),
          });
        });
      } else {
        rows.push({
          id: t.id,
          ra: t.ra,
          partial: t.status === "partial" ? "SÍ" : "NO",
          provider: t.provider || "N/A",
          subClient: t.subClient || "N/A",
          brand: t.brand || "N/A",
          date: t.date || containerInfo.date,
          ref: "N/A",
          desc:
            t.status === "pending"
              ? "PRIORIDAD (PENDIENTE DE INGRESO)"
              : normalizeDispatchDescription(t.notes),
          bultos:
            t.status === "pending"
              ? t.expectedBultos
              : t.currentBultos || t.expectedBultos,
          weight: String(getTaskWeight(t)),
          cbm: getTaskCbm(t).toFixed(2),
        });
      }
    });

    return rows;
  };

  const detailedRows = getDetailedRows();

  const exportToExcel = async () => {
    if (detailedRows.length === 0) {
      // eslint-disable-next-line no-alert
      alert("No hay datos para exportar.");
      return;
    }
    try {
      await downloadRelacionCargaExcel({
        containerInfo,
        rows: detailedRows.map((r) => ({
          ra: r.ra,
          partial: r.partial,
          provider: r.provider,
          subClient: r.subClient,
          brand: r.brand,
          date: r.date,
          cbm: r.cbm,
          weight: r.weight || "0",
          desc: r.desc,
          bultos: r.bultos,
        })),
        totals: {
          bultos: currentBultos,
          cbm: currentCbm,
          netWeight: currentWeight,
          tare: resolvedTare,
          grossWeight: currentWeight + resolvedTare,
        },
        primaryClient: excelPrimaryClient,
        trackingRef: excelTrackingRef,
        exportedByLabel: excelExportedBy,
        fileBaseName: `Relacion_Carga_${containerInfo.number || "Draft"}`,
      });
    } catch (e) {
      console.error(e);
      // eslint-disable-next-line no-alert
      alert("No se pudo generar el archivo Excel.");
    }
  };

  if (isPrinting) {
    return (
      <ContainerManifestPrintView
        containerInfo={containerInfo}
        loadedTasks={loadedTasks}
        detailedRows={detailedRows}
        currentBultos={currentBultos}
        currentCbm={currentCbm}
        currentWeight={currentWeight}
        onBack={() => setIsPrinting(false)}
      />
    );
  }

  if (!showLoadPlanner) {
    return (
      <div className="w-full h-full flex flex-col overflow-hidden pr-2 animate-fade">
        <div className="max-w-[1400px] mx-auto flex flex-col space-y-6 pb-6 w-full h-full">
          <div className="bg-gradient-to-br from-[#16263F] to-[#233B61] p-6 md:p-8 rounded-[2rem] border border-[#1f3558] shadow-xl text-white relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-52 h-52 rounded-full bg-blue-400/15 blur-2xl" />
            <div className="absolute -bottom-8 -left-8 w-40 h-40 rounded-full bg-cyan-300/10 blur-2xl" />
            <div className="relative z-10">
              <h2 className="text-xl md:text-3xl font-black flex items-center gap-2 md:gap-3 mb-2">
                <Truck className="text-blue-300 w-5 h-5 md:w-8 md:h-8" />
                ENTREGA DE CARGA
              </h2>
              <p className="text-xs md:text-sm text-blue-100 font-bold mb-6">
                Centro de despacho para iniciar contenedor y controlar toda la
                salida de carga.
              </p>
            </div>

            <div className="relative z-10 grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-white/10 border border-white/15 rounded-xl p-3">
                <p className="text-[9px] uppercase tracking-widest font-black text-blue-200">
                  RAs disponibles
                </p>
                <p className="text-2xl font-black leading-none mt-1">
                  {availableTasks.length}
                </p>
              </div>
              <div className="bg-white/10 border border-white/15 rounded-xl p-3">
                <p className="text-[9px] uppercase tracking-widest font-black text-blue-200">
                  Borrador activo
                </p>
                <p className="text-2xl font-black leading-none mt-1">
                  {pendingDraftTasks.length}
                </p>
              </div>
              <div className="bg-white/10 border border-white/15 rounded-xl p-3">
                <p className="text-[9px] uppercase tracking-widest font-black text-blue-200">
                  Cliente(s)
                </p>
                <p className="text-2xl font-black leading-none mt-1">
                  {uniqueClients.length}
                </p>
              </div>
              <div className="bg-white/10 border border-white/15 rounded-xl p-3">
                <p className="text-[9px] uppercase tracking-widest font-black text-blue-200">
                  Estado
                </p>
                <p className="text-sm font-black leading-none mt-2 flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-green-300" />
                  LISTO PARA CARGAR
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <button
              type="button"
              onClick={() => setShowLoadPlanner(true)}
              className="xl:col-span-2 text-left bg-white hover:bg-slate-50 border border-slate-200 rounded-[1.7rem] p-6 transition-all shadow-sm hover:shadow-md group"
            >
              <p className="text-xs font-black text-blue-700 uppercase tracking-widest mb-2">
                Opción principal
              </p>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-lg md:text-2xl font-black text-[#16263F]">
                    Iniciar / Cargar contenedor
                  </p>
                  <p className="text-xs md:text-sm font-bold text-slate-500 mt-2 max-w-2xl">
                    Planifica la relación de carga, revisa capacidad, imprime
                    relación y confirma salida sin perder información del
                    despacho.
                  </p>
                </div>
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors shrink-0">
                  <ArrowRight className="w-5 h-5" />
                </div>
              </div>
            </button>

            <div className="bg-white border border-slate-200 rounded-[1.7rem] p-5 shadow-sm">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Resumen rápido
              </p>
              <div className="mt-4 space-y-3 text-sm font-bold text-[#16263F]">
                <p className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Contenedor</span>
                  <span>{(containerInfo.number || "Sin asignar").toUpperCase()}</span>
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Responsable</span>
                  <span className="truncate text-right">
                    {containerInfo.responsible || "Sin asignar"}
                  </span>
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Fecha</span>
                  <span>{containerInfo.date}</span>
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Tipo equipo</span>
                  <span>{capacityMap[containerInfo.type]?.name || "N/A"}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col overflow-hidden pr-2 animate-fade">
      <div className="max-w-[1600px] mx-auto flex flex-col space-y-4 md:space-y-6 pb-6 w-full h-full">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 px-2 md:px-0">
          <h2 className="text-xl md:text-3xl font-black text-[#16263F] flex items-center gap-2 md:gap-3">
            <Truck className="text-blue-600 w-5 h-5 md:w-8 md:h-8" />{" "}
            PLANIFICADOR DE DESPACHO
          </h2>
          <button
            type="button"
            onClick={() => setShowLoadPlanner(false)}
            className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest"
          >
            Volver a opciones
          </button>
        </div>

        <div className="bg-white p-5 md:p-6 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col xl:flex-row gap-6">
          <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1 col-span-2 md:col-span-4 lg:col-span-2 border-b border-slate-100 pb-4 mb-2">
              <label className="text-[10px] font-black text-blue-600 uppercase tracking-widest ml-1">
                Filtrar Bodega por Cliente
              </label>
              <select
                value={selectedClientFilter}
                onChange={(e) => setSelectedClientFilter(e.target.value)}
                className="w-full p-3 bg-blue-50 border border-blue-200 rounded-xl font-bold text-blue-900 focus:border-blue-500 outline-none text-sm cursor-pointer shadow-sm"
              >
                <option value="Todos">TODOS LOS CLIENTES</option>
                {uniqueClients.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2 hidden lg:block border-b border-slate-100 pb-4 mb-2" />

            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
                Tipo Equipo
              </label>
              <select
                value={containerInfo.type}
                onChange={(e) =>
                  setContainerInfo((prev) => ({
                    ...prev,
                    type: e.target.value,
                    tare:
                      typeof prev.tare === "number"
                        ? prev.tare
                        : capacityMap[e.target.value]?.tare ??
                          capacityMap["40"].tare,
                  }))
                }
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-[#16263F] focus:border-blue-500 outline-none text-xs"
              >
                {Object.keys(capacityMap).map((k) => (
                  <option key={k} value={k}>
                    {capacityMap[k].name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
                Nº Consignación
              </label>
              <input
                type="text"
                placeholder="Consignación"
                value={containerInfo.consignment}
                onChange={(e) =>
                  setContainerInfo({
                    ...containerInfo,
                    consignment: e.target.value,
                  })
                }
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold uppercase text-[#16263F] focus:border-blue-500 outline-none text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
                Contenedor
              </label>
              <input
                type="text"
                placeholder="Ej: HLXU1234567"
                value={containerInfo.number}
                onChange={(e) =>
                  setContainerInfo({
                    ...containerInfo,
                    number: e.target.value,
                  })
                }
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold uppercase text-[#16263F] focus:border-blue-500 outline-none text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
                Seguimiento
              </label>
              <input
                type="text"
                placeholder="Nº o referencia de seguimiento"
                value={containerInfo.bl}
                onChange={(e) =>
                  setContainerInfo({ ...containerInfo, bl: e.target.value })
                }
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold uppercase text-[#16263F] focus:border-blue-500 outline-none text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
                Sello 1
              </label>
              <input
                type="text"
                placeholder="Sello Principal"
                value={containerInfo.seal1}
                onChange={(e) =>
                  setContainerInfo({ ...containerInfo, seal1: e.target.value })
                }
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-[#16263F] focus:border-blue-500 outline-none text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
                Sello 2
              </label>
              <input
                type="text"
                placeholder="Opcional"
                value={containerInfo.seal2}
                onChange={(e) =>
                  setContainerInfo({ ...containerInfo, seal2: e.target.value })
                }
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-[#16263F] focus:border-blue-500 outline-none text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
                Tara (kg)
              </label>
              <input
                type="number"
                step="1"
                value={containerInfo.tare ?? ""}
                onChange={(e) =>
                  setContainerInfo({
                    ...containerInfo,
                    tare: Number(e.target.value) || 0,
                  })
                }
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-[#16263F] focus:border-blue-500 outline-none text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">
                Fecha Llegada
              </label>
              <input
                type="date"
                value={containerInfo.date}
                onChange={(e) =>
                  setContainerInfo({ ...containerInfo, date: e.target.value })
                }
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-[#16263F] focus:border-blue-500 outline-none text-xs"
              />
            </div>
          </div>

          <div className="w-full xl:w-80 bg-slate-50 rounded-2xl border border-slate-200 p-5 flex flex-col justify-center shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl" />
            <div className="flex justify-between items-end mb-2 relative z-10">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Capacidad CBM
              </p>
              <p
                className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md ${
                  percentFilled > 95
                    ? "bg-red-100 text-red-600"
                    : "bg-green-100 text-green-700"
                }`}
              >
                {progressText}
              </p>
            </div>
            <div className="flex items-baseline gap-1 mb-3 relative z-10">
              <span className="text-4xl font-black text-[#16263F] leading-none">
                {currentCbm.toFixed(2)}
              </span>
              <span className="text-sm font-bold text-slate-400">
                / {maxCbm} CBM
              </span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden shadow-inner relative z-10">
              <div
                className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
                style={{ width: `${Math.min(percentFilled, 100)}%` }}
              />
            </div>
            <div className="flex justify-between mt-4 text-[10px] font-black text-[#16263F] uppercase tracking-widest border-t border-slate-200 pt-3 relative z-10">
              <span className="flex flex-col">
                <span className="text-slate-400 text-[8px] mb-0.5">BULTOS</span>
                {currentBultos} BLT
              </span>
              <span className="flex flex-col text-right">
                <span className="text-slate-400 text-[8px] mb-0.5">
                  PESO NETO
                </span>
                {currentWeight.toFixed(2)} KG
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
          <div className="lg:col-span-3 bg-white rounded-[2rem] border border-slate-200 shadow-sm flex flex-col h-full overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50">
              <h3 className="text-xs font-black text-[#16263F] uppercase tracking-widest flex items-center gap-2">
                <Box className="w-4 h-4 text-blue-500" /> Bodega (
                {pendingTasksList.length})
              </h3>
              <p className="text-[9px] text-slate-500 font-bold uppercase mt-1 leading-tight">
                Mueve RAs al plan de carga. Los pendientes se marcarán como
                Prioridad.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar bg-slate-50/30">
              {pendingTasksList.length === 0 ? (
                <div className="text-center p-6 text-slate-400 font-bold text-xs border-2 border-dashed border-slate-200 rounded-xl">
                  No hay órdenes en bodega para este cliente.
                </div>
              ) : (
                pendingTasksList
                  .slice()
                  .sort((a, b) => {
                    const diff = warehouseListRank(a) - warehouseListRank(b);
                    if (diff !== 0) return diff;
                    return getTaskCbm(b) - getTaskCbm(a);
                  })
                  .map((t) => (
                    <div
                      key={t.id}
                      onClick={() => handleToggleLoad(t.id)}
                      className={`p-3 rounded-xl border hover:shadow-md transition-all cursor-pointer group flex items-center justify-between ${
                        isAwaitingEntry(t)
                          ? "bg-red-50 border-red-200 hover:border-red-400"
                          : isInventoryComplete(t)
                            ? "bg-white border-slate-200 hover:border-blue-400"
                            : "bg-amber-50 border-amber-200 hover:border-amber-400"
                      }`}
                    >
                      <div className="w-full">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {isAwaitingEntry(t) ? (
                            <span className="text-[8px] font-black bg-red-600 text-white px-1.5 py-0.5 rounded uppercase tracking-widest animate-pulse flex items-center gap-1">
                              <AlertCircle size={10} /> PENDIENTE
                            </span>
                          ) : isInventoryComplete(t) ? (
                            <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" title="Inventario completo" />
                          ) : (
                            <span className="text-[8px] font-black bg-amber-500 text-white px-1.5 py-0.5 rounded uppercase tracking-widest flex items-center gap-1">
                              <Activity size={10} className="shrink-0" />
                              {t.status === "partial" ? "PARCIAL" : "EN CURSO"}
                            </span>
                          )}
                          <p className="text-base font-black text-[#16263F] leading-none">
                            RA: {t.ra}
                          </p>
                        </div>
                        <p className="text-[9px] font-bold text-slate-500 uppercase truncate mt-1">
                          {t.mainClient}
                        </p>
                        <div className="flex gap-2 mt-2 text-[9px] font-black text-[#16263F]">
                          <span className="bg-white border border-slate-200 px-1.5 py-0.5 rounded">
                            {getTaskCbm(t).toFixed(2)} CBM
                          </span>
                          <span className="bg-white border border-slate-200 px-1.5 py-0.5 rounded">
                            {isAwaitingEntry(t)
                              ? t.expectedBultos
                              : t.currentBultos ?? t.expectedBultos}{" "}
                            BLT
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors shrink-0 ml-2 ${
                          isAwaitingEntry(t)
                            ? "bg-red-100 text-red-500 group-hover:bg-red-600 group-hover:text-white"
                            : isInventoryComplete(t)
                              ? "bg-slate-100 text-slate-400 group-hover:bg-blue-600 group-hover:text-white"
                              : "bg-amber-100 text-amber-600 group-hover:bg-amber-600 group-hover:text-white"
                        }`}
                      >
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  ))
              )}
            </div>
          </div>

          <div className="lg:col-span-9 bg-white rounded-[2rem] border border-blue-200 shadow-lg flex flex-col h-full overflow-hidden relative">
            <div className="p-4 border-b border-slate-100 bg-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4 z-20">
              <div>
                <h3 className="text-lg font-black text-[#16263F] uppercase tracking-widest flex items-center gap-2">
                  Relación de Carga en Contenedor
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded uppercase text-[9px] font-black tracking-widest">
                    {loadedTasks.length} RAs
                  </span>
                  <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded uppercase text-[9px] font-black tracking-widest">
                    {detailedRows.length} Líneas
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 w-full md:w-auto">
                <button
                  type="button"
                  onClick={exportToExcel}
                  className="bg-[#107C41] hover:bg-[#0b5e31] text-white px-3 py-2 rounded-lg font-black flex items-center gap-2 transition-colors text-[10px] uppercase tracking-widest shadow-sm"
                >
                  <FileDown size={14} />
                  Excel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (loadedIds.length === 0) {
                      // eslint-disable-next-line no-alert
                      alert(
                        "⚠️ No hay carga en el contenedor para imprimir.",
                      );
                      return;
                    }
                    setIsPrinting(true);
                  }}
                  className="bg-[#16263F] hover:bg-black text-white px-3 py-2 rounded-lg font-black flex items-center gap-2 transition-colors text-[10px] uppercase tracking-widest shadow-sm"
                >
                  <Printer size={14} />
                  PDF
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDispatch}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-black flex items-center gap-2 transition-colors text-[10px] uppercase tracking-widest shadow-md"
                >
                  CONFIRMAR SALIDA <Check size={14} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto custom-scrollbar bg-slate-50/50">
              {loadedTasks.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                  <Box className="w-16 h-16 mb-4 opacity-30" />
                  <p className="font-bold text-lg text-slate-500">
                    Relación de carga vacía
                  </p>
                  <p className="text-sm mt-1">
                    Carga RAs desde la bodega (panel izquierdo).
                  </p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse min-w-[1000px]">
                  <thead className="bg-white text-slate-500 font-black uppercase text-[9px] tracking-widest sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="px-3 py-3 border-b border-slate-200 text-center w-10">
                        #
                      </th>
                      <th className="px-3 py-3 border-b border-slate-200">
                        R/A
                      </th>
                      <th className="px-3 py-3 border-b border-slate-200 text-center">
                        Parcial
                      </th>
                      <th className="px-3 py-3 border-b border-slate-200">
                        Compañía (Proveedor)
                      </th>
                      <th className="px-3 py-3 border-b border-slate-200">
                        Cliente (Expedidor)
                      </th>
                      <th className="px-3 py-3 border-b border-slate-200 text-center text-purple-600 bg-purple-50/50">
                        Bultos
                      </th>
                      <th className="px-3 py-3 border-b border-slate-200">
                        Marca
                      </th>
                      <th className="px-3 py-3 border-b border-slate-200 text-center">
                        Fecha
                      </th>
                      <th className="px-3 py-3 border-b border-slate-200 text-center bg-blue-50/50 text-blue-700">
                        CBM / CUB
                      </th>
                      <th className="px-3 py-3 border-b border-slate-200 text-center">
                        Peso(kg)
                      </th>
                      <th className="px-3 py-3 border-b border-slate-200 w-48">
                        Descripción
                      </th>
                      <th className="px-3 py-3 border-b border-slate-200 text-center">
                        X
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {detailedRows.map((row, i) => (
                      <tr
                        key={row.id}
                        className="hover:bg-blue-50/50 transition-colors group text-[10px] md:text-xs"
                      >
                        <td className="px-3 py-2.5 text-center font-bold text-slate-400">
                          {i + 1}
                        </td>
                        <td className="px-3 py-2.5 font-black text-[#16263F] whitespace-nowrap">
                          {row.ra}
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-500">
                          {row.partial}
                        </td>
                        <td className="px-3 py-2.5 font-bold uppercase truncate max-w-[120px]">
                          {row.provider}
                        </td>
                        <td className="px-3 py-2.5 font-bold uppercase truncate max-w-[120px] text-slate-600">
                          {row.subClient}
                        </td>
                        <td className="px-3 py-2.5 text-center font-black text-purple-800 bg-purple-50/30 text-sm">
                          {row.bultos}
                        </td>
                        <td className="px-3 py-2.5 font-bold uppercase text-slate-600 truncate max-w-[100px]">
                          {row.brand}
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-500">
                          {row.date}
                        </td>
                        <td className="px-3 py-2.5 text-center font-black text-blue-700 bg-blue-50/30">
                          {row.cbm}
                        </td>
                        <td className="px-3 py-2.5 text-center font-bold text-slate-700">
                          {row.weight}
                        </td>
                        <td
                          className="px-3 py-2.5 uppercase text-slate-500 truncate max-w-[180px]"
                          title={row.desc}
                        >
                          {row.desc.includes("PRIORIDAD") ? (
                            <span className="text-red-500 font-black">
                              {row.desc}
                            </span>
                          ) : (
                            row.desc
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleLoad(row.id.split("-")[0]!)}
                            className="w-5 h-5 rounded bg-red-50 text-red-500 flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
                          >
                            <X size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="bg-[#1E293B] p-4 text-white flex flex-wrap justify-between items-center gap-4 shrink-0 z-20">
              <div className="flex items-center gap-2">
                <Calculator className="w-5 h-5 text-blue-400" />
                <span className="text-xs font-black uppercase tracking-widest text-slate-300">
                  Resumen Final
                </span>
              </div>
              <div className="flex gap-4 md:gap-8 flex-wrap justify-end">
                <div className="text-right">
                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">
                    Total Bultos
                  </p>
                  <p className="text-lg font-black leading-none">
                    {currentBultos}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">
                    Total CBM
                  </p>
                  <p className="text-lg font-black text-blue-400 leading-none">
                    {currentCbm.toFixed(2)}
                  </p>
                </div>
                <div className="h-8 w-px bg-slate-700 mx-2 hidden md:block" />
                <div className="text-right">
                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">
                    Peso Neto
                  </p>
                  <p className="text-lg font-black leading-none">
                    {currentWeight.toFixed(2)}{" "}
                    <span className="text-[10px]">kg</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">
                    Tara
                  </p>
                  <p className="text-lg font-black text-slate-400 leading-none">
                    {(containerInfo.tare ??
                      capacityMap[containerInfo.type].tare).toFixed(2)}{" "}
                    <span className="text-[10px]">kg</span>
                  </p>
                </div>
                <div className="text-right bg-green-500/20 px-3 py-1 rounded-lg border border-green-500/30">
                  <p className="text-[8px] font-black text-green-300 uppercase tracking-widest mb-0.5">
                    Peso Total
                  </p>
                  <p className="text-xl font-black text-green-400 leading-none">
                    {(
                      currentWeight +
                      (containerInfo.tare ??
                        capacityMap[containerInfo.type].tare)
                    ).toFixed(2)}{" "}
                    <span className="text-[10px]">kg</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type ContainerManifestPrintViewProps = {
  containerInfo: ContainerInfo;
  loadedTasks: Task[];
  detailedRows: DetailedRow[];
  currentBultos: number;
  currentCbm: number;
  currentWeight: number;
  onBack: () => void;
};

export type ContainerManifestPrintViewPropsInternal = {
  containerInfo: ContainerInfo;
  loadedTasks: Task[];
  detailedRows: Array<
    Omit<DetailedRow, "ref"> & {
      ref?: string;
    }
  >;
  currentBultos: number;
  currentCbm: number;
  currentWeight: number;
  onBack: () => void;
};

function ContainerManifestPrintView({
  containerInfo,
  loadedTasks,
  detailedRows,
  currentBultos,
  currentCbm,
  currentWeight,
  onBack,
}: ContainerManifestPrintViewProps) {
  const tare =
    typeof containerInfo.tare === "number"
      ? containerInfo.tare
      : capacityMap[containerInfo.type]?.tare || 0;
  const grossWeight = currentWeight + tare;

  return (
    <div className="w-full min-h-screen bg-slate-100 flex flex-col items-center p-4 md:p-8 animate-fade print-wrapper">
      <div className="w-full max-w-[297mm] flex justify-between items-center mb-6 no-print bg-white p-4 rounded-xl shadow-sm">
        <button
          type="button"
          onClick={onBack}
          className="text-slate-500 font-bold flex items-center gap-2 hover:text-[#16263F]"
        >
          <ArrowLeft size={16} />
          Volver
        </button>
        <div className="flex gap-4 items-center">
          <span className="text-xs font-bold text-slate-400 flex items-center">
            Asegúrate de imprimir en formato Horizontal (Landscape)
          </span>
          <button
            type="button"
            onClick={() => window.print()}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg font-black shadow-md hover:bg-blue-700 flex items-center gap-2"
          >
            <Printer size={16} />
            Imprimir PDF
          </button>
        </div>
      </div>

      <div className="bg-white w-full max-w-[297mm] min-h-[210mm] p-[10mm] md:p-[15mm] shadow-2xl print-container">
        <div className="border-b-2 border-[#16263F] pb-4 mb-6 flex justify-between items-end">
          <div className="flex items-center gap-3">
            <div className="bg-[#16263F] p-3 rounded-xl">
              <Truck className="text-white w-8 h-8" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-[#16263F] tracking-tighter leading-none">
                ALDEPOSITOS
              </h1>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mt-1">
                Logística y Distribución
              </p>
            </div>
          </div>
          <div className="text-right">
            <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">
              Relación de Carga en Contenedor
            </h2>
            <p className="text-xs font-bold text-slate-500 mt-1">
              FECHA LLEGADA:{" "}
              {new Date(containerInfo.date).toLocaleDateString("es-PA")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-3 mb-6 bg-slate-50 p-4 rounded-xl border border-slate-200">
          <div>
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">
              Nº Consignación
            </p>
            <p className="font-bold text-slate-700 text-xs uppercase">
              {containerInfo.consignment || "N/A"}
            </p>
          </div>
          <div>
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">
              Contenedor
            </p>
            <p className="font-black text-[#16263F] text-sm uppercase">
              {containerInfo.number || "POR ASIGNAR"}
            </p>
          </div>
          <div>
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">
              Seguimiento
            </p>
            <p className="font-bold text-slate-700 text-xs uppercase">
              {containerInfo.bl || "N/A"}
            </p>
          </div>
          <div>
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">
              Sellos (1 y 2)
            </p>
            <p className="font-bold text-slate-700 text-xs uppercase">
              {containerInfo.seal1 || "-"} / {containerInfo.seal2 || "-"}
            </p>
          </div>
          <div>
            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">
              Cliente Principal
            </p>
            <p className="font-bold text-slate-700 text-xs uppercase truncate">
              {loadedTasks[0]?.mainClient || "VARIOS"}
            </p>
          </div>
        </div>

        <h3 className="text-[10px] font-black text-[#16263F] uppercase tracking-widest mb-2 border-b border-[#16263F] inline-block pb-1">
          Detalle de la Carga
        </h3>

        <table
          className="w-full text-left border-collapse border border-slate-200 mb-6"
          style={{ fontSize: "8px" }}
        >
          <thead className="bg-[#1E293B] text-white">
            <tr>
              <th className="px-2 py-2 border border-slate-600 text-center w-[3%]">
                #
              </th>
              <th className="px-2 py-2 border border-slate-600 w-[6%] text-center">
                R/A
              </th>
              <th className="px-2 py-2 border border-slate-600 w-[5%] text-center">
                PARCIAL
              </th>
              <th className="px-2 py-2 border border-slate-600 w-[15%]">
                COMPAÑÍA (PROV.)
              </th>
              <th className="px-2 py-2 border border-slate-600 w-[15%]">
                CLIENTE (EXP.)
              </th>
              <th className="px-2 py-2 border border-slate-600 text-center w-[6%] bg-[#6B21A8]">
                BULTOS
              </th>
              <th className="px-2 py-2 border border-slate-600 w-[10%]">
                MARCA
              </th>
              <th className="px-2 py-2 border border-slate-600 text-center w-[8%]">
                FECHA
              </th>
              <th className="px-2 py-2 border border-slate-600 text-center w-[7%] bg-[#2563EB]">
                CBM
              </th>
              <th className="px-2 py-2 border border-slate-600 text-center w-[7%]">
                PESO(KG)
              </th>
              <th className="px-2 py-2 border border-slate-600 w-[18%]">
                DESCRIPCIÓN
              </th>
            </tr>
          </thead>
          <tbody>
            {detailedRows.map((row, i) => (
              <tr
                key={row.id}
                className="even:bg-slate-50 border-b border-slate-200"
              >
                <td className="px-2 py-1.5 text-center font-bold text-slate-500">
                  {i + 1}
                </td>
                <td className="px-2 py-1.5 font-black text-center text-[#16263F]">
                  {row.ra}
                </td>
                <td className="px-2 py-1.5 text-center font-bold text-slate-600">
                  {row.partial}
                </td>
                <td className="px-2 py-1.5 font-bold uppercase truncate">
                  {row.provider}
                </td>
                <td className="px-2 py-1.5 font-bold uppercase truncate text-slate-600">
                  {row.subClient}
                </td>
                <td className="px-2 py-1.5 text-center font-black bg-purple-50 text-purple-900">
                  {row.bultos}
                </td>
                <td className="px-2 py-1.5 uppercase truncate text-slate-600">
                  {row.brand}
                </td>
                <td className="px-2 py-1.5 text-center text-slate-600">
                  {row.date}
                </td>
                <td className="px-2 py-1.5 text-center font-black text-blue-800 bg-blue-50">
                  {row.cbm}
                </td>
                <td className="px-2 py-1.5 text-center font-bold text-slate-600">
                  {row.weight}
                </td>
                <td className="px-2 py-1.5 uppercase truncate text-slate-600">
                  {row.desc}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end mt-4">
          <div className="w-64 border-2 border-[#16263F] rounded-xl overflow-hidden">
            <div className="bg-[#16263F] text-white text-[9px] font-black uppercase tracking-widest text-center py-2">
              Resumen Final
            </div>
            <div className="p-3 bg-slate-50 space-y-2">
              <div className="flex justify-between text-[10px]">
                <span className="font-bold text-slate-500 uppercase">
                  Total Bultos
                </span>
                <span className="font-black text-[#16263F]">
                  {currentBultos}
                </span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="font-bold text-slate-500 uppercase">
                  Total CBM
                </span>
                <span className="font-black text-blue-600">
                  {currentCbm.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="font-bold text-slate-500 uppercase">
                  Peso Neto
                </span>
                <span className="font-black text-[#16263F]">
                  {currentWeight.toFixed(2)} kg
                </span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="font-bold text-slate-500 uppercase">
                  Tara
                </span>
                <span className="font-black text-slate-400">
                  {tare} kg
                </span>
              </div>
              <div className="border-t border-slate-300 my-1 pt-2 flex justify-between text-xs">
                <span className="font-black text-green-700 uppercase">
                  Peso Total
                </span>
                <span className="font-black text-green-700">
                  {grossWeight.toFixed(2)} kg
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-2 gap-8 text-center">
          <div>
            <div className="border-t border-slate-400 w-48 mx-auto pt-2">
              <p className="text-[9px] font-black text-[#16263F] uppercase tracking-widest">
                Responsable de Cargue
              </p>
              <p className="text-[10px] text-slate-500 uppercase mt-1">
                {containerInfo.responsible || "Firma Autorizada"}
              </p>
            </div>
          </div>
          <div>
            <div className="border-t border-slate-400 w-48 mx-auto pt-2">
              <p className="text-[9px] font-black text-[#16263F] uppercase tracking-widest">
                Aprobado / Despachado
              </p>
              <p className="text-[10px] text-slate-500 uppercase mt-1">
                Operaciones Aldepositos
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

