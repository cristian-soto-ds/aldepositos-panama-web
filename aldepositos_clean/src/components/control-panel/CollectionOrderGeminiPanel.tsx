"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
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
  loadGeminiUsageSummary,
  recordGeminiRequestSuccess,
  type GeminiUsageSummary,
} from "@/lib/geminiClientUsage";
import { supabase } from "@/lib/supabase";
import type { CollectionGeminiLine } from "@/lib/collectionOrderGeminiSchema";

type ChatTurn = { role: "user" | "model"; text: string };

type ErrorBanner = { text: string; code?: number };

type CollectionOrderGeminiPanelProps = {
  open: boolean;
  onClose: () => void;
  orderNumber: string;
  /** Nombre que ve el usuario en el panel (refuerza reconocimiento en el servidor). */
  viewerDisplayName?: string | null;
  /** Referencias ya en tabla (evitar duplicar contexto) */
  existingReferencias: string[];
  onApplyLines: (lines: CollectionGeminiLine[]) => void;
};

const ACCEPT_FILES = ".pdf,.png,.jpg,.jpeg,.webp";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(new Error("No se pudo leer el archivo"));
    r.readAsDataURL(file);
  });
}

export function CollectionOrderGeminiPanel({
  open,
  onClose,
  orderNumber,
  viewerDisplayName = null,
  existingReferencias,
  onApplyLines,
}: CollectionOrderGeminiPanelProps) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [errorBanner, setErrorBanner] = useState<ErrorBanner | null>(null);
  const [pendingFile, setPendingFile] = useState<{
    file: File;
    mime: string;
  } | null>(null);
  const [lastLines, setLastLines] = useState<CollectionGeminiLine[]>([]);
  const [usageSummary, setUsageSummary] = useState<GeminiUsageSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setUsageSummary(loadGeminiUsageSummary());
  }, [open]);

  const scrollBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text && !pendingFile) return;
    setErrorBanner(null);
    setBusy(true);
    setInput("");
    const userVisible = [
      text,
      pendingFile ? `📎 ${pendingFile.file.name}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    setHistory((h) => [...h, { role: "user", text: userVisible }]);
    scrollBottom();

    let filePayload: { base64: string; mimeType: string } | undefined;
    if (pendingFile) {
      try {
        const base64 = await fileToBase64(pendingFile.file);
        filePayload = { base64, mimeType: pendingFile.mime };
      } catch {
        setErrorBanner({ text: "No se pudo leer el archivo." });
        setBusy(false);
        return;
      }
    }

    const contextHint =
      existingReferencias.length > 0
        ? `Referencias ya cargadas en la orden (no duplicar salvo corrección): ${existingReferencias.slice(0, 40).join(", ")}${existingReferencias.length > 40 ? "…" : ""}`
        : undefined;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setErrorBanner({ text: "Sesión expirada. Vuelve a iniciar sesión.", code: 401 });
        setBusy(false);
        return;
      }

      const res = await fetch("/api/collection-order/gemini", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text || "Analiza el documento adjunto y extrae las líneas.",
          history: history.map((t) => ({ role: t.role, text: t.text })),
          file: filePayload,
          orderNumber: orderNumber.trim() || undefined,
          contextHint,
          viewerDisplayName: String(viewerDisplayName ?? "").trim() || undefined,
        }),
      });

      let data: {
        error?: string;
        reply?: string;
        lines?: CollectionGeminiLine[];
        usage?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        } | null;
      };
      try {
        data = (await res.json()) as typeof data;
      } catch {
        setErrorBanner({
          text: `El servidor respondió ${res.status} pero el cuerpo no es JSON. Revisa logs o la URL de la API.`,
          code: res.status,
        });
        setBusy(false);
        return;
      }

      if (!res.ok) {
        setErrorBanner({
          text: data.error || `Error ${res.status}`,
          code: res.status,
        });
        setBusy(false);
        return;
      }

      const reply = String(data.reply ?? "");
      const lines = Array.isArray(data.lines) ? data.lines : [];
      setLastLines(lines);
      setUsageSummary(recordGeminiRequestSuccess(data.usage ?? null));
      setHistory((h) => [...h, { role: "model", text: reply }]);
      setPendingFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setErrorBanner({
        text: e instanceof Error ? e.message : "Error de red (revisa tu conexión).",
      });
    } finally {
      setBusy(false);
      scrollBottom();
    }
  };

  const applyLines = () => {
    const useful = lastLines.filter(
      (row) =>
        row.referencia ||
        row.descripcion ||
        row.bultos ||
        row.unidadesPorBulto ||
        row.unidadesTotales ||
        row.pesoPorBulto ||
        row.pesoTotalKg ||
        row.l ||
        row.w ||
        row.h ||
        row.volumenM3,
    );
    if (useful.length === 0) return;
    onApplyLines(useful);
    setLastLines([]);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[320] flex justify-end bg-slate-900/40 backdrop-blur-[1px]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <aside
        className="flex h-full w-full max-w-md flex-col border-l border-indigo-200 bg-white shadow-2xl dark:border-indigo-900/50 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-3 text-white dark:border-slate-700">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles className="h-6 w-6 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-black tracking-tight text-white">
                {AI_ASSISTANT_DISPLAY_NAME}
              </p>
              <p className="truncate text-[11px] font-medium text-white/80">
                Orden de recolección · chat y documentos
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg p-2 text-white/90 hover:bg-white/15 disabled:opacity-50"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <p className="shrink-0 border-b border-slate-100 bg-violet-50/80 px-4 py-2 text-[10px] font-medium leading-snug text-violet-950 dark:border-slate-800 dark:bg-violet-950/30 dark:text-violet-100">
          Sube un PDF o imagen (packing list, factura, etiqueta) o escribe pegando la tabla.
          Requiere <code className="rounded bg-white/80 px-1 dark:bg-slate-800">GEMINI_API_KEY</code> en
          el servidor (motor de {AI_ASSISTANT_DISPLAY_NAME}).
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
            <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-4 text-center text-xs text-slate-500 dark:border-slate-600 dark:bg-slate-800/40 dark:text-slate-400">
              Ej.: &quot;Extrae todas las referencias y medidas de este PDF&quot; o pega una
              tabla desde Excel.
            </p>
          )}
          {history.map((m, i) => (
            <div
              key={i}
              className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                m.role === "user"
                  ? "ml-6 bg-indigo-100 text-indigo-950 dark:bg-indigo-950/50 dark:text-indigo-100"
                  : "mr-4 border border-slate-200 bg-white text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
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
              onClick={applyLines}
              className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-black uppercase tracking-widest text-white shadow hover:bg-emerald-700"
            >
              Añadir a la tabla de la orden
            </button>
          </div>
        )}

        <div className="shrink-0 border-t border-slate-200 p-3 dark:border-slate-700">
          {pendingFile && (
            <p className="mb-2 truncate text-[11px] font-bold text-slate-600 dark:text-slate-300">
              Adjunto: {pendingFile.file.name}
              <button
                type="button"
                className="ml-2 text-red-600 hover:underline"
                onClick={() => {
                  setPendingFile(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                Quitar
              </button>
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
                const mime = f.type || "application/octet-stream";
                setPendingFile({ file: f, mime });
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
                setHistory([]);
                setLastLines([]);
                setErrorBanner(null);
                setPendingFile(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
              className="flex items-center gap-2 rounded-xl border-2 border-slate-200 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <MessageSquarePlus className="h-4 w-4" /> Nuevo chat
            </button>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
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
            disabled={busy || (!input.trim() && !pendingFile)}
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
