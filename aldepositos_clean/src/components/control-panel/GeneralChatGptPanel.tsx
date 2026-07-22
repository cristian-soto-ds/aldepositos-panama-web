"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  FileText,
  Loader2,
  Menu,
  MessageSquarePlus,
  PanelLeft,
  PanelLeftClose,
  Plus,
  ScanText,
  Table2,
  X,
} from "lucide-react";
import { AldeGptTerraIcon } from "@/components/ui/AldeGptTerraBrand";
import { ChatMarkdown } from "@/components/ui/ChatMarkdown";
import { ALDEGPT_TERRA_DISPLAY_NAME } from "@/lib/aldeGptTerraBrand";
import {
  ALDEGPT_TERRA_REFS_BULTOS_PROMPT,
  type AldeGptTerraLine,
} from "@/lib/aldeGptTerraDocumentExtract";
import { supabase } from "@/lib/supabase";

type ChatTurn = {
  role: "user" | "assistant";
  content: string;
  /** Nombres de archivos adjuntos en este turno (solo UI). */
  attachments?: string[];
};

type ChatSession = {
  id: string;
  title: string;
  messages: ChatTurn[];
  updatedAt: number;
};

type GeneralChatGptPanelProps = {
  open: boolean;
  onClose: () => void;
  /** Aplica filas extraídas del documento a la orden de recolección. */
  onApplyLines?: (lines: AldeGptTerraLine[]) => void;
  /**
   * Extracción documental en el padre (por orderId): sigue aunque cierres el panel
   * o cambies de OR. Si está definido, se usa en lugar del fetch local con archivos.
   */
  onSendExtract?: (args: {
    text: string;
    files: File[];
    extractMode: "full" | "refsBultosOnly";
  }) => Promise<{ reply: string; lines: AldeGptTerraLine[] }>;
  /** Busy del job Terra de la OR actual (padre). */
  extractJobBusy?: boolean;
  /** Inicio de extracción con adjunto(s) — para barra de carga en la OR. */
  onDocumentExtractStart?: (info: {
    fileNames: string[];
    total: number;
  }) => void;
  /** Progreso al procesar varios documentos en orden. */
  onDocumentExtractProgress?: (info: {
    current: number;
    total: number;
    fileName: string;
  }) => void;
  /** Fin de extracción (éxito o error). */
  onDocumentExtractEnd?: () => void;
};

function normalizeUploadFilename(name: string): string {
  const base = (name || "documento").slice(0, 180);
  const lastDot = base.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === base.length - 1) return base;
  return `${base.slice(0, lastDot)}${base.slice(lastDot).toLowerCase()}`;
}

const MAX_FILES = 8;
const MAX_FILE_BYTES = 40 * 1024 * 1024;

function makeId() {
  return Math.random().toString(36).slice(2, 11);
}

