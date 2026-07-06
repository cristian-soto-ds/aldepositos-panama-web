"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Brain,
  Loader2,
  MessageSquarePlus,
  Plus,
  ScanText,
  Send,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { AldeIaBrand } from "@/components/ui/AldeIaBrand";
import { GeminiSparkIcon } from "@/components/ui/GeminiSparkIcon";
import { AI_ASSISTANT_DISPLAY_NAME } from "@/lib/aiAssistantBrand";
import { sanitizeViewerDisplayNameHint } from "@/lib/geminiCollectionOrderContext";
import type { GeminiUsageSummary } from "@/lib/geminiClientUsage";
import type { CollectionGeminiLine } from "@/lib/collectionOrderGeminiSchema";
import {
  deleteGeminiLearningNote,
  insertGeminiLearningNote,
  listGeminiLearningNotes,
  type GeminiLearningNote,
} from "@/lib/geminiLearningNotes";
import { EXTRACT_REFERENCIAS_BULTOS_PROMPT } from "@/lib/geminiRefsBultosMode";

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
  onSend: (args: {
    text: string;
    file: File | null;
    onlyRefsBultos?: boolean;
  }) => Promise<void>;
  onApplyLines: () => void;
};

const ACCEPT_FILES = ".pdf,.png,.jpg,.jpeg,.webp";

