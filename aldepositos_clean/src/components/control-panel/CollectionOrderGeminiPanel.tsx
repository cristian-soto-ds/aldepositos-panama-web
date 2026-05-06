"use client";

import React, { useCallback, useEffect, useRef } from "react";
import {
  FileUp,
  Loader2,
  MessageSquarePlus,
  Send,
  Sparkles,
  Table2,
  X,
} from "lucide-react";
import { AI_ASSISTANT_DISPLAY_NAME } from "@/lib/aiAssistantBrand";
import {
  formatGeminiUsageLines,
  type GeminiUsageSummary,
} from "@/lib/geminiClientUsage";
import type { CollectionGeminiLine } from "@/lib/collectionOrderGeminiSchema";

type ChatTurn = { role: "user" | "model"; text: string };

type ErrorBanner = { text: string; code?: number };

export type CollectionOrderGeminiJobState = {
  input: string;
  history: ChatTurn[];
  busy: boolean;
  errorBanner: ErrorBanner | null;
  pendingFileName: string | null;
  lastLines: CollectionGeminiLine[];
  usageSummary: GeminiUsageSummary | null;
};

type CollectionOrderGeminiPanelProps = {
  open: boolean;
  onClose: () => void;
  orderNumber: string;
  /** Nombre que ve el usuario en el panel (refuerza reconocimiento en el servidor). */
  viewerDisplayName?: string | null;
  /** Referencias ya en tabla (evitar duplicar contexto) */
  existingReferencias: string[];
  job: CollectionOrderGeminiJobState;
  onChangeJob: (patch: Partial<CollectionOrderGeminiJobState>) => void;
  onSend: (args: { text: string; file: File | null }) => Promise<void>;
  onApplyLines: () => void;
};

const ACCEPT_FILES = ".pdf,.png,.jpg,.jpeg,.webp";