function titleFromMessages(messages: ChatTurn[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "Nuevo chat";
  const names = firstUser.attachments?.filter(Boolean) ?? [];
  const t = String(firstUser.content ?? "").trim().replace(/\s+/g, " ");
  if (t) return t.length > 42 ? `${t.slice(0, 42)}…` : t;
  if (names.length === 1) return names[0]!;
  if (names.length > 1) return `${names.length} archivos`;
  return "Nuevo chat";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Extensión / etiqueta tipo ChatGPT (PDF, DOCX…). */
function fileTypeLabel(file: File): string {
  const name = file.name || "";
  const ext = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1).toUpperCase()
    : "";
  if (ext) return ext.slice(0, 8);
  const mime = (file.type || "").toLowerCase();
  if (mime.includes("pdf")) return "PDF";
  if (mime.startsWith("image/")) return "IMG";
  if (mime.includes("sheet") || mime.includes("excel")) return "XLSX";
  if (mime.includes("word")) return "DOC";
  return "FILE";
}

/** Color del icono según tipo (estilo ChatGPT). */
function fileIconTone(file: File): { bg: string; fg: string } {
  const label = fileTypeLabel(file);
  if (label === "PDF") return { bg: "#E24B4A", fg: "#fff" };
  if (["DOC", "DOCX", "RTF", "ODT"].includes(label)) {
    return { bg: "#2B579A", fg: "#fff" };
  }
  if (["XLS", "XLSX", "CSV"].includes(label)) {
    return { bg: "#217346", fg: "#fff" };
  }
  if (["PPT", "PPTX"].includes(label)) {
    return { bg: "#C43E1C", fg: "#fff" };
  }
  if (["PNG", "JPG", "JPEG", "WEBP", "GIF", "BMP", "IMG"].includes(label)) {
    return { bg: "#7C3AED", fg: "#fff" };
  }
  if (["TXT", "MD", "JSON", "XML", "HTML", "HTM"].includes(label)) {
    return { bg: "#64748B", fg: "#fff" };
  }
  return { bg: "#52525B", fg: "#fff" };
}

export function GeneralChatGptPanel({
  open,
  onClose,
  onApplyLines,
  onSendExtract,
  extractJobBusy = false,
  onDocumentExtractStart,
  onDocumentExtractProgress,
  onDocumentExtractEnd,
}: GeneralChatGptPanelProps) {
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastLines, setLastLines] = useState<AldeGptTerraLine[]>([]);
  const [lastExtractMode, setLastExtractMode] = useState<
    "full" | "refsBultosOnly"
  >("full");
  const [errorBanner, setErrorBanner] = useState<{
    text: string;
    code?: number;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Tras elegir archivo(s), lanzar extracción solo refs+bultos. */
  const autoRefsBultosRef = useRef(false);

  const scrollBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    scrollBottom();
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(t);
  }, [open, history, busy, scrollBottom]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      if (window.innerWidth < 768) setSidebarOpen(false);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  const persistCurrentIfNeeded = useCallback(() => {
    if (history.length === 0) return;
    const id = activeSessionId ?? makeId();
    const next: ChatSession = {
      id,
      title: titleFromMessages(history),
      messages: history,
      updatedAt: Date.now(),
    };
    setSessions((prev) => {
      const without = prev.filter((s) => s.id !== id);
      return [next, ...without].slice(0, 30);
    });
    setActiveSessionId(id);
  }, [activeSessionId, history]);

  const startNewChat = () => {
    if (busy) return;
    persistCurrentIfNeeded();
    setHistory([]);
    setActiveSessionId(null);
    setErrorBanner(null);
    setLastLines([]);
    setInput("");
    setPendingFiles([]);
    inputRef.current?.focus();
  };

  const openSession = (session: ChatSession) => {
    if (busy) return;
    persistCurrentIfNeeded();
    setActiveSessionId(session.id);
    setHistory(session.messages);
    setErrorBanner(null);
    setLastLines([]);
    setInput("");
    setPendingFiles([]);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list);
    setErrorBanner(null);
    setPendingFiles((prev) => {
      const next = [...prev];
      for (const f of incoming) {
        if (next.length >= MAX_FILES) {
          setErrorBanner({
            text: `Máximo ${MAX_FILES} archivos por mensaje.`,
          });
          break;
        }
        if (f.size > MAX_FILE_BYTES) {
          setErrorBanner({
            text: `"${f.name}" supera ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB.`,
          });
          continue;
        }
        const dup = next.some(
          (p) => p.name === f.name && p.size === f.size && p.lastModified === f.lastModified,
        );
        if (!dup) next.push(f);
      }
      return next;
    });
  };

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const movePendingFile = (index: number, dir: -1 | 1) => {
    setPendingFiles((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[index]!;
      next[index] = next[j]!;
      next[j] = tmp;
      return next;
    });
  };

  type ChatMessagePayload = { role: "user" | "assistant"; content: string };

  const requestOneDocument = async (args: {
    token: string;
    message: string;
    historyPayload: ChatMessagePayload[];
    extractMode: "full" | "refsBultosOnly";
    file: File | null;
  }): Promise<{
    reply: string;
    lines: AldeGptTerraLine[];
    extractMode?: string;
  }> => {
    const { token, message, historyPayload, extractMode, file } = args;
    let res: Response;
    if (file) {
      const fd = new FormData();
      fd.append("message", message);
      fd.append("history", JSON.stringify(historyPayload));
      fd.append("extractMode", extractMode);
      fd.append("file", file, normalizeUploadFilename(file.name || "documento"));
      res = await fetch("/api/chat", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
    } else {
      res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message,
          history: historyPayload,
          extractMode,
        }),
      });
    }

    let data: {
      error?: string;
      reply?: string;
      lines?: AldeGptTerraLine[];
      extractMode?: string;
    } = {};
    try {
      data = (await res.json()) as typeof data;
    } catch {
      throw Object.assign(
        new Error(
          res.status === 504
            ? "Se agotó el tiempo de espera. Reintenta en unos segundos."
            : `Error ${res.status}. Reintenta en unos segundos.`,
        ),
        { code: res.status },
      );
    }

    if (!res.ok) {
      throw Object.assign(new Error(data.error || `Error ${res.status}`), {
        code: res.status,
      });
    }

    return {
      reply: String(data.reply ?? "").trim(),
      lines: Array.isArray(data.lines) ? data.lines : [],
      extractMode: data.extractMode,
    };
  };

  const send = async (opts?: {
    text?: string;
    files?: File[];
    extractMode?: "full" | "refsBultosOnly";
  }) => {
    const extractMode = opts?.extractMode ?? "full";
    const text =
      opts?.text !== undefined
        ? opts.text.trim()
        : extractMode === "refsBultosOnly"
          ? ALDEGPT_TERRA_REFS_BULTOS_PROMPT
          : input.trim();
    const files = opts?.files ?? pendingFiles;
    if ((!text && files.length === 0) || busy || extractJobBusy) return;

    setInput("");
    setPendingFiles([]);
    setErrorBanner(null);
    setBusy(true);
    setLastExtractMode(extractMode);

    const attachmentNames = files.map((f) => f.name);
    const displayContent =
      extractMode === "refsBultosOnly"
        ? files.length > 1
          ? `Leer ${files.length} documentos (en orden): solo referencias, bultos y reempaque`
          : "Leer documento: solo referencias, bultos y reempaque"
        : text ||
          (files.length === 1
            ? `Analiza el documento adjunto (${files[0]!.name}).`
            : `Analiza los ${files.length} documentos adjuntos en este orden:\n${files
                .map((f, i) => `${i + 1}. ${f.name}`)
                .join("\n")}`);

    const prevHistory = history;
    const nextHistory: ChatTurn[] = [
      ...prevHistory,
      {
        role: "user",
        content: displayContent,
        attachments: attachmentNames.length > 0 ? attachmentNames : undefined,
      },
    ];
    setHistory(nextHistory);

    const extractingDocument = files.length > 0;
    const useParentExtract = extractingDocument && typeof onSendExtract === "function";
    if (extractingDocument && !useParentExtract) {
      onDocumentExtractStart?.({
        fileNames: attachmentNames,
        total: files.length,
      });
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        throw Object.assign(new Error("Sesión expirada. Vuelve a iniciar sesión."), {
          code: 401,
        });
      }

      const historyPayload: ChatMessagePayload[] = prevHistory.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let extracted: AldeGptTerraLine[] = [];
      let reply = "";
      let parentAlreadyApplied = false;

      if (useParentExtract) {
        // Padre captura orderId: puedes cerrar el panel e ir a otra OR.
        const one = await onSendExtract!({
          text,
          files,
          extractMode,
        });
        extracted = one.lines;
        reply = one.reply;
        parentAlreadyApplied = true;
      } else if (files.length === 0) {
        const one = await requestOneDocument({
          token,
          message: text,
          historyPayload,
          extractMode,
          file: null,
        });
        extracted = one.lines;
        reply = one.reply;
        if (one.extractMode === "refsBultosOnly") {
          setLastExtractMode("refsBultosOnly");
        }
      } else {
        // Un pedido partido en varios docs: procesar EN ORDEN y concatenar filas.
        const parts: string[] = [];
        for (let i = 0; i < files.length; i++) {
          const file = files[i]!;
          onDocumentExtractProgress?.({
            current: i + 1,
            total: files.length,
            fileName: file.name,
          });
          const basePrompt =
            extractMode === "refsBultosOnly"
              ? ALDEGPT_TERRA_REFS_BULTOS_PROMPT
              : text ||
                `Extrae las líneas del documento adjunto (${file.name}) según las reglas de recolección.`;
          const orderedPrompt =
            files.length === 1
              ? basePrompt
              : [
                  `Documento ${i + 1} de ${files.length} del mismo pedido.`,
                  `Nombre del archivo: ${file.name}.`,
                  `Orden de extracción obligatorio: primero el documento 1, luego 2, … hasta ${files.length}.`,
                  `En ESTE turno extrae SOLO las filas de este documento (${i + 1}/${files.length}).`,
                  basePrompt,
                ].join("\n");

          const one = await requestOneDocument({
            token,
            message: orderedPrompt,
            historyPayload,
            extractMode,
            file,
          });
          if (one.extractMode === "refsBultosOnly") {
            setLastExtractMode("refsBultosOnly");
          }
          extracted = [...extracted, ...one.lines];
          if (one.reply) {
            parts.push(
              files.length > 1
                ? `**${i + 1}/${files.length} · ${file.name}:** ${one.reply}`
                : one.reply,
            );
          } else if (one.lines.length > 0) {
            parts.push(
              `**${i + 1}/${files.length} · ${file.name}:** ${one.lines.length} fila(s).`,
            );
          }
        }
        reply =
          parts.join("\n\n") ||
          (extracted.length > 0
            ? `Se extrajeron ${extracted.length} fila(s) de ${files.length} documento(s).`
            : "");
      }

      setLastLines(parentAlreadyApplied ? [] : extracted);

      if (!reply && extracted.length === 0) {
        throw new Error(
          `${ALDEGPT_TERRA_DISPLAY_NAME} no devolvió texto. Reintenta.`,
        );
      }

      const assistantText =
        reply ||
        (extracted.length > 0
          ? `Se extrajeron ${extracted.length} fila(s) del documento.`
          : "");

      const withReply: ChatTurn[] = [
        ...nextHistory,
        { role: "assistant", content: assistantText },
      ];
      setHistory(withReply);

      const id = activeSessionId ?? makeId();
      if (!activeSessionId) setActiveSessionId(id);
      setSessions((prev) => {
        const next: ChatSession = {
          id,
          title: titleFromMessages(withReply),
          messages: withReply,
          updatedAt: Date.now(),
        };
        const without = prev.filter((s) => s.id !== id);
        return [next, ...without].slice(0, 30);
      });

      if (
        extractingDocument &&
        extracted.length > 0 &&
        onApplyLines &&
        !parentAlreadyApplied
      ) {
        onApplyLines(extracted);
        setLastLines([]);
      }
    } catch (e) {
      const code =
        e && typeof e === "object" && "code" in e
          ? Number((e as { code?: unknown }).code)
          : undefined;
      setErrorBanner({
        text:
          e instanceof Error
            ? e.message
            : `No se pudo obtener respuesta de ${ALDEGPT_TERRA_DISPLAY_NAME}.`,
        code: Number.isFinite(code) ? code : undefined,
      });
    } finally {
      if (extractingDocument && !useParentExtract) onDocumentExtractEnd?.();
      setBusy(false);
      scrollBottom();
    }
  };

  const quickRefsBultos = () => {
    if (busy) return;
    if (pendingFiles.length > 0) {
      void send({
        files: pendingFiles,
        extractMode: "refsBultosOnly",
        text: ALDEGPT_TERRA_REFS_BULTOS_PROMPT,
      });
      return;
    }
    autoRefsBultosRef.current = true;
    fileRef.current?.click();
  };

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );

  if (!open) return null;

  const panelBusy = busy || extractJobBusy;
  const canSend =
    (Boolean(input.trim()) || pendingFiles.length > 0) && !panelBusy;

  return (
    <div
      className="fixed inset-0 z-[320] flex items-stretch justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex h-full w-full max-w-6xl overflow-hidden bg-white shadow-2xl dark:bg-[#212121] sm:h-[min(92vh,880px)] sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={ALDEGPT_TERRA_DISPLAY_NAME}
      >
        <aside
          className={`${
            sidebarOpen ? "flex" : "hidden"
          } w-[min(100%,16.5rem)] shrink-0 flex-col border-r border-black/5 bg-[#f9f9f9] dark:border-white/10 dark:bg-[#171717] md:flex`}
        >
          <div className="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
            <div className="flex min-w-0 items-center gap-2">
              <AldeGptTerraIcon size={20} />
              <span className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                {ALDEGPT_TERRA_DISPLAY_NAME}
              </span>
            </div>
            <button
              type="button"
              className="rounded-lg p-1.5 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10 md:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-label="Cerrar menú"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          </div>

          <div className="px-2 pb-2">
            <button
              type="button"
              disabled={panelBusy}
              onClick={startNewChat}
              className="flex w-full items-center gap-2 rounded-xl border border-black/8 bg-white px-3 py-2.5 text-sm font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-50 disabled:opacity-50 dark:border-white/10 dark:bg-[#212121] dark:text-zinc-100 dark:hover:bg-[#2a2a2a]"
            >
              <MessageSquarePlus className="h-4 w-4 shrink-0" />
              Nuevo chat
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            <p className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wide text-zinc-400">
              Chats
            </p>
            {sortedSessions.length === 0 ? (
              <p className="px-2 py-3 text-xs text-zinc-400">
                Tus conversaciones aparecerán aquí.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {sortedSessions.map((s) => {
                  const active = s.id === activeSessionId;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        disabled={panelBusy}
                        onClick={() => openSession(s)}
                        className={`w-full truncate rounded-lg px-2.5 py-2 text-left text-[13px] transition ${
                          active
                            ? "bg-black/8 font-medium text-zinc-900 dark:bg-white/10 dark:text-white"
                            : "text-zinc-600 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/5"
                        }`}
                        title={s.title}
                      >
                        {s.title}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <section className="relative flex min-w-0 flex-1 flex-col bg-white dark:bg-[#212121]">
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-black/5 px-3 py-2.5 dark:border-white/10">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded-lg p-2 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10 md:hidden"
                onClick={() => setSidebarOpen((v) => !v)}
                aria-label="Menú"
              >
                <Menu className="h-5 w-5" />
              </button>
              <button
                type="button"
                className="hidden rounded-lg p-2 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10 md:inline-flex"
                onClick={() => setSidebarOpen((v) => !v)}
                aria-label={sidebarOpen ? "Ocultar barra lateral" : "Mostrar barra lateral"}
                title={sidebarOpen ? "Ocultar barra lateral" : "Mostrar barra lateral"}
              >
                <PanelLeft className="h-5 w-5" />
              </button>
              <span className="ml-1 text-sm font-medium text-zinc-700 dark:text-zinc-200 md:hidden">
                {ALDEGPT_TERRA_DISPLAY_NAME}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
              aria-label="Cerrar"
              title="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            {history.length === 0 && !panelBusy ? (
              <div className="flex h-full min-h-[16rem] flex-col items-center justify-center px-6 text-center">
                <AldeGptTerraIcon size={36} className="mb-5 opacity-90" />
                <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
                  ¿En qué te ayudo?
                </h2>
                <p className="mt-3 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
                  Adjunta un documento o usa «Solo referencias y bultos» para
                  pedidos que solo necesitan código, cantidad y reempaque.
                </p>
              </div>
            ) : (
              <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6">
                {history.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] rounded-[22px] bg-[#f4f4f4] px-4 py-2.5 text-[15px] leading-relaxed text-zinc-900 dark:bg-[#303030] dark:text-zinc-50">
                        {m.attachments && m.attachments.length > 0 && (
                          <ul className="mb-2 space-y-1">
                            {m.attachments.map((name) => (
                              <li
                                key={name}
                                className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300"
                              >
                                <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                <span className="truncate">{name}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="flex gap-3">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/8 bg-white dark:border-white/15 dark:bg-[#2f2f2f]">
                        <AldeGptTerraIcon size={18} />
                      </div>
                      <div className="min-w-0 flex-1 pt-0.5 text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-100">
                        <ChatMarkdown content={m.content} />
                      </div>
                    </div>
                  ),
                )}

                {panelBusy && (
                  <div className="flex items-center gap-3 text-sm text-zinc-500">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-black/8 bg-white dark:border-white/15 dark:bg-[#2f2f2f]">
                      <AldeGptTerraIcon size={18} />
                    </div>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    {extractJobBusy ? "Extrayendo a la orden…" : "Pensando…"}
                  </div>
                )}
              </div>
            )}
          </div>

          {errorBanner && (
            <div
              role="alert"
              className="mx-auto mb-2 w-full max-w-3xl shrink-0 px-4 sm:px-6"
            >
              <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100">
                {errorBanner.code != null && (
                  <p className="mb-1 text-xs font-medium text-red-600 dark:text-red-300">
                    Error {errorBanner.code}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words">{errorBanner.text}</p>
              </div>
            </div>
          )}

          {lastLines.length > 0 && (
            <div className="mx-auto mb-2 w-full max-w-3xl shrink-0 px-4 sm:px-6">
              <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/60">
                <div className="max-h-40 overflow-auto">
                  <table className="w-full min-w-[320px] text-left text-[11px]">
                    <thead className="sticky top-0 bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      <tr>
                        <th className="px-2 py-1.5 font-medium">Ref</th>
                        <th className="px-2 py-1.5 font-medium">Bultos</th>
                        <th className="px-2 py-1.5 font-medium">Reempaque</th>
                        {lastExtractMode === "full" ? (
                          <>
                            <th className="px-2 py-1.5 font-medium">Desc</th>
                            <th className="px-2 py-1.5 font-medium">Und/b</th>
                            <th className="px-2 py-1.5 font-medium">Tot und</th>
                            <th className="px-2 py-1.5 font-medium">Peso/b</th>
                            <th className="px-2 py-1.5 font-medium">Peso tot</th>
                          </>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody className="text-zinc-800 dark:text-zinc-100">
                      {lastLines.slice(0, 40).map((row, i) => (
                        <tr
                          key={`${row.referencia ?? ""}-${i}`}
                          className="border-t border-zinc-200/80 dark:border-zinc-700/80"
                        >
                          <td className="max-w-[10rem] truncate px-2 py-1">
                            {row.referencia || "—"}
                          </td>
                          <td className="px-2 py-1">{row.bultos || "—"}</td>
                          <td className="px-2 py-1">
                            {row.reempaque ? (
                              <span className="font-medium text-amber-600">Sí</span>
                            ) : (
                              "—"
                            )}
                          </td>
                          {lastExtractMode === "full" ? (
                            <>
                              <td className="max-w-[8rem] truncate px-2 py-1">
                                {row.descripcion || "—"}
                              </td>
                              <td className="px-2 py-1">
                                {row.unidadesPorBulto || "—"}
                              </td>
                              <td className="px-2 py-1">
                                {row.unidadesTotales || "—"}
                              </td>
                              <td className="px-2 py-1">
                                {row.pesoPorBulto || "—"}
                              </td>
                              <td className="px-2 py-1">
                                {row.pesoTotalKg || "—"}
                              </td>
                            </>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {onApplyLines ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      onApplyLines(lastLines);
                      setLastLines([]);
                    }}
                    className="flex w-full items-center justify-center gap-2 border-t border-zinc-200 bg-emerald-600 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 dark:border-zinc-700"
                  >
                    <Table2 className="h-4 w-4" />
                    Añadir {lastLines.length} fila
                    {lastLines.length === 1 ? "" : "s"} a la orden
                  </button>
                ) : null}
              </div>
            </div>
          )}

          <div className="shrink-0 px-3 pb-4 pt-1 sm:px-6 sm:pb-5">
            <div className="mx-auto w-full max-w-3xl">
              <div className="mb-2 flex justify-center">
                <button
                  type="button"
                  disabled={busy}
                  onClick={quickRefsBultos}
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  title="Extrae solo referencia, bultos y reempaque (varios docs en el orden elegido)"
                >
                  <ScanText className="h-4 w-4" aria-hidden />
                  Solo referencias y bultos
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const list = e.target.files;
                  const autoRefs = autoRefsBultosRef.current;
                  autoRefsBultosRef.current = false;
                  if (!list || list.length === 0) return;
                  if (autoRefs) {
                    const files = Array.from(list);
                    e.target.value = "";
                    void send({
                      files,
                      extractMode: "refsBultosOnly",
                      text: ALDEGPT_TERRA_REFS_BULTOS_PROMPT,
                    });
                    return;
                  }
                  addFiles(list);
                  e.target.value = "";
                }}
              />
              <div
                className="aldegpt-composer rounded-[28px] border border-black/10 bg-white px-3 py-2.5 shadow-sm dark:border-white/10 dark:bg-[#303030]"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (busy) return;
                  addFiles(e.dataTransfer.files);
                }}
              >
                {pendingFiles.length > 0 && (
                  <div className="mb-2.5 px-0.5 pt-0.5">
                    {pendingFiles.length > 1 ? (
                      <p className="mb-1.5 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                        Se extraen en este orden (1 → {pendingFiles.length}). Usa ↑↓ para
                        reordenar.
                      </p>
                    ) : null}
                    <ul className="flex flex-wrap gap-2">
                      {pendingFiles.map((f, idx) => {
                        const tone = fileIconTone(f);
                        const typeLabel = fileTypeLabel(f);
                        return (
                          <li
                            key={`${f.name}-${f.size}-${f.lastModified}-${idx}`}
                            className="relative flex max-w-[260px] items-center gap-2 rounded-2xl border border-zinc-200 bg-white py-2 pl-2 pr-8 shadow-sm dark:border-zinc-600 dark:bg-[#212121]"
                            title={`${idx + 1}. ${f.name} · ${formatBytes(f.size)}`}
                          >
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[11px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
                              {idx + 1}
                            </span>
                            <span
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                              style={{ backgroundColor: tone.bg, color: tone.fg }}
                              aria-hidden
                            >
                              <FileText className="h-5 w-5" strokeWidth={2} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-semibold leading-tight text-zinc-900 dark:text-zinc-50">
                                {f.name}
                              </span>
                              <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                                {typeLabel}
                              </span>
                            </span>
                            {pendingFiles.length > 1 ? (
                              <span className="mr-1 flex shrink-0 flex-col gap-0.5">
                                <button
                                  type="button"
                                  disabled={busy || idx === 0}
                                  onClick={() => movePendingFile(idx, -1)}
                                  className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-white/10"
                                  aria-label="Subir en el orden"
                                  title="Subir"
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={busy || idx === pendingFiles.length - 1}
                                  onClick={() => movePendingFile(idx, 1)}
                                  className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:hover:bg-white/10"
                                  aria-label="Bajar en el orden"
                                  title="Bajar"
                                >
                                  <ArrowDown className="h-3.5 w-3.5" />
                                </button>
                              </span>
                            ) : null}
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => removePendingFile(idx)}
                              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-white shadow-sm transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                              aria-label={`Quitar ${f.name}`}
                            >
                              <X className="h-3 w-3" strokeWidth={3} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                <div className="flex items-end gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      autoRefsBultosRef.current = false;
                      fileRef.current?.click();
                    }}
                    className="mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-white/10"
                    aria-label="Adjuntar documentos"
                    title="Adjuntar uno o varios documentos (PDF, imagen…). El orden 1→N define cómo se cargan a la OR."
                  >
                    <Plus className="h-5 w-5" strokeWidth={2.25} aria-hidden />
                  </button>
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={input}
                    disabled={busy}
                    onChange={(e) => {
                      setInput(e.target.value);
                      const el = e.target;
                      el.style.height = "auto";
                      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                    }}
                    onPaste={(e) => {
                      const items = e.clipboardData?.files;
                      if (items && items.length > 0) {
                        addFiles(items);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    placeholder="Pregunta lo que quieras o adjunta un documento"
                    className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] text-zinc-900 outline-none placeholder:text-zinc-400 disabled:opacity-50 dark:text-zinc-50"
                  />
                  <button
                    type="button"
                    disabled={!canSend}
                    onClick={() => void send()}
                    className={`mb-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${
                      canSend
                        ? "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                        : "bg-zinc-300 text-zinc-500 dark:bg-zinc-600 dark:text-zinc-400"
                    }`}
                    aria-label="Enviar"
                    title="Enviar"
                  >
                    {busy || extractJobBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <ArrowUp className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                    )}
                  </button>
                </div>
              </div>
              <p className="mt-2 text-center text-[11px] text-zinc-400">
                {ALDEGPT_TERRA_DISPLAY_NAME} puede cometer errores. Verifica la información importante.
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
