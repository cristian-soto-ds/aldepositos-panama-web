"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, RotateCcw, Upload, X } from "lucide-react";
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

type PhotoCaptureModalProps = {
  open: boolean;
  taskId: string;
  raLabel: string;
  takenByEmail?: string;
  takenByName?: string;
  onClose: () => void;
  onPhotoSaved: (photo: RaPhoto) => void | Promise<void>;
};

type CaptureMode = "choose" | "camera" | "preview";

export function PhotoCaptureModal({
  open,
  taskId,
  raLabel,
  takenByEmail,
  takenByName,
  onClose,
  onPhotoSaved,
}: PhotoCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<CaptureMode>("choose");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [category, setCategory] = useState<RaPhotoCategory>("general");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

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

  const resetState = useCallback(() => {
    stopCamera();
    setMode("choose");
    setPreviewUrl(null);
    setPendingFile(null);
    setCaption("");
    setCategory("general");
    setCameraError(null);
    setUploadError(null);
    setUploading(false);
  }, [stopCamera]);

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
      setMode("choose");
      stopCamera();
    }
  }, [stopCamera]);

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
    const file = files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const url = await fileToPreviewDataUrl(file);
      setPreviewUrl(url);
      setPendingFile(file);
      setMode("preview");
      setUploadError(null);
    } catch {
      setUploadError("No se pudo leer la imagen seleccionada.");
    }
  }, []);

  const handleRetake = useCallback(() => {
    setPreviewUrl(null);
    setPendingFile(null);
    setCaption("");
    setCategory("general");
    setUploadError(null);
    setMode("choose");
  }, []);

  const handleSave = useCallback(async () => {
    if (!previewUrl) return;
    setUploading(true);
    setUploadError(null);
    try {
      let file = pendingFile;
      if (!file) {
        file = await dataUrlToJpegFile(previewUrl, `capture-${Date.now()}.jpg`);
      }
      const meta: RaPhotoUploadMeta = {
        caption: caption.trim() || undefined,
        category,
        takenByEmail,
        takenByName,
      };
      const result = await uploadRaPhoto(taskId, file, meta);
      if (!result.ok) {
        setUploadError(result.message);
        return;
      }
      await onPhotoSaved(result.photo);
      resetState();
      onClose();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Error al guardar la foto.");
    } finally {
      setUploading(false);
    }
  }, [
    previewUrl,
    pendingFile,
    caption,
    category,
    takenByEmail,
    takenByName,
    taskId,
    onPhotoSaved,
    resetState,
    onClose,
  ]);

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
              Registro fotográfico
            </h2>
            <p className="mt-0.5 truncate text-xs font-semibold text-blue-100">
              RA {raLabel}
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
                Documentá la mercancía con fotos para el informe al cliente.
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
                  className="flex flex-col items-center gap-3 rounded-2xl border-2 border-[#16263F]/20 bg-slate-50 px-4 py-8 transition hover:border-[#16263F] hover:bg-white dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-750"
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
                    Subir archivo
                  </span>
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
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
              <div className="relative overflow-hidden rounded-2xl bg-black aspect-[4/3]">
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
                    setMode("choose");
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
              <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-600">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl}
                  alt="Vista previa"
                  className="max-h-64 w-full object-contain bg-slate-100 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Categoría
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as RaPhotoCategory)}
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
                  Descripción (opcional)
                </label>
                <input
                  type="text"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Ej. Bulto 12 — etiqueta dañada"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              {uploadError && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                  {uploadError}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleRetake}
                  disabled={uploading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-xs font-bold uppercase tracking-widest text-slate-600 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300"
                >
                  <RotateCcw className="h-4 w-4" />
                  Otra foto
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={uploading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  {uploading ? "Guardando…" : "Guardar foto"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