export function CollectionOrderGeminiPanel({
  open,
  onClose,
  orderNumber,
  viewerDisplayName = null,
  existingReferencias,
  job,
  onChangeJob,
  onSend,
  onApplyLines,
}: CollectionOrderGeminiPanelProps) {
  const { input, history, busy, errorBanner, lastLines, usageSummary } = job;
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Mantener el panel "en blanco" al cerrarse visualmente pero preservar jobs por orden.
    // El resumen de uso se actualiza desde arriba (job.usageSummary).
    void orderNumber;
    void viewerDisplayName;
    void existingReferencias;
  }, [open]);

  const scrollBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const send = async () => {
    const text = input.trim();
    try {
      const f = fileRef.current?.files?.[0] ?? null;
      if (!text && !f) return;
      onChangeJob({ input: "" });
      await onSend({ text, file: f });
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      scrollBottom();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[320] flex justify-end bg-slate-950/50 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className="flex h-full w-full max-w-md flex-col border-l border-violet-200/80 bg-white shadow-[0_0_0_1px_rgba(139,92,246,0.08),-24px_0_48px_rgba(15,23,42,0.12)] dark:border-violet-900/40 dark:bg-slate-950 sm:max-w-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="relative flex shrink-0 items-center justify-between gap-2 overflow-hidden border-b border-white/10 bg-gradient-to-br from-violet-600 via-fuchsia-600 to-indigo-700 px-4 py-4 text-white">
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 0%, #fff 0%, transparent 45%), radial-gradient(circle at 80% 100%, #fde68a 0%, transparent 40%)",
            }}
            aria-hidden
          />
          <div className="relative flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-2 ring-white/25 shadow-lg">
              <Sparkles className="h-6 w-6 text-amber-200" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-base font-black tracking-tight text-white drop-shadow-sm">
                {AI_ASSISTANT_DISPLAY_NAME}
              </p>
              <p className="truncate text-[11px] font-semibold uppercase tracking-widest text-white/85">
                Orden de recolección · PDF, imagen o texto
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="relative z-10 rounded-xl p-2 text-white/95 ring-1 ring-white/20 hover:bg-white/15 disabled:opacity-50"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <p className="shrink-0 border-b border-violet-100 bg-gradient-to-r from-violet-50/95 to-indigo-50/90 px-4 py-3 text-[11px] font-medium leading-relaxed text-violet-950 dark:border-violet-900/40 dark:from-violet-950/40 dark:to-indigo-950/30 dark:text-violet-100">
          Sube un <strong>PDF</strong> (con texto seleccionable, suele responder más rápido) o{" "}
          <strong>imagen</strong> (packing list, factura, etiqueta), o{" "}
          <strong>pega una tabla</strong> desde Excel. La IA devuelve filas listas para{" "}
          <strong className="whitespace-nowrap">«Añadir a la tabla»</strong>.
        </p>

        {usageSummary && (
          <div
            role="status"
            className="shrink-0 border-b border-sky-200 bg-sky-50/95 px-4 py-2 text-[10px] font-semibold leading-snug text-sky-950 dark:border-sky-900/50 dark:bg-sky-950/35 dark:text-sky-100"
          >
            <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-sky-800 dark:text-sky-200">
              Uso y cupo (orientativo)
            </p>
            <ul className="list-inside list-disc space-y-0.5 marker:text-sky-500">
              {formatGeminiUsageLines(usageSummary).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
        >
          {history.length === 0 && (
            <div className="space-y-3 rounded-2xl border border-dashed border-violet-200/80 bg-gradient-to-b from-slate-50/90 to-violet-50/40 p-4 dark:border-violet-800/50 dark:from-slate-900/80 dark:to-violet-950/20">
              <p className="text-center text-[10px] font-black uppercase tracking-widest text-violet-700 dark:text-violet-300">
                Cómo empezar
              </p>
              <ul className="space-y-2 text-xs leading-snug text-slate-600 dark:text-slate-300">
                <li className="flex gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[10px] font-black text-white">
                    1
                  </span>
                  <span>
                    <strong>Archivo:</strong> packing list o foto de caja (PNG, JPG, WebP, PDF).
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-black text-white">
                    2
                  </span>
                  <span>
                    <strong>Texto:</strong> pega filas desde Excel y pide extraer referencias y
                    medidas.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fuchsia-600 text-[10px] font-black text-white">
                    3
                  </span>
                  <span>
                    Revisa la respuesta y pulsa{" "}
                    <strong className="text-emerald-700 dark:text-emerald-400">
                      Añadir a la tabla de la orden
                    </strong>
                    .
                  </span>
                </li>
              </ul>
            </div>
          )}
          {history.map((m, i) => (
            <div
              key={i}
              className={`rounded-2xl px-3 py-2.5 text-sm leading-relaxed shadow-sm ${
                m.role === "user"
                  ? "ml-4 border border-indigo-200/80 bg-gradient-to-br from-indigo-100 to-sky-50 text-indigo-950 dark:border-indigo-800/60 dark:from-indigo-950/60 dark:to-slate-900 dark:text-indigo-100"
                  : "mr-2 border border-slate-200/90 bg-white text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              }`}
            >
              <p className="mb-1 text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                {m.role === "user" ? "Tú" : AI_ASSISTANT_DISPLAY_NAME}
              </p>
              <p className="whitespace-pre-wrap">{m.text}</p>
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analizando…
            </div>
          )}
        </div>

        {errorBanner && (
          <div
            role="alert"
            className="shrink-0 border-t border-red-200 bg-red-50 px-4 py-3 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100"
          >
            {errorBanner.code != null && (
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-red-600 dark:text-red-300">
                Error {errorBanner.code}
                {errorBanner.code === 429 ? " · Cuota o facturación" : ""}
                {errorBanner.code === 404 ? " · No encontrado" : ""}
              </p>
            )}
            <p className="text-xs font-semibold leading-relaxed whitespace-pre-wrap break-words">
              {errorBanner.text}
            </p>
          </div>
        )}

        {lastLines.length > 0 && (
          <div className="shrink-0 border-t border-emerald-200 bg-emerald-50/90 px-4 py-3 dark:border-emerald-900/40 dark:bg-emerald-950/25">
            <p className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-emerald-800 dark:text-emerald-200">
              <Table2 className="h-4 w-4" />
              {lastLines.length} fila(s) detectada(s)
            </p>
            <button
              type="button"
              onClick={onApplyLines}
              className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-black uppercase tracking-widest text-white shadow hover:bg-emerald-700"
            >
              Añadir a la tabla de la orden
            </button>
          </div>
        )}

        <div className="shrink-0 border-t border-slate-200 p-3 dark:border-slate-700">
          {job.pendingFileName && (
            <p className="mb-2 truncate text-[11px] font-bold text-slate-600 dark:text-slate-300">
              Adjunto: {job.pendingFileName}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT_FILES}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                onChangeJob({ pendingFileName: f.name });
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 rounded-xl border-2 border-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <FileUp className="h-4 w-4" /> Archivo
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onChangeJob({
                  history: [],
                  lastLines: [],
                  errorBanner: null,
                  pendingFileName: null,
                });
                if (fileRef.current) fileRef.current.value = "";
              }}
              className="flex items-center gap-2 rounded-xl border-2 border-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <MessageSquarePlus className="h-4 w-4" /> Nuevo chat
            </button>
          </div>
          <textarea
            value={input}
            onChange={(e) => onChangeJob({ input: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            disabled={busy}
            rows={3}
            placeholder="Escribe o pega datos… (Enter envía, Shift+Enter salto)"
            className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-500 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
          />
          <button
            type="button"
            disabled={busy || (!input.trim() && !job.pendingFileName)}
            onClick={() => void send()}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-3 text-xs font-black tracking-tight text-white shadow-md hover:brightness-110 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Enviar a {AI_ASSISTANT_DISPLAY_NAME}
          </button>
        </div>
      </aside>
    </div>
  );
}