function greetingFirstName(displayName: string | null | undefined): string | null {
  const full = sanitizeViewerDisplayNameHint(displayName);
  if (!full) return null;
  const first = full.split(/\s+/)[0]?.trim();
  if (!first) return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

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
  const { input, history, busy, errorBanner, lastLines } = job;
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoExtractRef = useRef(false);

  const [learningNotes, setLearningNotes] = useState<GeminiLearningNote[]>([]);
  const [learningLoading, setLearningLoading] = useState(false);
  const [learningError, setLearningError] = useState<string | null>(null);
  const [newLearningText, setNewLearningText] = useState("");
  const [learningSaveBusy, setLearningSaveBusy] = useState(false);

  const reloadLearning = useCallback(async () => {
    setLearningError(null);
    try {
      const rows = await listGeminiLearningNotes();
      setLearningNotes(rows);
    } catch (e) {
      setLearningError(e instanceof Error ? e.message : "No se pudieron cargar las reglas.");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLearningLoading(true);
    setLearningError(null);
    void listGeminiLearningNotes()
      .then((rows) => {
        if (!cancelled) setLearningNotes(rows);
      })
      .catch((e) => {
        if (!cancelled) {
          setLearningError(
            e instanceof Error
              ? e.message
              : "No se pudo cargar la memoria. ¿Aplicaste la migración SQL `008_gemini_learning_notes`?",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLearningLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    void orderNumber;
    void existingReferencias;
  }, [open]);

  const firstName = greetingFirstName(viewerDisplayName);
  const emptyGreeting = firstName
    ? `¡Pregunta lo que quieras, ${firstName}!`
    : "¿En qué te ayudo con esta orden?";

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

  /** Envía el prompt fijo de extracción con el archivo indicado. */
  const runExtract = async (file: File) => {
    try {
      onChangeJob({ input: "" });
      await onSend({
        text: EXTRACT_REFERENCIAS_BULTOS_PROMPT,
        file,
        onlyRefsBultos: true,
      });
      if (fileRef.current) fileRef.current.value = "";
    } catch {
      scrollBottom();
    }
  };

  /** Botón rápido: usa el archivo ya adjunto o abre el selector y auto-envía. */
  const quickExtract = () => {
    if (busy) return;
    const f = fileRef.current?.files?.[0] ?? null;
    if (f) {
      void runExtract(f);
      return;
    }
    autoExtractRef.current = true;
    fileRef.current?.click();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[320] flex justify-end bg-slate-950/40 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        className="flex h-full w-full max-w-md flex-col bg-[#e8f0fe] shadow-[-16px_0_40px_rgba(15,23,42,0.08)] dark:bg-[#131314] sm:max-w-lg"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between px-4 py-3">
          <AldeIaBrand
            iconSize={22}
            labelClassName="text-sm font-medium text-slate-700 dark:text-slate-200"
          />
          <div className="flex items-center gap-1">
            {history.length > 0 && (
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
                className="rounded-full p-2 text-slate-500 hover:bg-white/60 disabled:opacity-40 dark:hover:bg-white/10"
                aria-label="Nuevo chat"
                title="Nuevo chat"
              >
                <MessageSquarePlus className="h-5 w-5" />
              </button>
            )}
            <details className="relative">
              <summary
                className="cursor-pointer list-none rounded-full p-2 text-slate-500 marker:content-none hover:bg-white/60 dark:hover:bg-white/10 [&::-webkit-details-marker]:hidden"
                aria-label="Memoria y reglas"
                title="Memoria"
              >
                <Brain className="h-5 w-5" />
              </summary>
              <div className="absolute right-0 top-full z-20 mt-1 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-slate-200/90 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                  Reglas que {AI_ASSISTANT_DISPLAY_NAME} recordará
                </p>
                {learningError && (
                  <p className="mb-2 text-xs text-red-600 dark:text-red-400">{learningError}</p>
                )}
                {learningLoading ? (
                  <p className="flex items-center gap-2 text-xs text-slate-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Cargando…
                  </p>
                ) : (
                  <ul className="mb-2 max-h-32 space-y-1.5 overflow-y-auto text-xs text-slate-700 dark:text-slate-200">
                    {learningNotes.length === 0 ? (
                      <li className="text-slate-400">Sin reglas guardadas.</li>
                    ) : (
                      learningNotes.map((n) => (
                        <li
                          key={n.id}
                          className="flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800"
                        >
                          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                            {n.body}
                          </span>
                          <button
                            type="button"
                            disabled={learningSaveBusy}
                            onClick={() =>
                              void deleteGeminiLearningNote(n.id)
                                .then(() => reloadLearning())
                                .catch((e) =>
                                  setLearningError(
                                    e instanceof Error
                                      ? e.message
                                      : "No se pudo eliminar.",
                                  ),
                                )
                            }
                            className="shrink-0 rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-40"
                            aria-label="Eliminar regla"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
                <textarea
                  value={newLearningText}
                  onChange={(e) => setNewLearningText(e.target.value.slice(0, 2000))}
                  disabled={learningSaveBusy || busy}
                  rows={2}
                  placeholder="Ej.: columna DZ = docenas…"
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs outline-none focus:border-slate-400 dark:border-slate-600 dark:bg-slate-950"
                />
                <button
                  type="button"
                  disabled={
                    learningSaveBusy ||
                    busy ||
                    !newLearningText.trim() ||
                    newLearningText.length > 2000
                  }
                  onClick={() => {
                    void (async () => {
                      setLearningSaveBusy(true);
                      setLearningError(null);
                      try {
                        await insertGeminiLearningNote(newLearningText);
                        setNewLearningText("");
                        await reloadLearning();
                      } catch (e) {
                        setLearningError(
                          e instanceof Error ? e.message : "No se pudo guardar.",
                        );
                      } finally {
                        setLearningSaveBusy(false);
                      }
                    })();
                  }}
                  className="mt-2 w-full rounded-xl bg-slate-800 py-2 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-600"
                >
                  {learningSaveBusy ? "Guardando…" : "Guardar regla"}
                </button>
              </div>
            </details>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-slate-500 hover:bg-white/60 dark:hover:bg-white/10"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {busy && (
          <div className="shrink-0 px-4 pb-2" role="status" aria-live="polite" aria-busy="true">
            <div className="collection-order-ai-progress-track">
              <div className="collection-order-ai-progress-fill" />
            </div>
          </div>
        )}

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-4 pb-2"
        >
          {history.length === 0 && !busy && (
            <div className="flex min-h-[min(50vh,320px)] flex-col items-center justify-center gap-5 px-2 text-center">
              <GeminiSparkIcon size={48} />
              <h2 className="text-[1.35rem] font-normal leading-snug tracking-tight text-slate-800 dark:text-slate-100 sm:text-2xl">
                {emptyGreeting}
              </h2>
              <button
                type="button"
                disabled={busy}
                onClick={quickExtract}
                className="group inline-flex max-w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50/60 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/30"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  <ScanText className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
                    Leer documento
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    Extraer referencias y bultos automáticamente
                  </span>
                </span>
              </button>
            </div>
          )}

          {history.length > 0 && (
            <div className="space-y-4 py-4">
              {history.map((m, i) => (
                <div
                  key={i}
                  className={`text-sm leading-relaxed ${
                    m.role === "user"
                      ? "ml-6 text-slate-800 dark:text-slate-100"
                      : "mr-2 text-slate-700 dark:text-slate-200"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.text}</p>
                </div>
              ))}
            </div>
          )}

          {busy && history.length > 0 && (
            <p className="flex items-center gap-2 py-2 text-sm text-slate-500">
              <GeminiSparkIcon size={18} className="shrink-0 opacity-80" />
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Pensando…
            </p>
          )}

        </div>

        {errorBanner && (
          <div
            role="alert"
            className="mx-4 mb-2 shrink-0 rounded-2xl bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-100"
          >
            {errorBanner.code != null && (
              <p className="mb-1 text-xs font-medium text-red-600">
                Error {errorBanner.code}
              </p>
            )}
            <p className="whitespace-pre-wrap break-words">{errorBanner.text}</p>
          </div>
        )}

        {lastLines.length > 0 && (
          <div className="mx-4 mb-2 shrink-0">
            <button
              type="button"
              onClick={onApplyLines}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-emerald-600 py-3 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
            >
              <Table2 className="h-4 w-4" />
              Añadir {lastLines.length} fila{lastLines.length === 1 ? "" : "s"} a la orden
            </button>
          </div>
        )}

        <div className="shrink-0 px-4 pb-5 pt-2">
          {history.length > 0 && (
            <div className="mb-2 flex justify-center">
              <button
                type="button"
                disabled={busy}
                onClick={quickExtract}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
              >
                <ScanText className="h-4 w-4" aria-hidden />
                Leer documento: referencias y bultos
              </button>
            </div>
          )}
          {job.pendingFileName && (
            <p className="mb-2 truncate text-center text-xs text-slate-500">
              {job.pendingFileName}
            </p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT_FILES}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) {
                autoExtractRef.current = false;
                return;
              }
              onChangeJob({ pendingFileName: f.name });
              if (autoExtractRef.current) {
                autoExtractRef.current = false;
                void runExtract(f);
              }
            }}
          />
          <div className="alde-ia-composer flex items-end gap-2 rounded-[28px] bg-white px-2 py-2 shadow-[0_1px_6px_rgba(60,64,67,0.15)] dark:bg-[#1e1f20] dark:shadow-none">
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
              aria-label="Adjuntar archivo"
            >
              <Plus className="h-5 w-5" />
            </button>
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
              rows={1}
              placeholder={`Preguntarle a ${AI_ASSISTANT_DISPLAY_NAME}`}
              className="max-h-32 min-h-[2.5rem] flex-1 resize-none border-0 bg-transparent py-2.5 text-[15px] leading-snug text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            <button
              type="button"
              disabled={busy || (!input.trim() && !job.pendingFileName)}
              onClick={() => void send()}
              className="alde-ia-send mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-40"
              aria-label="Enviar"
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
