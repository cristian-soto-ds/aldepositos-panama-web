"use client";

/**
 * Captura multi-foto para celular: vista previa de cada toma,
 * acumular ángulos y revisar el lote antes de guardar.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  ImagePlus,
  Loader2,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  dataUrlToJpegFile,
  fileToPreviewDataUrl,
  uploadRaPhoto,
  type RaPhotoUploadMeta,
} from "@/lib/raPhotoStorage";
import type { RaPhoto, RaPhotoCategory } from "@/lib/types/raPhoto";
import {
  RA_PHOTO_CATEGORIES,
  RA_PHOTO_CATEGORY_LABELS,
} from "@/lib/types/raPhoto";

type DraftPhoto = {
  id: string;
  previewUrl: string;
  file: File | null;
  caption: string;
  category: RaPhotoCategory;
};

type PhotoCaptureModalProps = {
  open: boolean;
  taskId: string;
  raLabel: string;
  takenByEmail?: string;
  takenByName?: string;
  onClose: () => void;
  /** Se llama una vez por foto guardada (permite varias en la misma sesión). */
  onPhotoSaved: (photo: RaPhoto) => void | Promise<void>;
  /** Si true, al guardar una foto no cierra y permite seguir (lote). Default true. */
  multiShot?: boolean;
};

type CaptureMode = "choose" | "camera" | "preview" | "review";

