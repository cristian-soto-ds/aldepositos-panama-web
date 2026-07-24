"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  Camera,
  Download,
  ImageIcon,
  Loader2,
  Search,
  Trash2,
  BookmarkPlus,
  BookmarkMinus,
} from "lucide-react";
import type { Task } from "@/lib/types/task";
import type { RaPhoto, RaPhotoCategory } from "@/lib/types/raPhoto";
import {
  RA_PHOTO_CATEGORIES,
  RA_PHOTO_CATEGORY_LABELS,
} from "@/lib/types/raPhoto";
import { PhotoCaptureModal } from "@/components/modals/PhotoCaptureModal";
import {
  appendPhotoToTask,
  buildPhotoRecordPdfFilename,
  getTaskPhotos,
  isPhotoRegistrationRequested,
  photoRecordTakenByLabel,
  removePhotoFromTask,
  setPhotoRegistrationRequested,
  updatePhotoInTask,
} from "@/lib/raPhotoRecord";
import {
  deleteRaPhotoFromStorage,
  preloadRaPhotoPdfAssets,
  type RaPhotoPdfAsset,
} from "@/lib/raPhotoStorage";
import { computeReportData } from "@/lib/reportTotals";
import { useRaPhotoDisplayUrls } from "@/hooks/useRaPhotoDisplayUrls";
import {
  exportReportPdfFromExportRoot,
  PDF_EXPORT_WIDTH_PX,
  waitForReportDomReady,
} from "./reportsPdfExport";
import { PhotoRecordPdfExportLayout } from "./PhotoRecordPdfExportLayout";
import { canEditInventoryCapture } from "@/lib/inventoryOperatorsAllowlist";

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

type QueueFilter = "todos" | "cola" | "con-fotos";

type PhotoRecordModuleProps = {
  tasks: Task[];
  onUpdateTask: (task: Task) => void | Promise<void>;
  userEmail?: string | null;
  userDisplayName?: string | null;
  /** RA preseleccionado al abrir desde inventario */
  initialTaskId?: string | null;
};

