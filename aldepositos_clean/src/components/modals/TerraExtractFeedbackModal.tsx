"use client";

import React, { useEffect, useRef, useState } from "react";
import { FileUp, Loader2, X } from "lucide-react";
import { ALDEGPT_TERRA_DISPLAY_NAME } from "@/lib/aldeGptTerraBrand";

const ACCEPT_FILES = ".pdf,.png,.jpg,.jpeg,.webp";
const MAX_FILES = 8;

type TerraExtractFeedbackModalProps = {
  open: boolean;
  orderLabel: string;
  initialFiles?: File[];
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (input: { note: string; files: File[] }) => void;
};

export function TerraExtractFeedbackModal({
  open,
  orderLabel,
  initialFiles = [],
  busy = false,
  error = null,
  onCancel,
  onSubmit,
}: TerraExtractFeedbackModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setNote("");
      setFiles(initialFiles.slice(0, MAX_FILES));
    }
    wasOpenRef.current = open;
  }, [open, initialFiles]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const canSubmit = note.trim().length > 0 && !busy;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="terra-feedback-title"
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0">
            <h2
              id="terra-feedback-title"
              className="text-sm font-black uppercase tracking-wide text-slate-900 dark:text-slate-50"
            >
              Reportar error de extracción
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {ALDEGPT_TERRA_DISPLAY_NAME} · OR {orderLabel}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            Adjuntá el documento (o documentos) y describí con detalle qué no
            extrajo bien. Quedará en <strong>Casos Terra</strong> para revisar
            y corregir con calma.
          </p>

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Nota detallada (obligatoria)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 4000))}
              disabled={busy}
              rows={5}
              placeholder="Ej.: faltaron 3 referencias de la página 2; los bultos de la columna BLTO se leyeron como unidades; no marcó reempaque…"
              className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-slate-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            />
            <p className="mt-0.5 text-right text-[10px] text-slate-400">
              {note.length}/4000
            </p>
          </div>

          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Documentos (PDF / imagen)
            </label>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT_FILES}
              multiple
              className="hidden"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                e.target.value = "";
                setFiles((prev) => {
                  const next = [...prev];
                  for (const f of list) {
                    if (next.length >= MAX_FILES) break;
                    const dup = next.some(
                      (p) =>
                        p.name === f.name &&
                        p.size === f.size &&
                        p.lastModified === f.lastModified,
                    );
                    if (!dup) next.push(f);
                  }
                  return next;
                });
              }}
            />
            <button
              type="button"
              disabled={busy || files.length >= MAX_FILES}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"
            >
              <FileUp className="h-4 w-4" />
              Adjuntar documento
            </button>
            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}-${f.size}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-xs dark:bg-slate-800"
                  >
                    <span className="min-w-0 truncate">{f.name}</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setFiles((prev) => prev.filter((_, idx) => idx !== i))
                      }
                      className="shrink-0 text-red-600 hover:underline disabled:opacity-40"
                    >
                      Quitar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-4 py-3 sm:flex-row sm:justify-end dark:border-slate-800">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onSubmit({ note: note.trim(), files })}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-xs font-black uppercase tracking-wide text-white hover:bg-amber-500 disabled:opacity-40"
          >
            {busy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Guardando…
              </>
            ) : (
              "Guardar caso"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