function newDraftId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function PhotoCaptureModal({
  open,
  taskId,
  raLabel,
  takenByEmail,
  takenByName,
  onClose,
  onPhotoSaved,
  multiShot = true,
}: PhotoCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<CaptureMode>("choose");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState<RaPhotoCategory>("general");
  const [drafts, setDrafts] = useState<DraftPhoto[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const stopCamera = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  const clearCurrentShot = useCallback(() => {
    setPreviewUrl(null);
    setPendingFile(null);
    setCaption("");
    setCategory("general");
    setUploadError(null);
  }, []);

  const resetState = useCallback(() => {
    stopCamera();
    setMode("choose");
    clearCurrentShot();
    setDrafts([]);
    setCameraError(null);
    setUploading(false);
    setUploadProgress(null);
  }, [stopCamera, clearCurrentShot]);

  useEffect(() => {
    if (!open) {
      resetState();
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !uploading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, uploading, onClose, resetState]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    setMode("camera");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
    } catch {
      setCameraError(
        "No se pudo acceder a la cámara. Usá «Subir archivo» o concedé permisos en el navegador.",
      );
      setMode(drafts.length > 0 ? "review" : "choose");
      stopCamera();
    }
  }, [stopCamera, drafts.length]);

  const captureFromCamera = useCallback(() => {
    const video = videoRef.current;
    if (!video || !cameraReady) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    stopCamera();
    setPreviewUrl(dataUrl);
    setPendingFile(null);
    setMode("preview");
  }, [cameraReady, stopCamera]);

  const handleFilePick = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;

    // Varias desde galería → van directo al lote tras generar preview
    if (images.length > 1) {
      try {
        const added: DraftPhoto[] = [];
        for (const file of images) {
          const url = await fileToPreviewDataUrl(file);
          added.push({
            id: newDraftId(),
            previewUrl: url,
            file,
            caption: "",
            category: "general",
          });
        }
        setDrafts((prev) => [...prev, ...added]);
        setMode("review");
        setUploadError(null);
      } catch {
        setUploadError("No se pudieron leer algunas imágenes.");
      }
      return;
    }

    try {
      const url = await fileToPreviewDataUrl(images[0]);
      setPreviewUrl(url);
      setPendingFile(images[0]);
      setMode("preview");
      setUploadError(null);
    } catch {
      setUploadError("No se pudo leer la imagen seleccionada.");
    }
  }, []);

  const handleRetake = useCallback(() => {
    clearCurrentShot();
    setMode("choose");
  }, [clearCurrentShot]);

  /** Acepta la vista previa y la suma al lote (aún no sube). */
  const acceptIntoDraft = useCallback(() => {
    if (!previewUrl) return;
    setDrafts((prev) => [
      ...prev,
      {
        id: newDraftId(),
        previewUrl,
        file: pendingFile,
        caption: caption.trim(),
        category,
      },
    ]);
    clearCurrentShot();
    if (multiShot) {
      setMode("review");
    } else {
      setMode("choose");
    }
  }, [
    previewUrl,
    pendingFile,
    caption,
    category,
    clearCurrentShot,
    multiShot,
  ]);

  const removeDraft = useCallback((id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const uploadOne = useCallback(
    async (draft: DraftPhoto): Promise<RaPhoto> => {
      let file = draft.file;
      if (!file) {
        file = await dataUrlToJpegFile(
          draft.previewUrl,
          `capture-${Date.now()}.jpg`,
        );
      }
      const meta: RaPhotoUploadMeta = {
        caption: draft.caption.trim() || undefined,
        category: draft.category,
        takenByEmail,
        takenByName,
      };
      const result = await uploadRaPhoto(taskId, file, meta);
      if (!result.ok) throw new Error(result.message);
      await onPhotoSaved(result.photo);
      return result.photo;
    },
    [taskId, takenByEmail, takenByName, onPhotoSaved],
  );

  /** Guardar solo la foto en preview (modo una foto). */
  const handleSaveSinglePreview = useCallback(async () => {
    if (!previewUrl) return;
    setUploading(true);
    setUploadError(null);
    try {
      const draft: DraftPhoto = {
        id: newDraftId(),
        previewUrl,
        file: pendingFile,
        caption,
        category,
      };
      await uploadOne(draft);
      resetState();
      onClose();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Error al guardar.");
    } finally {
      setUploading(false);
    }
  }, [
    previewUrl,
    pendingFile,
    caption,
    category,
    uploadOne,
    resetState,
    onClose,
  ]);

  const handleSaveAllDrafts = useCallback(async () => {
    if (drafts.length === 0) return;
    setUploading(true);
    setUploadError(null);
    setUploadProgress({ done: 0, total: drafts.length });
    try {
      for (let i = 0; i < drafts.length; i++) {
        await uploadOne(drafts[i]);
        setUploadProgress({ done: i + 1, total: drafts.length });
      }
      resetState();
      onClose();
    } catch (e) {
      setUploadError(
        e instanceof Error ? e.message : "Error al guardar las fotos.",
      );
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  }, [drafts, uploadOne, resetState, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay fixed inset-0 z-[300] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={() => {
        if (!uploading) onClose();
      }}
      role="presentation"
    >
      <div
        className="modal-panel flex max-h-[96dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-capture-title"
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-[#16263F] to-blue-800 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <h2
              id="photo-capture-title"
              className="text-sm font-black uppercase tracking-widest text-white"
            >
              Tomar fotos
            </h2>
            <p className="mt-0.5 truncate text-xs font-semibold text-blue-100">
              RA {raLabel}
              {drafts.length > 0 ? ` · ${drafts.length} en lote` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20 disabled:opacity-50"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {mode === "choose" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Tomá varios ángulos. Cada foto se previsualiza antes de
                agregarla; al final revisás el lote y guardás.
              </p>
              {cameraError && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                  {cameraError}
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  className="flex flex-col items-center gap-3 rounded-2xl border-2 border-[#16263F]/20 bg-slate-50 px-4 py-8 transition hover:border-[#16263F] hover:bg-white dark:border-slate-600 dark:bg-slate-800"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#16263F] text-white">
                    <Camera className="h-7 w-7" />
                  </span>
                  <span className="text-xs font-black uppercase tracking-widest text-[#16263F] dark:text-slate-100">
                    Usar cámara
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center gap-3 rounded-2xl border-2 border-sky-200 bg-sky-50 px-4 py-8 transition hover:border-sky-400 hover:bg-white dark:border-sky-800 dark:bg-sky-950/40"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-600 text-white">
                    <ImagePlus className="h-7 w-7" />
                  </span>
                  <span className="text-xs font-black uppercase tracking-widest text-sky-900 dark:text-sky-100">
                    Subir archivo(s)
                  </span>
                </button>
              </div>
              {drafts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setMode("review")}
                  className="w-full rounded-xl border-2 border-emerald-500 bg-emerald-50 py-3 text-xs font-black uppercase tracking-widest text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
                >
                  Revisar lote ({drafts.length})
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  void handleFilePick(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          )}

          {mode === "camera" && (
            <div className="space-y-4">
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-black">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  autoPlay
                  className="h-full w-full object-cover"
                />
                {!cameraReady && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 className="h-8 w-8 animate-spin text-white" />
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    setMode(drafts.length > 0 ? "review" : "choose");
                  }}
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-600 dark:border-slate-600 dark:text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={captureFromCamera}
                  disabled={!cameraReady}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#16263F] px-4 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
                >
                  <Camera className="h-4 w-4" />
                  Capturar
                </button>
              </div>
            </div>
          )}

          {mode === "preview" && previewUrl && (
            <div className="space-y-4">
              <p className="text-center text-[10px] font-black uppercase tracking-widest text-slate-500">
                Vista previa — ¿cómo quedó?
              </p>
              <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-600">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="Vista previa"
                  className="max-h-72 w-full bg-slate-100 object-contain dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Categoría / ángulo
                </label>
                <select
                  value={category}
                  onChange={(e) =>
                    setCategory(e.target.value as RaPhotoCategory)
                  }
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                >
                  {RA_PHOTO_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {RA_PHOTO_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Nota (opcional)
                </label>
                <input
                  type="text"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Ej. Frente · etiqueta · daño"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              {uploadError && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
                  {uploadError}
                </p>
              )}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleRetake}
                  disabled={uploading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-600 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300"
                >
                  <RotateCcw className="h-4 w-4" />
                  Repetir foto
                </button>
                {multiShot ? (
                  <button
                    type="button"
                    onClick={acceptIntoDraft}
                    disabled={uploading}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#16263F] px-4 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" />
                    Usar esta y seguir
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleSaveSinglePreview()}
                    disabled={uploading}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
                  >
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    Guardar foto
                  </button>
                )}
              </div>
            </div>
          )}

          {mode === "review" && (
            <div className="space-y-4">
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                Revisá las {drafts.length} foto
                {drafts.length === 1 ? "" : "s"} antes de guardar. Podés
                eliminar alguna o tomar más ángulos.
              </p>
              {drafts.length === 0 ? (
                <p className="text-center text-sm text-slate-400">
                  No hay fotos en el lote.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {drafts.map((d, idx) => (
                    <article
                      key={d.id}
                      className="relative overflow-hidden rounded-xl border border-slate-200 dark:border-slate-600"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={d.previewUrl}
                        alt={`Foto ${idx + 1}`}
                        className="aspect-square w-full bg-slate-100 object-cover dark:bg-slate-800"
                      />
                      <p className="truncate px-1.5 py-1 text-[9px] font-bold uppercase text-slate-500">
                        {RA_PHOTO_CATEGORY_LABELS[d.category]}
                        {d.caption ? ` · ${d.caption}` : ""}
                      </p>
                      <button
                        type="button"
                        disabled={uploading}
                        onClick={() => removeDraft(d.id)}
                        className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-md bg-red-600/95 text-white"
                        aria-label="Quitar del lote"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </article>
                  ))}
                </div>
              )}
              {uploadError && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
                  {uploadError}
                </p>
              )}
              {uploadProgress && (
                <p className="text-center text-xs font-semibold text-slate-500">
                  Guardando {uploadProgress.done} / {uploadProgress.total}…
                </p>
              )}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => void startCamera()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#16263F] px-4 py-3 text-xs font-black uppercase tracking-widest text-[#16263F] disabled:opacity-50 dark:text-slate-100"
                >
                  <Camera className="h-4 w-4" />
                  Tomar otra
                </button>
                <button
                  type="button"
                  disabled={uploading || drafts.length === 0}
                  onClick={() => void handleSaveAllDrafts()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3.5 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {uploading
                    ? "Guardando…"
                    : `Guardar ${drafts.length} foto${drafts.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