export function PhotoRecordModule({
  tasks,
  onUpdateTask,
  userEmail,
  userDisplayName,
  initialTaskId,
}: PhotoRecordModuleProps) {
  const [selectedId, setSelectedId] = useState<string | null>(initialTaskId ?? null);
  const [search, setSearch] = useState("");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("todos");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [pdfPhotoAssetsById, setPdfPhotoAssetsById] = useState<
    Record<string, RaPhotoPdfAsset>
  >({});
  const pdfExportRef = useRef<HTMLDivElement>(null);

  const canCapture = canEditInventoryCapture(userEmail, userDisplayName);

  useEffect(() => {
    if (initialTaskId) setSelectedId(initialTaskId);
  }, [initialTaskId]);

  const eligibleTasks = useMemo(
    () =>
      tasks
        .filter((t) => !t.dispatched)
        .sort((a, b) => String(b.ra).localeCompare(String(a.ra))),
    [tasks],
  );

  const filteredTasks = useMemo(() => {
    let list = eligibleTasks;
    if (queueFilter === "cola") {
      list = list.filter((t) => isPhotoRegistrationRequested(t));
    } else if (queueFilter === "con-fotos") {
      list = list.filter((t) => getTaskPhotos(t).length > 0);
    }

    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) => {
      const hay = [
        t.ra,
        t.mainClient,
        t.subClient,
        t.provider,
        t.brand,
        photoRecordTakenByLabel(t),
      ]
        .map((s) => String(s ?? "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [eligibleTasks, search, queueFilter]);

  const selectedTask = useMemo(
    () => eligibleTasks.find((t) => t.id === selectedId) ?? null,
    [eligibleTasks, selectedId],
  );

  const photos = useMemo(() => getTaskPhotos(selectedTask), [selectedTask]);
  const selectedRequested = isPhotoRegistrationRequested(selectedTask);

  const { srcFor: photoSrcFor } = useRaPhotoDisplayUrls(
    photos,
    selectedTask?.id,
  );

  const reportTotals = useMemo(
    () => (selectedTask ? computeReportData(selectedTask).totals : null),
    [selectedTask],
  );

  const handlePhotoSaved = useCallback(
    async (photo: RaPhoto) => {
      if (!selectedTask) return;
      const updated = appendPhotoToTask(selectedTask, photo);
      await onUpdateTask(updated);
    },
    [selectedTask, onUpdateTask],
  );

  const handleToggleRequested = useCallback(async () => {
    if (!selectedTask) return;
    const next = setPhotoRegistrationRequested(
      selectedTask,
      !isPhotoRegistrationRequested(selectedTask),
    );
    await onUpdateTask(next);
  }, [selectedTask, onUpdateTask]);

  const handleDeletePhoto = useCallback(
    async (photo: RaPhoto) => {
      if (!selectedTask) return;
      // eslint-disable-next-line no-alert
      if (!window.confirm("¿Eliminar esta foto del registro?")) return;
      setDeletingId(photo.id);
      try {
        await deleteRaPhotoFromStorage(photo.storagePath);
        const updated = removePhotoFromTask(selectedTask, photo.id);
        await onUpdateTask(updated);
      } finally {
        setDeletingId(null);
      }
    },
    [selectedTask, onUpdateTask],
  );

  const handleCaptionChange = useCallback(
    async (photoId: string, caption: string) => {
      if (!selectedTask) return;
      const updated = updatePhotoInTask(selectedTask, photoId, {
        caption: caption.trim() || undefined,
      });
      await onUpdateTask(updated);
    },
    [selectedTask, onUpdateTask],
  );

  const handleCategoryChange = useCallback(
    async (photoId: string, category: RaPhotoCategory) => {
      if (!selectedTask) return;
      const updated = updatePhotoInTask(selectedTask, photoId, { category });
      await onUpdateTask(updated);
    },
    [selectedTask, onUpdateTask],
  );

  const handleDownloadPdf = useCallback(async () => {
    if (!selectedTask || photos.length === 0) return;
    setIsDownloadingPdf(true);
    setExportError(null);
    try {
      const assets = await preloadRaPhotoPdfAssets(photos, selectedTask.id);
      flushSync(() => setPdfPhotoAssetsById(assets));
      await waitForReportDomReady();
      const root = pdfExportRef.current;
      if (!root) throw new Error("Contenedor PDF no disponible.");
      await waitForExportImages(root);
      const filename = buildPhotoRecordPdfFilename(selectedTask.ra);
      await exportReportPdfFromExportRoot(root, filename);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Error al generar PDF.");
    } finally {
      setIsDownloadingPdf(false);
    }
  }, [selectedTask, photos]);

  const openCapture = useCallback(() => {
    if (!canCapture) return;
    setCaptureOpen(true);
  }, [canCapture]);

  const generatedAt = new Date().toISOString();

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-700 dark:bg-slate-900 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg font-black uppercase tracking-widest text-[#16263F] dark:text-slate-100 sm:text-xl">
              Registro fotográfico
            </h1>
            <p className="mt-0.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
              Marcá RAs y documentá con fotos (inventariadores)
            </p>
          </div>
          {selectedTask && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleToggleRequested()}
                className={`inline-flex items-center gap-2 rounded-xl border-2 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest ${
                  selectedRequested
                    ? "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
                    : "border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                }`}
              >
                {selectedRequested ? (
                  <BookmarkMinus className="h-4 w-4" />
                ) : (
                  <BookmarkPlus className="h-4 w-4" />
                )}
                {selectedRequested ? "Quitar de cola" : "Marcar para registro"}
              </button>
              <button
                type="button"
                disabled={!canCapture}
                onClick={openCapture}
                title={
                  canCapture
                    ? undefined
                    : "Solo inventariadores (o corrector) pueden capturar fotos"
                }
                className="inline-flex items-center gap-2 rounded-xl bg-[#16263F] px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-white shadow-md hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Camera className="h-4 w-4" />
                Tomar / subir foto
              </button>
              <button
                type="button"
                disabled={photos.length === 0 || isDownloadingPdf}
                onClick={() => void handleDownloadPdf()}
                className="inline-flex items-center gap-2 rounded-xl border-2 border-emerald-500 bg-emerald-50 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-emerald-900 disabled:opacity-40 dark:bg-emerald-950/40 dark:text-emerald-100"
              >
                {isDownloadingPdf ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                PDF para cliente
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 overflow-hidden p-4 sm:flex-row sm:p-6">
        <aside className="flex w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:w-80">
          <div className="space-y-2 border-b border-slate-100 p-3 dark:border-slate-800">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar RA, cliente…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm font-semibold dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {(
                [
                  ["todos", "Todos"],
                  ["cola", "Cola"],
                  ["con-fotos", "Con fotos"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setQueueFilter(id)}
                  className={`flex-1 rounded-lg px-2 py-1.5 text-[9px] font-black uppercase tracking-wide ${
                    queueFilter === id
                      ? "bg-white text-[#16263F] shadow-sm dark:bg-slate-950 dark:text-slate-100"
                      : "text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ul className="flex-1 overflow-y-auto p-2">
            {filteredTasks.length === 0 ? (
              <li className="px-3 py-6 text-center text-xs font-semibold text-slate-500">
                No hay RAs en esta vista.
              </li>
            ) : (
              filteredTasks.map((t) => {
                const count = getTaskPhotos(t).length;
                const active = t.id === selectedId;
                const requested = isPhotoRegistrationRequested(t);
                const who = count > 0 ? photoRecordTakenByLabel(t) : null;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className={`mb-1 w-full rounded-xl px-3 py-2.5 text-left transition ${
                        active
                          ? "bg-[#16263F] text-white shadow-md"
                          : "hover:bg-slate-50 dark:hover:bg-slate-800"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-black">RA {t.ra}</span>
                        <div className="flex items-center gap-1">
                          {requested && (
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase ${
                                active
                                  ? "bg-amber-400/90 text-[#16263F]"
                                  : "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100"
                              }`}
                            >
                              Cola
                            </span>
                          )}
                          {count > 0 && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[9px] font-black tabular-nums ${
                                active
                                  ? "bg-white/20"
                                  : "bg-slate-100 dark:bg-slate-800"
                              }`}
                            >
                              {count}
                            </span>
                          )}
                        </div>
                      </div>
                      <p
                        className={`mt-0.5 truncate text-[10px] font-semibold ${
                          active
                            ? "text-blue-100"
                            : "text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        {t.mainClient || t.provider || "—"}
                      </p>
                      {who && who !== "Sin atribuir" && (
                        <p
                          className={`mt-0.5 truncate text-[9px] font-medium ${
                            active ? "text-blue-200/90" : "text-slate-400"
                          }`}
                        >
                          {who}
                        </p>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {!selectedTask ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
              <ImageIcon className="h-12 w-12 text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                Seleccioná un RA para marcarlo o agregar fotos.
              </p>
            </div>
          ) : (
            <>
              <div className="border-b border-slate-100 p-4 dark:border-slate-800 sm:p-5">
                <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <InfoChip label="Cliente" value={selectedTask.mainClient} />
                  <InfoChip label="Proveedor" value={selectedTask.provider} />
                  <InfoChip label="Marca" value={selectedTask.brand} />
                  <InfoChip
                    label="Bultos"
                    value={`${selectedTask.currentBultos || reportTotals?.bultos || 0} / ${selectedTask.expectedBultos}`}
                  />
                  {reportTotals ? (
                    <>
                      <InfoChip label="CBM" value={reportTotals.cbm} />
                      <InfoChip
                        label="Peso kg"
                        value={String(reportTotals.weight)}
                      />
                    </>
                  ) : null}
                  {photos.length > 0 && (
                    <InfoChip
                      label="Registró"
                      value={photoRecordTakenByLabel(selectedTask)}
                    />
                  )}
                </div>
                {!canCapture && (
                  <p className="mt-3 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    Podés ver y marcar RAs; solo inventariadores pueden tomar o
                    subir fotos.
                  </p>
                )}
              </div>

              {exportError && (
                <p className="mx-4 mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                  {exportError}
                </p>
              )}

              {photos.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
                  <p className="text-sm font-semibold text-slate-500">
                    Este RA aún no tiene fotos registradas.
                  </p>
                  <button
                    type="button"
                    disabled={!canCapture}
                    onClick={openCapture}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#16263F] px-5 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-40"
                  >
                    <Camera className="h-4 w-4" />
                    Agregar primera foto
                  </button>
                </div>
              ) : (
                <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3 sm:gap-4 sm:p-5 md:grid-cols-4 lg:grid-cols-5">
                  {photos.map((photo) => (
                    <article
                      key={photo.id}
                      className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 hover:shadow-md dark:border-slate-600 dark:bg-slate-800/80 dark:hover:border-slate-500"
                    >
                      <div className="relative flex h-28 items-center justify-center border-b border-slate-100 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60 sm:h-32">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photoSrcFor(photo)}
                          alt={photo.caption || "Foto RA"}
                          className="max-h-full max-w-full object-contain p-1"
                          loading="lazy"
                        />
                        {canCapture && (
                          <button
                            type="button"
                            disabled={deletingId === photo.id}
                            onClick={() => void handleDeletePhoto(photo)}
                            className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-red-600/95 text-white shadow-sm opacity-90 transition hover:bg-red-700 hover:opacity-100 disabled:opacity-50"
                            aria-label="Eliminar foto"
                          >
                            {deletingId === photo.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                      <div className="space-y-1.5 p-2">
                        <select
                          value={photo.category ?? "general"}
                          disabled={!canCapture}
                          onChange={(e) =>
                            void handleCategoryChange(
                              photo.id,
                              e.target.value as RaPhotoCategory,
                            )
                          }
                          className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[9px] font-bold uppercase tracking-wide disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900"
                        >
                          {RA_PHOTO_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {RA_PHOTO_CATEGORY_LABELS[c]}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          defaultValue={photo.caption ?? ""}
                          placeholder="Descripción…"
                          disabled={!canCapture}
                          onBlur={(e) =>
                            void handleCaptionChange(photo.id, e.target.value)
                          }
                          className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                        />
                        <p className="truncate text-[9px] font-medium text-slate-400 dark:text-slate-500">
                          {new Date(photo.takenAt).toLocaleString("es-PA")}
                          {photo.takenByName ? ` · ${photo.takenByName}` : ""}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {selectedTask && (
        <PhotoCaptureModal
          open={captureOpen}
          taskId={selectedTask.id}
          raLabel={String(selectedTask.ra)}
          takenByEmail={userEmail ?? undefined}
          takenByName={userDisplayName ?? undefined}
          onClose={() => setCaptureOpen(false)}
          onPhotoSaved={handlePhotoSaved}
        />
      )}

      {selectedTask && photos.length > 0 && (
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
            id="photo-record-pdf-export-root"
            style={{
              width: `${PDF_EXPORT_WIDTH_PX}px`,
              backgroundColor: "#ffffff",
              boxSizing: "border-box",
            }}
          >
            <PhotoRecordPdfExportLayout
              task={selectedTask}
              photos={photos}
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

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
        {label}
      </p>
      <p className="mt-0.5 truncate text-xs font-bold text-[#16263F] dark:text-slate-100">
        {value || "—"}
      </p>
    </div>
  );
}
