 "use client";

import React, { useState } from "react";
import { ArrowLeft, Edit, PackageSearch, Printer, Truck } from "lucide-react";
import type { ControlPanelHome } from "@/components/control-panel/ControlPanelHome";
import type { ContainerManifestPrintViewPropsInternal } from "./DispatchEntry";

type Task = Parameters<typeof ControlPanelHome>[0]["tasks"][number];

type ContainerReportsModuleProps = {
  tasks: Task[];
  onEditContainer: (container: {
    info: NonNullable<Task["dispatchInfo"]>;
    tasks: Task[];
  }) => void;
};

type ContainerGroup = {
  id: string;
  info: NonNullable<Task["dispatchInfo"]>;
  tasks: Task[];
};

const capacityMap = {
  "20": { name: "Contenedor 20'", maxCbm: 28, tare: 2300 },
  "40": { name: "Contenedor 40'", maxCbm: 56, tare: 3900 },
  furgon: { name: "Contenedor 40' HQ", maxCbm: 70, tare: 0 },
} as const;

export function ContainerReportsModule({
  tasks,
  onEditContainer,
}: ContainerReportsModuleProps) {
  const dispatchedTasks = tasks.filter(
    (t) => t.dispatched && t.dispatchInfo,
  ) as Task[];

  const [selectedContainer, setSelectedContainer] =
    useState<ContainerGroup | null>(null);

  const containersObj: Record<string, ContainerGroup> = dispatchedTasks.reduce(
    (acc, t) => {
      const info = t.dispatchInfo!;
      const key = info.number || `SIN_NUMERO_${info.date}`;
      if (!acc[key]) {
        acc[key] = { id: key, info, tasks: [] };
      }
      acc[key].tasks.push(t);
      return acc;
    },
    {} as Record<string, ContainerGroup>,
  );

  const containersList = Object.values(containersObj).sort(
    (a, b) =>
      new Date(b.info.date).getTime() - new Date(a.info.date).getTime(),
  );

  if (selectedContainer) {
    const loadedTasks = selectedContainer.tasks;
    const currentCbm = loadedTasks.reduce(
      (sum, t) => sum + (parseFloat(String(t.expectedCbm)) || 0),
      0,
    );
    const currentWeight = loadedTasks.reduce(
      (sum, t) => sum + (parseFloat(String(t.expectedWeight)) || 0),
      0,
    );
    const currentBultos = loadedTasks.reduce(
      (sum, t) =>
        sum +
        (parseInt(String(t.currentBultos ?? t.expectedBultos), 10) || 0),
      0,
    );

    const detailedRows = getDetailedRowsForPrint(
      loadedTasks,
      selectedContainer.info.date,
    );

    return (
      <ContainerManifestPrintView
        containerInfo={selectedContainer.info}
        loadedTasks={loadedTasks}
        detailedRows={detailedRows}
        currentBultos={currentBultos}
        currentCbm={currentCbm}
        currentWeight={currentWeight}
        onBack={() => setSelectedContainer(null)}
      />
    );
  }

  return (
    <div className="w-full h-full flex flex-col animate-fade relative">
      <div className="max-w-6xl mx-auto w-full flex flex-col h-full">
        <div className="shrink-0 space-y-4 md:space-y-6 mb-4 md:mb-6 px-2 md:px-0">
          <h2 className="text-xl md:text-3xl font-black text-[#16263F] flex items-center gap-2 md:gap-3">
            <PackageSearch className="text-blue-600 w-5 h-5 md:w-8 md:h-8" />{" "}
            REPORTES DE CONTENEDORES
          </h2>
          <p className="text-sm font-bold text-slate-500">
            Historial de cargas completadas y despachadas desde la bodega.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-24">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {containersList.length === 0 ? (
              <div className="col-span-full bg-white p-12 rounded-[2rem] border border-slate-200 text-center font-bold text-slate-400">
                Aún no se han despachado contenedores.
              </div>
            ) : (
              containersList.map((c) => {
                const totalCbm = c.tasks.reduce(
                  (s, t) => s + (parseFloat(String(t.expectedCbm)) || 0),
                  0,
                );
                const totalBultos = c.tasks.reduce(
                  (s, t) =>
                    s +
                    (parseInt(
                      String(t.currentBultos ?? t.expectedBultos),
                      10,
                    ) || 0),
                  0,
                );
                return (
                  <div
                    key={c.id}
                    className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm hover:shadow-lg transition-all flex flex-col justify-between group"
                  >
                    <div className="border-b border-slate-100 pb-4 mb-4">
                      <div className="flex justify-between items-start mb-2">
                        <div className="bg-blue-50 text-blue-600 p-2 rounded-xl">
                          <Truck size={20} />
                        </div>
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                          {new Date(c.info.date).toLocaleDateString("es-PA")}
                        </span>
                      </div>
                      <h3 className="text-2xl font-black text-[#16263F] uppercase tracking-tighter truncate">
                        {c.info.number || "SIN NÚMERO"}
                      </h3>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                        RESP: {c.info.responsible || "N/A"}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mb-4">
                      <div className="bg-slate-50 p-2 rounded-xl text-center">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">
                          RAs
                        </p>
                        <p className="text-sm font-black text-[#16263F]">
                          {c.tasks.length}
                        </p>
                      </div>
                      <div className="bg-slate-50 p-2 rounded-xl text-center">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">
                          Bultos
                        </p>
                        <p className="text-sm font-black text-[#16263F]">
                          {totalBultos}
                        </p>
                      </div>
                      <div className="bg-blue-50 p-2 rounded-xl text-center">
                        <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest mb-0.5">
                          CBM
                        </p>
                        <p className="text-sm font-black text-blue-700">
                          {totalCbm.toFixed(1)}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedContainer(c)}
                        className="flex-1 bg-slate-50 hover:bg-[#16263F] text-slate-600 hover:text-white py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
                      >
                        Ver PDF <ArrowLeft size={14} className="rotate-180" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditContainer(c)}
                        className="flex-1 bg-orange-50 hover:bg-orange-500 text-orange-600 hover:text-white py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
                      >
                        Editar <Edit size={14} />
                      </button>
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

function getDetailedRowsForPrint(tasks: Task[], fallbackDate: string) {
  const rows: {
    id: string;
    ra: string;
    partial: string;
    provider: string;
    subClient: string;
    brand: string;
    date: string;
    bultos: number;
    weight: string;
    cbm: string;
    desc: string;
  }[] = [];

  tasks.forEach((t) => {
    if (t.measureData && t.measureData.length > 0) {
      t.measureData.forEach((m: any, idx: number) => {
        const bultos = parseFloat(String(m.bultos ?? 0)) || 0;
        const pesoPorBulto =
          parseFloat(String(m.pesoPorBulto ?? 0)) || 0;
        const l = parseFloat(String(m.l ?? 0)) || 0;
        const w = parseFloat(String(m.w ?? 0)) || 0;
        const h = parseFloat(String(m.h ?? 0)) || 0;
        const weight = bultos * pesoPorBulto;
        const cbm = ((l * w * h) / 1_000_000) * bultos;

        rows.push({
          id: `${t.id}-${idx}`,
          ra: t.ra,
          partial: t.status === "partial" ? "SÍ" : "NO",
          provider: t.provider || "N/A",
          subClient: t.subClient || "N/A",
          brand: t.brand || "N/A",
          date: t.date || fallbackDate,
          bultos,
          weight: weight.toFixed(2),
          cbm: cbm.toFixed(2),
          desc: m.descripcion || "Sin descripción",
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
        date: t.date || fallbackDate,
        bultos: t.currentBultos || t.expectedBultos,
        weight: String(t.expectedWeight),
        cbm: String(t.expectedCbm),
        desc: t.notes || "Carga General (Resumida)",
      });
    }
  });

  return rows;
}

function ContainerManifestPrintView({
  containerInfo,
  loadedTasks,
  detailedRows,
  currentBultos,
  currentCbm,
  currentWeight,
  onBack,
}: ContainerManifestPrintViewPropsInternal) {
  const defaultTare =
    capacityMap[
      (containerInfo.type as keyof typeof capacityMap) || "40"
    ]?.tare || 0;
  const tare = typeof containerInfo.tare === "number" ? containerInfo.tare : defaultTare;
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
              B/L
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

