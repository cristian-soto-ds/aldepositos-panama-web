"use client";

/**
 * Módulo Celular — inventariadores ven la cola marcada en PC
 * y toman varias fotos por RA con vista previa antes de guardar.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Camera,
  ImageIcon,
  Loader2,
  Search,
  Trash2,
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
  getTaskPhotos,
  isPhotoRegistrationRequested,
  photoRecordTakenByLabel,
  removePhotoFromTask,
  updatePhotoInTask,
} from "@/lib/raPhotoRecord";
import { deleteRaPhotoFromStorage } from "@/lib/raPhotoStorage";
import { useRaPhotoDisplayUrls } from "@/hooks/useRaPhotoDisplayUrls";
import { canEditInventoryCapture } from "@/lib/inventoryOperatorsAllowlist";

type PhotoRecordMobileModuleProps = {
  tasks: Task[];
  onUpdateTask: (task: Task) => void | Promise<void>;
  userEmail?: string | null;
  userDisplayName?: string | null;
};

export function PhotoRecordMobileModule({
  tasks,
  onUpdateTask,
  userEmail,
  userDisplayName,
}: PhotoRecordMobileModuleProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [captureOpen, setCaptureOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canCapture = canEditInventoryCapture(userEmail, userDisplayName);

  const queueTasks = useMemo(
    () =>
      tasks
        .filter((t) => !t.dispatched && isPhotoRegistrationRequested(t))
        .sort((a, b) => String(b.ra).localeCompare(String(a.ra))),
    [tasks],
  );

  const filteredQueue = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return queueTasks;
    return queueTasks.filter((t) => {
      const hay = [t.ra, t.mainClient, t.provider, t.brand]
        .map((s) => String(s ?? "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [queueTasks, search]);

  const selectedTask = useMemo(
    () => queueTasks.find((t) => t.id === selectedId) ?? null,
    [queueTasks, selectedId],
  );

  const photos = useMemo(() => getTaskPhotos(selectedTask), [selectedTask]);
  const { srcFor: photoSrcFor } = useRaPhotoDisplayUrls(
    photos,
    selectedTask?.id,
  );

  /** Evita perder fotos si el lote sube varias seguidas antes de que `tasks` refresque. */
  const captureTaskRef = React.useRef<Task | null>(selectedTask);
  React.useEffect(() => {
    captureTaskRef.current = selectedTask;
  }, [selectedTask]);

  const handlePhotoSaved = useCallback(
    async (photo: RaPhoto) => {
      const base = captureTaskRef.current;
      if (!base) return;
      const updated = appendPhotoToTask(base, photo);
      captureTaskRef.current = updated;
      await onUpdateTask(updated);
    },
    [onUpdateTask],
  );

  const handleDeletePhoto = useCallback(
    async (photo: RaPhoto) => {
      if (!selectedTask || !canCapture) return;
      // eslint-disable-next-line no-alert
      if (!window.confirm("¿Eliminar esta foto?")) return;
      setDeletingId(photo.id);
      try {
        await deleteRaPhotoFromStorage(photo.storagePath);
        const latest =
          tasks.find((t) => t.id === selectedTask.id) ?? selectedTask;
        await onUpdateTask(removePhotoFromTask(latest, photo.id));
      } finally {
        setDeletingId(null);
      }
    },
    [selectedTask, canCapture, onUpdateTask, tasks],
  );

  const handleCategoryChange = useCallback(
    async (photoId: string, category: RaPhotoCategory) => {
      if (!selectedTask || !canCapture) return;
      const latest =
        tasks.find((t) => t.id === selectedTask.id) ?? selectedTask;
      await onUpdateTask(updatePhotoInTask(latest, photoId, { category }));
    },
    [selectedTask, canCapture, onUpdateTask, tasks],
  );

  // Si el RA sale de la cola, cerrar detalle
  React.useEffect(() => {
    if (selectedId && !queueTasks.some((t) => t.id === selectedId)) {
      setSelectedId(null);
      setCaptureOpen(false);
    }
  }, [queueTasks, selectedId]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900 sm:px-5">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-400">
          Registro fotográfico · Celular
        </p>
        <h1 className="text-base font-black uppercase tracking-widest text-[#16263F] dark:text-slate-100 sm:text-lg">
          RAs por fotografiar
        </h1>
        <p className="mt-0.5 text-[11px] font-semibold text-slate-500">
          Cola marcada en PC · varios ángulos por RA
        </p>
      </div>

      {!selectedTask ? (
        <div className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4">
          <div className="relative shrink-0">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar en cola…"
              className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-9 pr-3 text-base font-semibold dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>

          {!canCapture && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              Solo inventariadores pueden tomar fotos. Podés ver la cola.
            </p>
          )}

          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pb-4">
            {filteredQueue.length === 0 ? (
              <li className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-600">
                <ImageIcon className="h-10 w-10 text-slate-300" />
                <p className="text-sm font-semibold text-slate-500">
                  No hay RAs en cola. En PC deben marcarlos primero.
                </p>
              </li>
            ) : (
              filteredQueue.map((t) => {
                const count = getTaskPhotos(t).length;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className="flex w-full items-center gap-3 rounded-2xl border border-amber-200 bg-white p-4 text-left shadow-sm active:scale-[0.99] dark:border-amber-800/60 dark:bg-slate-900"
                    >
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#16263F] text-white">
                        <Camera className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-black text-[#16263F] dark:text-slate-100">
                          RA {t.ra}
                        </p>
                        <p className="truncate text-xs font-semibold text-slate-500">
                          {t.mainClient || t.provider || "—"}
                        </p>
                        {count > 0 && (
                          <p className="mt-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                            {count} foto{count === 1 ? "" : "s"} ·{" "}
                            {photoRecordTakenByLabel(t)}
                          </p>
                        )}
                      </div>
                      <span className="rounded-full bg-amber-100 px-2 py-1 text-[9px] font-black uppercase text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
                        Cola
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : (
        <div className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col overflow-hidden">
          <div className="shrink-0 space-y-3 border-b border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="text-[10px] font-black uppercase tracking-widest text-slate-500"
            >
              ← Volver a la cola
            </button>
            <div>
              <h2 className="text-xl font-black text-[#16263F] dark:text-slate-100">
                RA {selectedTask.ra}
              </h2>
              <p className="text-sm font-semibold text-slate-500">
                {selectedTask.mainClient || selectedTask.provider || "—"}
              </p>
            </div>
            <button
              type="button"
              disabled={!canCapture}
              onClick={() => setCaptureOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#16263F] py-4 text-sm font-black uppercase tracking-widest text-white shadow-md disabled:opacity-40"
            >
              <Camera className="h-5 w-5" />
              Tomar fotos (varios ángulos)
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {photos.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <p className="text-sm font-semibold text-slate-500">
                  Todavía no hay fotos en este RA.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {photos.map((photo) => (
                  <article
                    key={photo.id}
                    className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800"
                  >
                    <div className="relative aspect-square bg-slate-100 dark:bg-slate-900">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photoSrcFor(photo)}
                        alt={photo.caption || "Foto"}
                        className="h-full w-full object-contain p-1"
                      />
                      {canCapture && (
                        <button
                          type="button"
                          disabled={deletingId === photo.id}
                          onClick={() => void handleDeletePhoto(photo)}
                          className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-lg bg-red-600 text-white"
                          aria-label="Eliminar"
                        >
                          {deletingId === photo.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </div>
                    <div className="space-y-1 p-2">
                      <select
                        value={photo.category ?? "general"}
                        disabled={!canCapture}
                        onChange={(e) =>
                          void handleCategoryChange(
                            photo.id,
                            e.target.value as RaPhotoCategory,
                          )
                        }
                        className="w-full rounded-md border border-slate-200 bg-slate-50 px-1 py-1 text-[9px] font-bold uppercase dark:border-slate-600 dark:bg-slate-900"
                      >
                        {RA_PHOTO_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {RA_PHOTO_CATEGORY_LABELS[c]}
                          </option>
                        ))}
                      </select>
                      <p className="truncate text-[9px] text-slate-400">
                        {photo.takenByName || "—"}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {selectedTask && (
        <PhotoCaptureModal
          open={captureOpen}
          taskId={selectedTask.id}
          raLabel={String(selectedTask.ra)}
          takenByEmail={userEmail ?? undefined}
          takenByName={userDisplayName ?? undefined}
          multiShot
          onClose={() => setCaptureOpen(false)}
          onPhotoSaved={handlePhotoSaved}
        />
      )}
    </div>
  );
}
