"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  ArrowLeft,
  Camera,
  ChevronDown,
  Download,
  ImageIcon,
  ListFilter,
  Loader2,
  Search,
} from "lucide-react";
import type { Task } from "@/lib/types/task";
import {
  RA_PHOTO_CATEGORY_LABELS,
  type RaPhoto,
} from "@/lib/types/raPhoto";
import {
  buildPhotoRecordPdfFilename,
  getTaskPhotos,
  photoRecordActivityDate,
  photoRecordTakenByLabel,
  taskHasPhotos,
  taskMatchesPhotoEmployee,
} from "@/lib/raPhotoRecord";
import {
  preloadRaPhotoPdfAssets,
  type RaPhotoPdfAsset,
} from "@/lib/raPhotoStorage";
import { useRaPhotoDisplayUrls } from "@/hooks/useRaPhotoDisplayUrls";
import {
  INVENTARIADORES,
} from "@/lib/inventariadoresRoster";
import {
  getPeriodBounds,
  type LeaderboardPeriod,
} from "@/lib/inventoryLeaderboard";
import {
  exportReportPdfFromExportRoot,
  PDF_EXPORT_WIDTH_PX,
  waitForReportDomReady,
} from "./reportsPdfExport";
import { PhotoRecordPdfExportLayout } from "./PhotoRecordPdfExportLayout";

type EmployeeFilter = "Todos" | "sin-atribuir" | string;
type PeriodFilter = "Todos" | "day" | "week" | "month";

type PhotoReportsModuleProps = {
  tasks: Task[];
  userEmail?: string | null;
  userDisplayName?: string | null;
};

function normalizeRaQuery(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/^RA-?/i, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function taskMatchesRa(task: Task, query: string): boolean {
  const q = normalizeRaQuery(query);
  if (!q) return true;
  return normalizeRaQuery(task.ra).includes(q);
}

function taskMatchesPeriod(task: Task, period: PeriodFilter): boolean {
  if (period === "Todos") return true;
  const activity = photoRecordActivityDate(task);
  if (!activity) return false;
  const { start, end } = getPeriodBounds(period as LeaderboardPeriod);
  return activity.getTime() >= start.getTime() && activity.getTime() < end.getTime();
}

async function waitForExportImages(
  root: HTMLElement,
  timeoutMs = 12000,
): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          const done = () => resolve();
          const timer = window.setTimeout(done, timeoutMs);
          img.addEventListener(
            "load",
            () => {
              window.clearTimeout(timer);
              done();
            },
            { once: true },
          );
          img.addEventListener(
            "error",
            () => {
              window.clearTimeout(timer);
              done();
            },
            { once: true },
          );
        }),
    ),
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <label className="mb-1 ml-1 text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
        {label}
      </label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="panel-input w-full cursor-pointer appearance-none rounded-xl py-2.5 pl-4 pr-10 text-xs font-bold uppercase sm:w-44"
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
      </div>
    </div>
  );
}

