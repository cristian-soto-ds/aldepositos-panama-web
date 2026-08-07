"use client";

/**
 * Réplica Reportes — Inventario parcial (RA / contenedor / EN ALMACÉN).
 * Admin asigna + nombre contenedor; inventariador solo marca lo que queda en bodega.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Boxes,
  Check,
  Download,
  FileSpreadsheet,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  SplitSquareVertical,
  Truck,
  Warehouse,
  X,
} from "lucide-react";
import type { Task } from "@/lib/types/task";
import type { AppRole } from "@/lib/userRole";
import { formatRaFieldLabel } from "@/lib/collectionOrderToTask";
import { fetchTaskById } from "@/lib/supabase";
import { measureDataLooksEmpty } from "@/lib/taskListSlim";
import { downloadPartialReportExcel } from "@/lib/exportPartialReportExcel";
import {
  formatPartialKpis,
  measureRowKey,
  sanitizeWarehouseBultosMap,
  splitInventoryPartial,
  type PartialMeasureRow,
} from "@/lib/inventoryPartialSplit";
import {
  createPendingPartialJob,
  deleteInventoryPartial,
  fetchInventoryPartials,
  filterPartialsForInventariador,
  upsertInventoryPartial,
  type InventoryPartialJob,
} from "@/lib/inventoryPartials";

type PartialReportsModuleProps = {
  tasks: Task[];
  userRole: AppRole;
  userEmail?: string | null;
  userDisplayName?: string | null;
};

type ListTab = "pendientes" | "completados" | "asignar";

function normalizeRaQuery(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/^RA-?/i, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function statusLabel(status: InventoryPartialJob["status"]): string {
  switch (status) {
    case "pending":
      return "Pendiente";
    case "in_progress":
      return "En curso";
    case "completed":
      return "Completado";
    case "rectification":
      return "Rectificación";
    default:
      return status;
  }
}

function statusBadgeClass(status: InventoryPartialJob["status"]): string {
  switch (status) {
    case "pending":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200";
    case "in_progress":
      return "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200";
    case "completed":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200";
    case "rectification":
      return "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function rowRef(row: PartialMeasureRow): string {
  const r = String(row.referencia ?? row.reference ?? "").trim();
  return r || "Sin ref.";
}

function rowBultos(row: PartialMeasureRow): number {
  const n = parseFloat(String(row.bultos ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function PartialReportsModule({
  tasks,
  userRole,
  userEmail = null,
  userDisplayName = null,
}: PartialReportsModuleProps) {
  const isAdmin = userRole === "admin";
  const [jobs, setJobs] = useState<InventoryPartialJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [listTab, setListTab] = useState<ListTab>(
    isAdmin ? "pendientes" : "pendientes",
  );
  const [raQuery, setRaQuery] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [hydratedTask, setHydratedTask] = useState<Task | null>(null);
  const [hydrateBusy, setHydrateBusy] = useState(false);
  const [warehouseMap, setWarehouseMap] = useState<Record<string, number>>({});
  const [saveBusy, setSaveBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [assignRaQuery, setAssignRaQuery] = useState("");
  const [assignContainer, setAssignContainer] = useState("");
  const [assignTaskId, setAssignTaskId] = useState<string | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const [editContainerId, setEditContainerId] = useState<string | null>(null);
  const [editContainerName, setEditContainerName] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchInventoryPartials();
      setJobs(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const completedInventoryTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.status === "completed" ||
          t.status === "partial" ||
          ((t.measureData?.length ?? 0) > 0 && t.status === "rectification"),
      ),
    [tasks],
  );

  const visibleJobs = useMemo(() => {
    const q = normalizeRaQuery(raQuery);
    let list = isAdmin ? jobs : filterPartialsForInventariador(jobs);
    if (listTab === "pendientes") {
      list = list.filter(
        (j) =>
          j.status === "pending" ||
          j.status === "in_progress" ||
          j.status === "rectification",
      );
    } else if (listTab === "completados") {
      list = list.filter((j) => j.status === "completed");
    }
    if (q) {
      list = list.filter((j) => normalizeRaQuery(j.ra).includes(q));
    }
    return list;
  }, [jobs, isAdmin, listTab, raQuery]);

  const activeJob = useMemo(
    () => jobs.find((j) => j.id === activeJobId) ?? null,
    [jobs, activeJobId],
  );

  const assignCandidates = useMemo(() => {
    const q = normalizeRaQuery(assignRaQuery);
    const already = new Set(
      jobs
        .filter((j) => j.status !== "completed")
        .map((j) => j.taskId),
    );
    return completedInventoryTasks
      .filter((t) => !already.has(t.id))
      .filter((t) => !q || normalizeRaQuery(t.ra).includes(q))
      .slice(0, 40);
  }, [completedInventoryTasks, jobs, assignRaQuery]);

  useEffect(() => {
    if (!activeJob) {
      setHydratedTask(null);
      setWarehouseMap({});
      return;
    }
    let cancelled = false;
    setHydrateBusy(true);
    void (async () => {
      try {
        const local = tasks.find((t) => t.id === activeJob.taskId);
        let task = local ?? null;
        if (!task || measureDataLooksEmpty(task.measureData)) {
          task = (await fetchTaskById(activeJob.taskId)) ?? task;
        }
        if (cancelled || !task) return;
        setHydratedTask(task);
        setWarehouseMap(
          sanitizeWarehouseBultosMap(task, activeJob.warehouseBultosByRowId),
        );
      } finally {
        if (!cancelled) setHydrateBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeJob, tasks]);

  const splitPreview = useMemo(() => {
    if (!hydratedTask) return null;
    return splitInventoryPartial(
      hydratedTask,
      sanitizeWarehouseBultosMap(hydratedTask, warehouseMap),
    );
  }, [hydratedTask, warehouseMap]);

  const openJob = (job: InventoryPartialJob) => {
    if (!isAdmin && job.status === "completed") return;
    setActiveJobId(job.id);
  };

  const setRowWarehouse = (key: string, value: number, max: number) => {
    const n = Math.max(0, Math.min(max, Math.round(value)));
    setWarehouseMap((prev) => ({ ...prev, [key]: n }));
  };

  const persistProgress = async (
    status: InventoryPartialJob["status"],
    complete = false,
  ) => {
    if (!activeJob || !hydratedTask) return;
    setSaveBusy(true);
    try {
      const map = sanitizeWarehouseBultosMap(hydratedTask, warehouseMap);
      const now = new Date().toISOString();
      const next: InventoryPartialJob = {
        ...activeJob,
        warehouseBultosByRowId: map,
        status: complete ? "completed" : status,
        containerName: activeJob.containerName,
        ...(complete
          ? {
              completedAt: now,
              completedBy: {
                email: userEmail ?? undefined,
                displayName: userDisplayName ?? undefined,
                at: now,
              },
            }
          : {}),
      };
      const saved = await upsertInventoryPartial(next);
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === saved.id);
        if (idx < 0) return [saved, ...prev];
        const copy = [...prev];
        copy[idx] = saved;
        return copy;
      });
      if (complete && !isAdmin) {
        setActiveJobId(null);
      } else {
        setActiveJobId(saved.id);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setSaveBusy(false);
    }
  };

  const handleAssign = async () => {
    if (!assignTaskId || !assignContainer.trim()) {
      alert("Elegí un RA y escribí el nombre del contenedor (ej. LG-103).");
      return;
    }
    const task = completedInventoryTasks.find((t) => t.id === assignTaskId);
    if (!task) return;
    setAssignBusy(true);
    try {
      const job = createPendingPartialJob({
        taskId: task.id,
        ra: task.ra,
        containerName: assignContainer.trim().toUpperCase(),
      });
      const saved = await upsertInventoryPartial(job);
      setJobs((prev) => [saved, ...prev.filter((j) => j.id !== saved.id)]);
      setAssignTaskId(null);
      setAssignContainer("");
      setListTab("pendientes");
      setActiveJobId(saved.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "No se pudo asignar.");
    } finally {
      setAssignBusy(false);
    }
  };

  const handleDownload = async (job: InventoryPartialJob) => {
    setDownloadBusy(true);
    try {
      let task = tasks.find((t) => t.id === job.taskId) ?? null;
      if (!task || measureDataLooksEmpty(task.measureData)) {
        task = await fetchTaskById(job.taskId);
      }
      if (!task) throw new Error("No se encontró el RA.");
      await downloadPartialReportExcel({
        task,
        containerName: job.containerName,
        warehouseBultosByRowId: job.warehouseBultosByRowId,
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "No se pudo descargar el Excel.");
    } finally {
      setDownloadBusy(false);
    }
  };

  const handleSaveContainerName = async (job: InventoryPartialJob) => {
    const name = editContainerName.trim().toUpperCase();
    if (!name) return;
    const saved = await upsertInventoryPartial({
      ...job,
      containerName: name,
    });
    setJobs((prev) => prev.map((j) => (j.id === saved.id ? saved : j)));
    setEditContainerId(null);
  };

  const handleSendRectification = async (job: InventoryPartialJob) => {
    const saved = await upsertInventoryPartial({
      ...job,
      status: "rectification",
      completedAt: undefined,
      completedBy: undefined,
    });
    setJobs((prev) => prev.map((j) => (j.id === saved.id ? saved : j)));
  };

  // ─── Vista de trabajo (marcar EN ALMACÉN) ─────────────────────────────
  if (activeJob) {
    const rows = (hydratedTask?.measureData || []) as PartialMeasureRow[];
    const kpiWh = splitPreview
      ? formatPartialKpis(splitPreview.warehouseTotals)
      : null;
    const kpiLd = splitPreview
      ? formatPartialKpis(splitPreview.loadedTotals)
      : null;
    const kpiFull = splitPreview
      ? formatPartialKpis(splitPreview.fullTotals)
      : null;
    const inventariadorLocked =
      !isAdmin && activeJob.status === "completed";

    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className="shrink-0 border-b border-slate-200 bg-white px-3 py-3 dark:border-slate-700 dark:bg-slate-900 sm:px-4">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => setActiveJobId(null)}
              className="mt-0.5 rounded-lg border border-slate-200 p-2 text-slate-600 dark:border-slate-600 dark:text-slate-300"
              aria-label="Volver"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Inventario parcial
              </p>
              <h2 className="truncate text-lg font-black text-[#16263F] dark:text-slate-100">
                {formatRaFieldLabel(activeJob.ra)}
              </h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-black uppercase text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
                  <Truck className="h-3 w-3" />
                  {activeJob.containerName}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${statusBadgeClass(activeJob.status)}`}
                >
                  {statusLabel(activeJob.status)}
                </span>
              </p>
              {hydratedTask ? (
                <p className="mt-1 truncate text-[11px] text-slate-500">
                  {hydratedTask.mainClient} · {hydratedTask.provider}
                </p>
              ) : null}
            </div>
          </div>

          {!inventariadorLocked ? (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
              Marcá solo los bultos que <strong>quedan en bodega</strong>. Lo
              cargado al contenedor se calcula solo. El nombre del contenedor lo
              define administración.
            </p>
          ) : null}

          {kpiFull && kpiWh && kpiLd ? (
            <div className="mt-3 grid grid-cols-3 gap-2">
              <KpiMini
                icon={<Package className="h-3.5 w-3.5" />}
                label="RA completo"
                bultos={kpiFull.bultos}
                weight={kpiFull.weight}
                cbm={kpiFull.cbm}
              />
              <KpiMini
                icon={<Truck className="h-3.5 w-3.5" />}
                label={activeJob.containerName}
                bultos={kpiLd.bultos}
                weight={kpiLd.weight}
                cbm={kpiLd.cbm}
                tone="sky"
              />
              <KpiMini
                icon={<Warehouse className="h-3.5 w-3.5" />}
                label="EN ALMACÉN"
                bultos={kpiWh.bultos}
                weight={kpiWh.weight}
                cbm={kpiWh.cbm}
                tone="emerald"
              />
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
          {hydrateBusy ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm font-bold text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Cargando líneas…
            </div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm font-bold text-slate-500">
              Este RA no tiene líneas de medida.
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((row, index) => {
                const key = measureRowKey(row, index);
                const max = rowBultos(row);
                if (max <= 0) return null;
                const wh = warehouseMap[key] ?? 0;
                const loaded = Math.max(0, max - wh);
                return (
                  <li
                    key={key}
                    className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-[#16263F] dark:text-slate-100">
                          {rowRef(row)}
                        </p>
                        <p className="text-[10px] font-semibold text-slate-500">
                          Original {max} bult
                          {max === 1 ? "o" : "os"}
                          {row.l || row.w || row.h
                            ? ` · ${row.l ?? "—"}×${row.w ?? "—"}×${row.h ?? "—"}`
                            : ""}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        #{index + 1}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      <label className="flex min-w-[8rem] flex-1 flex-col gap-1">
                        <span className="text-[9px] font-black uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                          Quedan en bodega
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={max}
                          step={1}
                          disabled={inventariadorLocked || saveBusy}
                          value={wh}
                          onChange={(e) =>
                            setRowWarehouse(
                              key,
                              parseFloat(e.target.value) || 0,
                              max,
                            )
                          }
                          className="w-full rounded-xl border-2 border-emerald-300 bg-emerald-50/80 px-3 py-2.5 text-center text-lg font-black tabular-nums text-emerald-900 outline-none focus:border-emerald-500 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
                        />
                      </label>
                      <div className="flex flex-col gap-1 rounded-xl border border-sky-200 bg-sky-50/80 px-3 py-2 dark:border-sky-900 dark:bg-sky-950/40">
                        <span className="text-[9px] font-black uppercase tracking-wide text-sky-700 dark:text-sky-300">
                          Van a {activeJob.containerName}
                        </span>
                        <span className="text-lg font-black tabular-nums text-sky-900 dark:text-sky-100">
                          {loaded}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          disabled={inventariadorLocked || saveBusy}
                          onClick={() => setRowWarehouse(key, max, max)}
                          className="rounded-lg border border-emerald-300 px-2 py-1 text-[9px] font-black uppercase text-emerald-800 dark:border-emerald-800 dark:text-emerald-200"
                        >
                          Todo bodega
                        </button>
                        <button
                          type="button"
                          disabled={inventariadorLocked || saveBusy}
                          onClick={() => setRowWarehouse(key, 0, max)}
                          className="rounded-lg border border-sky-300 px-2 py-1 text-[9px] font-black uppercase text-sky-800 dark:border-sky-800 dark:text-sky-200"
                        >
                          Todo carga
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer className="shrink-0 border-t border-slate-200 bg-white/95 p-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:p-4">
          <div className="flex flex-wrap gap-2">
            {!inventariadorLocked ? (
              <>
                <button
                  type="button"
                  disabled={saveBusy || hydrateBusy}
                  onClick={() =>
                    void persistProgress(
                      activeJob.status === "pending"
                        ? "in_progress"
                        : activeJob.status,
                      false,
                    )
                  }
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-3 text-[11px] font-black uppercase text-slate-700 dark:border-slate-600 dark:text-slate-200"
                >
                  {saveBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Guardar avance
                </button>
                <button
                  type="button"
                  disabled={saveBusy || hydrateBusy}
                  onClick={() => void persistProgress("completed", true)}
                  className="inline-flex flex-[1.4] items-center justify-center gap-2 rounded-xl bg-[#16263F] px-3 py-3 text-[11px] font-black uppercase text-white"
                >
                  <Check className="h-4 w-4" />
                  Completar parcial
                </button>
              </>
            ) : null}
            {isAdmin ? (
              <button
                type="button"
                disabled={downloadBusy}
                onClick={() =>
                  void handleDownload({
                    ...activeJob,
                    warehouseBultosByRowId: warehouseMap,
                  })
                }
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-3 text-[11px] font-black uppercase text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
              >
                {downloadBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
                Excel 3 hojas
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    );
  }

  // ─── Listado ──────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-slate-200 bg-gradient-to-r from-[#16263F] to-[#1e4f86] px-3 py-4 text-white sm:px-5">
        <div className="flex items-center gap-2">
          <SplitSquareVertical className="h-5 w-5 shrink-0 opacity-90" />
          <div>
            <h1 className="text-lg font-black sm:text-xl">
              {isAdmin ? "Inventarios parciales" : "Reportes · Parciales"}
            </h1>
            <p className="text-[11px] font-medium text-indigo-100/90">
              {isAdmin
                ? "Asigná RA + contenedor. El inventariador marca EN ALMACÉN. Excel en 3 hojas."
                : "Completá los parciales pendientes marcando lo que queda en bodega."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void reload()}
            className="ml-auto rounded-lg border border-white/20 p-2 hover:bg-white/10"
            aria-label="Actualizar"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900 sm:px-4">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: "pendientes" as const, label: "Pendientes" },
              ...(isAdmin
                ? [
                    { id: "completados" as const, label: "Completados" },
                    { id: "asignar" as const, label: "Asignar RA" },
                  ]
                : []),
            ] as { id: ListTab; label: string }[]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setListTab(t.id)}
              className={`rounded-lg px-3 py-2 text-[10px] font-black uppercase tracking-wide ${
                listTab === t.id
                  ? "bg-[#16263F] text-white"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {listTab !== "asignar" ? (
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={raQuery}
              onChange={(e) => setRaQuery(e.target.value)}
              placeholder="Buscar RA…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm font-semibold outline-none focus:border-[#16263F] dark:border-slate-600 dark:bg-slate-950"
            />
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
        {listTab === "asignar" && isAdmin ? (
          <div className="mx-auto max-w-lg space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">
                Nombre del contenedor
              </p>
              <input
                type="text"
                value={assignContainer}
                onChange={(e) => setAssignContainer(e.target.value)}
                placeholder="Ej. LG-103"
                className="mt-2 w-full rounded-xl border-2 border-slate-200 px-3 py-3 text-base font-black uppercase outline-none focus:border-[#16263F] dark:border-slate-600 dark:bg-slate-950"
              />
              <p className="mt-3 text-xs font-black uppercase tracking-wide text-slate-500">
                Buscar RA inventariado
              </p>
              <input
                type="search"
                value={assignRaQuery}
                onChange={(e) => setAssignRaQuery(e.target.value)}
                placeholder="Número de RA…"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold dark:border-slate-600 dark:bg-slate-950"
              />
              <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
                {assignCandidates.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setAssignTaskId(t.id)}
                      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm ${
                        assignTaskId === t.id
                          ? "border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-950/40"
                          : "border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
                      }`}
                    >
                      <span className="font-black text-[#16263F] dark:text-slate-100">
                        {formatRaFieldLabel(t.ra)}
                      </span>
                      <span className="truncate text-[11px] text-slate-500">
                        {t.mainClient}
                      </span>
                    </button>
                  </li>
                ))}
                {assignCandidates.length === 0 ? (
                  <p className="py-6 text-center text-sm font-semibold text-slate-500">
                    No hay RAs disponibles para parcializar.
                  </p>
                ) : null}
              </ul>
              <button
                type="button"
                disabled={assignBusy || !assignTaskId || !assignContainer.trim()}
                onClick={() => void handleAssign()}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#16263F] py-3 text-xs font-black uppercase text-white disabled:opacity-40"
              >
                {assignBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Crear parcial
              </button>
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm font-bold text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            Cargando…
          </div>
        ) : visibleJobs.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center dark:border-slate-700">
            <Boxes className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-3 font-bold text-slate-500">
              {listTab === "completados"
                ? "Aún no hay parciales completados."
                : "No hay parciales pendientes."}
            </p>
            {isAdmin && listTab === "pendientes" ? (
              <button
                type="button"
                onClick={() => setListTab("asignar")}
                className="mt-3 text-xs font-black uppercase text-indigo-600"
              >
                Asignar un RA
              </button>
            ) : null}
          </div>
        ) : (
          <ul className="space-y-2">
            {visibleJobs.map((job) => (
              <li
                key={job.id}
                className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => openJob(job)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="text-base font-black text-[#16263F] dark:text-slate-100">
                      {formatRaFieldLabel(job.ra)}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-1.5 py-0.5 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
                        <Truck className="h-3 w-3" />
                        {job.containerName}
                      </span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase ${statusBadgeClass(job.status)}`}
                      >
                        {statusLabel(job.status)}
                      </span>
                    </p>
                  </button>
                  <div className="flex flex-wrap gap-1.5">
                    {(isAdmin || job.status !== "completed") && (
                      <button
                        type="button"
                        onClick={() => openJob(job)}
                        className="rounded-lg bg-[#16263F] px-2.5 py-1.5 text-[9px] font-black uppercase text-white"
                      >
                        {job.status === "completed" && isAdmin
                          ? "Ver"
                          : "Abrir"}
                      </button>
                    )}
                    {isAdmin ? (
                      <button
                        type="button"
                        disabled={downloadBusy}
                        onClick={() => void handleDownload(job)}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[9px] font-black uppercase text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
                      >
                        <Download className="h-3 w-3" />
                        Excel
                      </button>
                    ) : null}
                  </div>
                </div>

                {isAdmin ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                    {editContainerId === job.id ? (
                      <>
                        <input
                          value={editContainerName}
                          onChange={(e) => setEditContainerName(e.target.value)}
                          className="min-w-[7rem] flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold uppercase dark:border-slate-600 dark:bg-slate-950"
                          placeholder="LG-110"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSaveContainerName(job)}
                          className="rounded-lg bg-sky-600 px-2 py-1 text-[9px] font-black uppercase text-white"
                        >
                          Guardar
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditContainerId(null)}
                          className="rounded-lg p-1 text-slate-400"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditContainerId(job.id);
                          setEditContainerName(job.containerName);
                        }}
                        className="text-[9px] font-black uppercase text-sky-700 dark:text-sky-300"
                      >
                        Cambiar contenedor
                      </button>
                    )}
                    {job.status === "completed" ? (
                      <button
                        type="button"
                        onClick={() => void handleSendRectification(job)}
                        className="text-[9px] font-black uppercase text-violet-700 dark:text-violet-300"
                      >
                        Enviar a rectificación
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          confirm(
                            `¿Eliminar parcial ${formatRaFieldLabel(job.ra)}?`,
                          )
                        ) {
                          void deleteInventoryPartial(job.id).then(() =>
                            setJobs((prev) =>
                              prev.filter((j) => j.id !== job.id),
                            ),
                          );
                        }
                      }}
                      className="ml-auto text-[9px] font-black uppercase text-red-600"
                    >
                      Eliminar
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function KpiMini({
  icon,
  label,
  bultos,
  weight,
  cbm,
  tone = "slate",
}: {
  icon: React.ReactNode;
  label: string;
  bultos: number;
  weight: string;
  cbm: string;
  tone?: "slate" | "sky" | "emerald";
}) {
  const toneCls =
    tone === "sky"
      ? "border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40"
      : tone === "emerald"
        ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40"
        : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60";
  return (
    <div className={`rounded-xl border px-2 py-2 ${toneCls}`}>
      <p className="flex items-center gap-1 truncate text-[8px] font-black uppercase tracking-wide text-slate-500">
        {icon}
        <span className="truncate">{label}</span>
      </p>
      <p className="mt-0.5 text-sm font-black tabular-nums text-[#16263F] dark:text-slate-100">
        {bultos}{" "}
        <span className="text-[9px] font-bold text-slate-400">bult</span>
      </p>
      <p className="text-[9px] font-semibold tabular-nums text-slate-500">
        {weight} kg · {cbm} m³
      </p>
    </div>
  );
}
