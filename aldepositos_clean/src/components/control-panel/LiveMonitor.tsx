"use client";

import React, { useMemo, useState } from "react";
import { Activity, FolderOpen, Search, Trash2 } from "lucide-react";
import type { ControlPanelHome } from "@/components/control-panel/ControlPanelHome";

type Task = Parameters<typeof ControlPanelHome>[0]["tasks"][number];

type LiveMonitorProps = {
  tasks: Task[];
  onDeleteTask: (id: string) => void;
};

export function LiveMonitor({ tasks, onDeleteTask }: LiveMonitorProps) {
  const [clientFilter, setClientFilter] = useState("Todos");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "completed" | "dispatched" | "priority"
  >("all");
  const [searchTerm, setSearchTerm] = useState("");

  const filterByStatus = (task: Task) => {
    if (statusFilter === "active") return task.status !== "completed";
    if (statusFilter === "completed") return task.status === "completed";
    if (statusFilter === "dispatched") return task.dispatched === true;
    if (statusFilter === "priority") {
      return task.status === "pending" && task.containerDraft === true;
    }
    return true;
  };

  const filterBySearch = (task: Task) => {
    const needle = searchTerm.trim().toLowerCase();
    if (!needle) return true;
    return (
      String(task.ra || "")
        .toLowerCase()
        .includes(needle) ||
      String(task.provider || "")
        .toLowerCase()
        .includes(needle) ||
      String(task.brand || "")
        .toLowerCase()
        .includes(needle) ||
      String(task.mainClient || "")
        .toLowerCase()
        .includes(needle)
    );
  };

  const filteredTasks = useMemo(
    () => tasks.filter((t) => filterByStatus(t) && filterBySearch(t)),
    [tasks, statusFilter, searchTerm],
  );

  const groupedTasks = filteredTasks.reduce<Record<string, Task[]>>(
    (groups, task) => {
      const client = task.mainClient || "Sin Cliente";
      if (!groups[client]) groups[client] = [];
      groups[client].push(task);
      return groups;
    },
    {},
  );

  const groupedAllTasks = tasks.reduce<Record<string, Task[]>>((groups, task) => {
    const client = task.mainClient || "Sin Cliente";
    if (!groups[client]) groups[client] = [];
    groups[client].push(task);
    return groups;
  }, {});

  const clients = Object.keys(groupedAllTasks);
  const totalTasks = filteredTasks.length;

  const displayedTasks =
    clientFilter !== "Todos" && clients.includes(clientFilter)
      ? filteredTasks.filter((t) => (t.mainClient || "Sin Cliente") === clientFilter)
      : filteredTasks;

  const totals = useMemo(() => {
    const completed = tasks.filter((t) => t.status === "completed").length;
    const active = tasks.filter((t) => t.status !== "completed").length;
    const dispatched = tasks.filter((t) => t.dispatched === true).length;
    const priority = tasks.filter(
      (t) => t.status === "pending" && t.containerDraft === true,
    ).length;
    return { completed, active, dispatched, priority };
  }, [tasks]);

  return (
    <div className="w-full h-full min-h-0 flex flex-col animate-fade">
      <div className="max-w-6xl mx-auto w-full h-full min-h-0 flex flex-col">
        <div className="shrink-0 space-y-6 md:space-y-8">
          <h2 className="text-xl md:text-3xl font-black text-[#16263F] flex items-center gap-2 md:gap-3 px-2 md:px-0">
            <Activity className="text-red-500 w-5 h-5 md:w-8 md:h-8 animate-pulse" />{" "}
            MONITOREO DE ÓRDENES
          </h2>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 px-2 md:px-0">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                Activas
              </p>
              <p className="text-2xl font-black text-[#16263F] mt-1">
                {totals.active}
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                Completadas
              </p>
              <p className="text-2xl font-black text-green-700 mt-1">
                {totals.completed}
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                En Contenedor
              </p>
              <p className="text-2xl font-black text-amber-700 mt-1">
                {totals.priority}
              </p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                Despachadas
              </p>
              <p className="text-2xl font-black text-blue-700 mt-1">
                {totals.dispatched}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-3 md:p-4 shadow-sm mx-2 md:mx-0">
            <div className="flex flex-col lg:flex-row gap-3 md:gap-4">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por RA, proveedor, marca o cliente"
                  className="w-full h-10 pl-10 pr-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-blue-500 outline-none text-sm font-bold text-[#16263F]"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: "all", label: "Todos" },
                  { id: "active", label: "Activas" },
                  { id: "completed", label: "Completadas" },
                  { id: "priority", label: "En Contenedor" },
                  { id: "dispatched", label: "Despachadas" },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      setStatusFilter(
                        item.id as
                          | "all"
                          | "active"
                          | "completed"
                          | "dispatched"
                          | "priority",
                      )
                    }
                    className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest border transition-colors ${
                      statusFilter === item.id
                        ? "bg-[#16263F] text-white border-[#16263F]"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {clients.length > 0 && (
            <div
              className="flex gap-2 md:gap-3 overflow-x-auto pb-2 px-2 md:px-0"
              style={{ scrollbarWidth: "none" }}
            >
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
                  {c} ({groupedAllTasks[c].length})
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 pb-24 mt-4 md:mt-6">
          {displayedTasks.length === 0 ? (
            <div className="bg-white p-8 md:p-12 rounded-3xl border-4 border-dashed border-slate-200 text-center font-bold text-slate-400 text-sm md:text-base">
              Sin datos registrados
            </div>
          ) : (
            <div className="bg-white rounded-[1.5rem] md:rounded-[2rem] shadow-sm md:shadow-lg overflow-hidden mb-6 md:mb-8 border-l-4 border-l-blue-600 border border-slate-200">
              <div className="p-4 md:p-6 bg-slate-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200">
                <div className="flex items-center gap-3 md:gap-4 w-full md:w-auto">
                  <div className="bg-[#16263F] p-2 md:p-2.5 rounded-lg md:rounded-xl text-white shadow-sm">
                    <FolderOpen className="w-4 h-4 md:w-5 md:h-5 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base md:text-xl font-black text-[#16263F] uppercase truncate">
                      {clientFilter === "Todos" ? "TODOS LOS CLIENTES" : clientFilter}
                    </h3>
                    <p className="text-[9px] md:text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      {displayedTasks.length} órdenes
                    </p>
                  </div>
                </div>
                <div className="w-full md:w-64 bg-white md:bg-transparent p-3 md:p-0 rounded-lg md:rounded-none border md:border-none border-slate-100">
                  <div className="flex justify-between items-center mb-1 md:mb-2">
                    <span className="text-[9px] md:text-[10px] font-black text-[#16263F] uppercase tracking-widest">
                      Avance Total
                    </span>
                    <span className="text-xs font-black text-[#16263F]">
                      {(() => {
                        const totalExpected = displayedTasks.reduce(
                          (a, b) =>
                            a + (b.originalExpectedBultos ?? b.expectedBultos ?? 0),
                          0,
                        );
                        const totalCurrent = displayedTasks.reduce(
                          (a, b) => a + (b.currentBultos ?? 0),
                          0,
                        );
                        return totalExpected > 0
                          ? Math.round((totalCurrent / totalExpected) * 100)
                          : 0;
                      })()}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-1.5 md:h-2">
                    <div
                      className="bg-green-500 h-1.5 md:h-2 rounded-full"
                      style={{
                        width: `${(() => {
                          const totalExpected = displayedTasks.reduce(
                            (a, b) =>
                              a + (b.originalExpectedBultos ?? b.expectedBultos ?? 0),
                            0,
                          );
                          const totalCurrent = displayedTasks.reduce(
                            (a, b) => a + (b.currentBultos ?? 0),
                            0,
                          );
                          return totalExpected > 0
                            ? Math.round((totalCurrent / totalExpected) * 100)
                            : 0;
                        })()}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto border-t border-slate-100">
                <table className="w-full text-sm text-left min-w-[980px] md:min-w-full">
                  <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm text-slate-500 uppercase text-[9px] md:text-[10px] font-black tracking-widest border-b border-slate-200 shadow-[0_1px_0_0_rgba(226,232,240,0.8)]">
                    <tr>
                      <th className="px-4 md:px-6 py-3 md:py-4">Módulo</th>
                      <th className="px-4 md:px-6 py-3 md:py-4">RA #</th>
                      <th className="px-4 md:px-6 py-3 md:py-4 min-w-[190px]">
                        Cliente
                      </th>
                      <th className="px-4 md:px-6 py-3 md:py-4 min-w-[180px]">
                        Proveedor / Marca
                      </th>
                      <th className="px-4 md:px-6 py-3 md:py-4 text-center">
                        Progreso
                      </th>
                      <th className="px-4 md:px-6 py-3 md:py-4 text-center">
                        Estado
                      </th>
                      <th className="px-4 md:px-6 py-3 md:py-4 text-center">
                        Acción
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {displayedTasks.map((t) => {
                      const taskExpected =
                        t.originalExpectedBultos ?? t.expectedBultos ?? 0;
                      const taskPercent =
                        taskExpected > 0
                          ? Math.round(
                              ((t.currentBultos ?? 0) / taskExpected) * 100,
                            )
                          : 0;
                      const moduleName =
                        t.type === "quick"
                          ? "Rápido"
                          : t.type === "detailed"
                            ? "Detalle"
                            : "Aérea";
                      const statusLabel =
                        t.dispatched === true
                          ? "Despachado"
                          : t.status === "completed"
                            ? "Completado"
                            : t.containerDraft === true
                              ? "En contenedor"
                              : "En proceso";
                      const statusClass =
                        t.dispatched === true
                          ? "bg-blue-100 text-blue-700"
                          : t.status === "completed"
                            ? "bg-green-100 text-green-700"
                            : t.containerDraft === true
                              ? "bg-amber-100 text-amber-700"
                              : "bg-slate-100 text-slate-700";
                      return (
                        <tr
                          key={t.id}
                          className="hover:bg-blue-50/30 transition-colors"
                        >
                          <td className="px-4 md:px-6 py-3 md:py-5 font-black text-slate-400 text-[9px] uppercase tracking-widest">
                            {moduleName}
                          </td>
                          <td className="px-4 md:px-6 py-3 md:py-5 font-black text-[#16263F] text-sm md:text-base">
                            {t.ra}
                          </td>
                          <td className="px-4 md:px-6 py-3 md:py-5">
                            <p className="font-black text-[10px] md:text-xs text-[#16263F] uppercase whitespace-normal break-words leading-tight">
                              {t.mainClient || "Sin cliente"}
                            </p>
                            <p className="text-[8px] md:text-[9px] text-slate-400 font-bold uppercase">
                              {t.subClient || "N/A"}
                            </p>
                          </td>
                          <td className="px-4 md:px-6 py-3 md:py-5">
                            <p
                              className="font-bold text-slate-700 text-[10px] md:text-xs uppercase whitespace-normal break-words leading-tight"
                              title={t.provider}
                            >
                              {t.provider}
                            </p>
                            <p
                              className="text-[8px] md:text-[9px] text-slate-400 font-bold uppercase tracking-tighter whitespace-normal break-words leading-tight mt-0.5"
                              title={t.brand}
                            >
                              {t.brand}
                            </p>
                          </td>
                          <td className="px-4 md:px-6 py-3 md:py-5 w-32 md:w-40 text-center">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-slate-200 rounded-full h-1.5 md:h-2">
                                <div
                                  className="bg-blue-600 h-1.5 md:h-2 rounded-full"
                                  style={{ width: `${taskPercent}%` }}
                                />
                              </div>
                              <span className="text-[9px] md:text-[10px] font-black w-8 md:w-10 text-right text-[#16263F]">
                                {taskPercent}%
                              </span>
                            </div>
                          </td>
                          <td className="px-4 md:px-6 py-3 md:py-5 text-center">
                            <span
                              className={`px-2 md:px-3 py-1 rounded-full text-[8px] md:text-[9px] font-black uppercase ${statusClass}`}
                            >
                              {statusLabel}
                            </span>
                          </td>
                          <td className="px-4 md:px-6 py-3 md:py-5 text-center">
                            <button
                              type="button"
                              onClick={() => onDeleteTask(t.id)}
                              className="p-1.5 md:p-2 bg-red-50 hover:bg-red-500 text-red-500 hover:text-white rounded-lg md:rounded-xl transition-all shadow-sm"
                              title={`Eliminar RA ${t.ra}`}
                            >
                              <Trash2 className="w-3 h-3 md:w-4 md:h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