export function PhotoReportsModule({
  tasks,
  userEmail,
  userDisplayName,
}: PhotoReportsModuleProps) {
  const [raQuery, setRaQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [clientFilter, setClientFilter] = useState("Todos");
  const [employeeFilter, setEmployeeFilter] = useState<EmployeeFilter>("Todos");
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>("Todos");
  const [viewTask, setViewTask] = useState<Task | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [pdfPhotoAssetsById, setPdfPhotoAssetsById] = useState<
    Record<string, RaPhotoPdfAsset>
  >({});
  const pdfExportRef = useRef<HTMLDivElement>(null);

  const photoTasks = useMemo(
    () =>
      tasks
        .filter((t) => taskHasPhotos(t))
        .sort((a, b) => {
          const da = photoRecordActivityDate(a)?.getTime() ?? 0;
          const db = photoRecordActivityDate(b)?.getTime() ?? 0;
          return db - da;
        }),
    [tasks],
  );

  const clients = useMemo(
    () => [...new Set(photoTasks.map((t) => t.mainClient || "Sin Cliente"))],
    [photoTasks],
  );

  const displayedTasks = useMemo(() => {
    let list = photoTasks;
    if (raQuery.trim()) {
      list = list.filter((t) => taskMatchesRa(t, raQuery));
    }
    if (clientFilter !== "Todos") {
      list = list.filter(
        (t) => (t.mainClient || "Sin Cliente") === clientFilter,
      );
    }
    if (employeeFilter !== "Todos") {
      list = list.filter((t) => taskMatchesPhotoEmployee(t, employeeFilter));
    }
    if (periodFilter !== "Todos") {
      list = list.filter((t) => taskMatchesPeriod(t, periodFilter));
    }
    return list;
  }, [photoTasks, raQuery, clientFilter, employeeFilter, periodFilter]);

  // Mantener vista al día si tasks se actualizan
  useEffect(() => {
    if (!viewTask) return;
    const id = viewTask.id;
    const fresh = tasks.find((t) => t.id === id);
    if (fresh && taskHasPhotos(fresh)) {
      if (fresh !== viewTask) setViewTask(fresh);
    } else {
      setViewTask(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync by id when tasks change
  }, [tasks, viewTask?.id]);

  const viewPhotos = useMemo(
    () => getTaskPhotos(viewTask),
    [viewTask],
  );

  const { srcFor: photoSrcFor } = useRaPhotoDisplayUrls(
    viewPhotos,
    viewTask?.id,
  );

  const handleDownloadPdf = useCallback(async () => {
    if (!viewTask || viewPhotos.length === 0) return;
    setIsDownloadingPdf(true);
    setExportError(null);
    try {
      const assets = await preloadRaPhotoPdfAssets(viewPhotos, viewTask.id);
      flushSync(() => setPdfPhotoAssetsById(assets));
      await waitForReportDomReady();
      const root = pdfExportRef.current;
      if (!root) throw new Error("Contenedor PDF no disponible.");
      await waitForExportImages(root);
      await exportReportPdfFromExportRoot(
        root,
        buildPhotoRecordPdfFilename(viewTask.ra),
      );
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Error al generar PDF.");
    } finally {
      setIsDownloadingPdf(false);
    }
  }, [viewTask, viewPhotos]);

  const activeFiltersCount = [clientFilter, employeeFilter, periodFilter].filter(
    (v) => v !== "Todos",
  ).length;

  const generatedAt = new Date().toISOString();

  if (viewTask) {
    return (
      <div className="relative flex h-full min-h-0 w-full flex-col animate-fade bg-slate-50 dark:bg-slate-950">
        <div className="sticky top-0 z-40 flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900 sm:px-6">
          <button
            type="button"
            onClick={() => setViewTask(null)}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            <ArrowLeft className="h-4 w-4" /> Volver
          </button>
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="truncate text-sm font-black text-[#16263F] dark:text-slate-100">
              RA {viewTask.ra}
            </p>
            <p className="truncate text-[10px] font-semibold text-slate-500">
              {photoRecordTakenByLabel(viewTask)} · {viewPhotos.length} foto
              {viewPhotos.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            type="button"
            disabled={isDownloadingPdf || viewPhotos.length === 0}
            onClick={() => void handleDownloadPdf()}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
          >
            {isDownloadingPdf ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            PDF
          </button>
        </div>

        {exportError && (
          <p className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {exportError}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto mb-4 grid max-w-5xl grid-cols-2 gap-3 sm:grid-cols-4">
            <MetaChip label="Cliente" value={viewTask.mainClient} />
            <MetaChip label="Proveedor" value={viewTask.provider} />
            <MetaChip label="Marca" value={viewTask.brand} />
            <MetaChip
              label="Inventariador"
              value={photoRecordTakenByLabel(viewTask)}
            />
          </div>
          <div className="mx-auto grid max-w-5xl grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {viewPhotos.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                src={photoSrcFor(photo)}
              />
            ))}
          </div>
        </div>

        {viewPhotos.length > 0 && (
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
              ref={pdfExportRef}
              id="photo-reports-pdf-export-root"
              style={{
                width: `${PDF_EXPORT_WIDTH_PX}px`,
                backgroundColor: "#ffffff",
                boxSizing: "border-box",
              }}
            >
              <PhotoRecordPdfExportLayout
                task={viewTask}
                photos={viewPhotos}
                generatedAt={generatedAt}
                generatedBy={userDisplayName ?? userEmail ?? undefined}
                photoAssetsById={pdfPhotoAssetsById}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col animate-fade">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col px-2 md:px-0">
        <div className="mb-4 shrink-0 space-y-4 md:mb-6 md:space-y-6">
          <h2 className="flex items-center gap-2 text-xl font-black text-[#16263F] dark:text-slate-100 md:gap-3 md:text-3xl">
            <Camera className="h-5 w-5 text-sky-600 dark:text-sky-400 md:h-8 md:w-8" />
            REPORTES REGISTRO FOTOGRÁFICO
          </h2>

          <div className="panel-card flex flex-col gap-3 rounded-[1.5rem] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <input
                  type="search"
                  value={raQuery}
                  onChange={(e) => setRaQuery(e.target.value)}
                  placeholder="Buscar por RA…"
                  className="panel-input w-full rounded-xl py-2.5 pl-10 pr-4 text-sm font-semibold"
                  aria-label="Buscar por número de RA"
                />
              </div>
              <button
                type="button"
                onClick={() => setFiltersOpen((o) => !o)}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              >
                <ListFilter className="h-4 w-4" />
                Filtros
                {activeFiltersCount > 0 && (
                  <span className="rounded-full bg-[#16263F] px-1.5 py-0.5 text-[9px] text-white">
                    {activeFiltersCount}
                  </span>
                )}
              </button>
            </div>

            {filtersOpen && (
              <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-3 dark:border-slate-700">
                <FilterSelect
                  label="Cliente"
                  value={clientFilter}
                  onChange={setClientFilter}
                >
                  <option value="Todos">Todos</option>
                  {clients.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </FilterSelect>
                <FilterSelect
                  label="Inventariador"
                  value={employeeFilter}
                  onChange={(v) => setEmployeeFilter(v as EmployeeFilter)}
                >
                  <option value="Todos">Todos</option>
                  <option value="sin-atribuir">Sin atribuir</option>
                  {INVENTARIADORES.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </FilterSelect>
                <FilterSelect
                  label="Periodo"
                  value={periodFilter}
                  onChange={(v) => setPeriodFilter(v as PeriodFilter)}
                >
                  <option value="Todos">Todos</option>
                  <option value="day">Hoy</option>
                  <option value="week">Esta semana</option>
                  <option value="month">Este mes</option>
                </FilterSelect>
                {activeFiltersCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setClientFilter("Todos");
                      setEmployeeFilter("Todos");
                      setPeriodFilter("Todos");
                    }}
                    className="self-end text-[10px] font-black uppercase tracking-widest text-slate-500 underline"
                  >
                    Limpiar
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-8">
          {displayedTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center dark:border-slate-700 dark:bg-slate-900">
              <ImageIcon className="h-10 w-10 text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-semibold text-slate-500">
                No hay registros fotográficos con estos filtros.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {displayedTasks.map((t) => {
                const count = getTaskPhotos(t).length;
                const when = photoRecordActivityDate(t);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setViewTask(t)}
                      className="panel-card flex w-full items-center gap-3 rounded-2xl p-4 text-left transition hover:border-slate-300 hover:shadow-md dark:hover:border-slate-500"
                    >
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
                        <Camera className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-black text-[#16263F] dark:text-slate-100">
                            RA {t.ra}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {count} foto{count === 1 ? "" : "s"}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">
                          {t.mainClient || t.provider || "—"}
                        </p>
                        <p className="mt-0.5 truncate text-[10px] font-medium text-slate-400">
                          {photoRecordTakenByLabel(t)}
                          {when
                            ? ` · ${when.toLocaleString("es-PA")}`
                            : ""}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
        {label}
      </p>
      <p className="mt-0.5 truncate text-xs font-bold text-[#16263F] dark:text-slate-100">
        {value || "—"}
      </p>
    </div>
  );
}

function PhotoCard({ photo, src }: { photo: RaPhoto; src: string }) {
  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-600 dark:bg-slate-800/80">
      <div className="flex h-28 items-center justify-center bg-slate-50 dark:bg-slate-900/60 sm:h-32">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={photo.caption || "Foto RA"}
          className="max-h-full max-w-full object-contain p-1"
          loading="lazy"
        />
      </div>
      <div className="space-y-0.5 p-2">
        <p className="text-[9px] font-black uppercase tracking-wide text-slate-500">
          {RA_PHOTO_CATEGORY_LABELS[photo.category ?? "general"]}
        </p>
        {photo.caption ? (
          <p className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-200">
            {photo.caption}
          </p>
        ) : null}
        <p className="truncate text-[9px] text-slate-400">
          {new Date(photo.takenAt).toLocaleString("es-PA")}
          {photo.takenByName ? ` · ${photo.takenByName}` : ""}
        </p>
      </div>
    </article>
  );
}
