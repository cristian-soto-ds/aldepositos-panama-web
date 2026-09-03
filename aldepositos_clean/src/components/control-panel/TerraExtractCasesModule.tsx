"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Download,
  Loader2,
  MessageSquareWarning,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { ALDEGPT_TERRA_DISPLAY_NAME } from "@/lib/aldeGptTerraBrand";
import {
  getTerraExtractCaseSignedUrl,
  listTerraExtractCases,
  resolveTerraExtractCase,
  type TerraExtractCase,
  type TerraExtractCaseStatus,
} from "@/lib/terraExtractCases";

type FilterTab = Exclude<TerraExtractCaseStatus, "ok"> | "all";

const TABS: { id: FilterTab; label: string }[] = [
  { id: "failed", label: "Errores" },
  { id: "resolved", label: "Resueltos" },
  { id: "all", label: "Todos" },
];

function statusBadge(status: TerraExtractCaseStatus): string {
  switch (status) {
    case "failed":
      return "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200";
    case "ok":
      return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200";
    case "resolved":
      return "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function statusLabel(status: TerraExtractCaseStatus): string {
  switch (status) {
    case "failed":
      return "Error";
    case "ok":
      return "Correcto";
    case "resolved":
      return "Resuelto";
    default:
      return status;
  }
}

function formatWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString("es-PA", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function TerraExtractCasesModule() {
  const [tab, setTab] = useState<FilterTab>("failed");
  const [cases, setCases] = useState<TerraExtractCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [learningRule, setLearningRule] = useState("");
  const [resolveBusy, setResolveBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listTerraExtractCases({
        status: tab === "all" ? "all" : tab,
        limit: 100,
      });
      // Solo casos con error: nunca mostrar extracciones marcadas como correctas.
      const errorOnly = rows.filter((r) => r.status !== "ok");
      setCases(errorOnly);
      setSelectedId((prev) =>
        prev && errorOnly.some((r) => r.id === prev)
          ? prev
          : (errorOnly[0]?.id ?? null),
      );
    } catch (e) {
      console.error(e);
      setError(
        e instanceof Error
          ? e.message
          : "No se pudieron cargar los casos. ¿Aplicaste la migración 024?",
      );
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selected = useMemo(
    () => cases.find((c) => c.id === selectedId) ?? null,
    [cases, selectedId],
  );

  const linesPreview = useMemo(() => {
    if (!selected) return [];
    const snap = selected.lines_snapshot;
    return Array.isArray(snap) ? snap.slice(0, 40) : [];
  }, [selected]);

  const handleResolve = async () => {
    if (!selected || selected.status !== "failed") return;
    setResolveBusy(true);
    setError(null);
    try {
      await resolveTerraExtractCase({
        caseId: selected.id,
        resolutionNote: resolveNote.trim() || undefined,
        learningRule: learningRule.trim() || undefined,
      });
      setResolveNote("");
      setLearningRule("");
      await reload();
    } catch (e) {
      console.error(e);
      setError(
        e instanceof Error ? e.message : "No se pudo marcar como resuelto.",
      );
    } finally {
      setResolveBusy(false);
    }
  };

  const handleDownload = async (path: string, name: string) => {
    setDownloadBusy(path);
    try {
      const url = await getTerraExtractCaseSignedUrl(path);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : "No se pudo descargar.");
    } finally {
      setDownloadBusy(null);
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="relative flex min-h-0 flex-1 flex-col px-3 py-3 sm:px-5 sm:py-4">
        <header className="mb-3 shrink-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            {ALDEGPT_TERRA_DISPLAY_NAME}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-black tracking-tight text-[#16263F] dark:text-slate-50 sm:text-2xl">
              Casos Terra
            </h1>
            <button
              type="button"
              onClick={() => void reload()}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300"
            >
              <RefreshCw
                className={`h-3 w-3 ${loading ? "animate-spin" : ""}`}
              />
              Actualizar
            </button>
          </div>
          <p className="mt-1 max-w-2xl text-xs text-slate-500 dark:text-slate-400">
            Solo casos con error de extracción: documentos, notas y reglas para
            mejorar las próximas lecturas. Las extracciones correctas no se
            listan aquí.
          </p>
        </header>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wide ${
                tab === t.id
                  ? "bg-[#16263F] text-white dark:bg-slate-100 dark:text-slate-900"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {error && (
          <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
          <div className="flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 lg:max-w-sm">
            {loading ? (
              <div className="flex flex-1 items-center justify-center gap-2 p-6 text-xs text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando casos…
              </div>
            ) : cases.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-slate-500">
                <MessageSquareWarning className="h-8 w-8 opacity-40" />
                No hay casos en este filtro.
              </div>
            ) : (
              <ul className="min-h-0 flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {cases.map((c) => {
                  const active = c.id === selectedId;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(c.id)}
                        className={`flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors ${
                          active
                            ? "bg-slate-100 dark:bg-slate-800"
                            : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-bold text-slate-900 dark:text-slate-50">
                            OR #
                            {String(c.order_numero ?? "").trim() ||
                              (c.collection_order_id ?? "").slice(0, 8) ||
                              "—"}
                          </span>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${statusBadge(c.status)}`}
                          >
                            {statusLabel(c.status)}
                          </span>
                        </div>
                        <p className="truncate text-[11px] text-slate-500">
                          {c.proveedor || c.cliente || "Sin proveedor"}
                        </p>
                        <p className="line-clamp-2 text-[11px] text-slate-600 dark:text-slate-300">
                          {c.note || "(sin nota)"}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {formatWhen(c.created_at)}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center p-6 text-xs text-slate-500">
                Seleccioná un caso para ver el detalle.
              </div>
            ) : (
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-black text-[#16263F] dark:text-slate-50">
                      OR #
                      {String(selected.order_numero ?? "").trim() ||
                        (selected.collection_order_id ?? "").slice(0, 8) ||
                        "—"}
                    </h2>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${statusBadge(selected.status)}`}
                    >
                      {statusLabel(selected.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatWhen(selected.created_at)} · modelo{" "}
                    {selected.model} · modo {selected.extract_mode}
                  </p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    Prov. {selected.proveedor || "—"} · Cliente{" "}
                    {selected.cliente || "—"}
                  </p>
                </div>

                <section>
                  <h3 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Nota
                  </h3>
                  <p className="whitespace-pre-wrap rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-100">
                    {selected.note || "(sin nota)"}
                  </p>
                </section>

                <section>
                  <h3 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Documentos
                  </h3>
                  {(selected.storage_paths?.length ?? 0) === 0 ? (
                    <p className="text-xs text-slate-400">
                      {(selected.file_names ?? []).join(", ") ||
                        "Sin archivos adjuntos."}
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {selected.storage_paths.map((path, i) => {
                        const name =
                          selected.file_names[i] ||
                          path.split("/").pop() ||
                          `archivo-${i + 1}`;
                        return (
                          <li
                            key={path}
                            className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-2 py-1.5 text-xs dark:border-slate-700"
                          >
                            <span className="min-w-0 truncate">{name}</span>
                            <button
                              type="button"
                              disabled={downloadBusy === path}
                              onClick={() => void handleDownload(path, name)}
                              className="inline-flex shrink-0 items-center gap-1 font-semibold text-blue-700 hover:underline disabled:opacity-40 dark:text-blue-300"
                            >
                              {downloadBusy === path ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Download className="h-3.5 w-3.5" />
                              )}
                              Descargar
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                <details className="rounded-xl border border-slate-100 dark:border-slate-700">
                  <summary className="cursor-pointer px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Snapshot de líneas Terra ({linesPreview.length}
                    {Array.isArray(selected.lines_snapshot) &&
                    selected.lines_snapshot.length > linesPreview.length
                      ? ` / ${selected.lines_snapshot.length}`
                      : ""}
                    )
                  </summary>
                  <pre className="max-h-48 overflow-auto border-t border-slate-100 bg-slate-50 p-3 text-[10px] leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                    {JSON.stringify(linesPreview, null, 2)}
                  </pre>
                </details>

                {selected.status === "failed" && (
                  <section className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/30">
                    <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Marcar resuelto
                    </h3>
                    <textarea
                      value={resolveNote}
                      onChange={(e) =>
                        setResolveNote(e.target.value.slice(0, 2000))
                      }
                      rows={2}
                      placeholder="Nota de resolución (opcional)…"
                      className="w-full resize-none rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-xs outline-none dark:border-amber-800 dark:bg-slate-950"
                    />
                    <div>
                      <label className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200">
                        <Sparkles className="h-3 w-3" />
                        Regla para Terra (opcional)
                      </label>
                      <textarea
                        value={learningRule}
                        onChange={(e) =>
                          setLearningRule(e.target.value.slice(0, 2000))
                        }
                        rows={3}
                        placeholder="Ej.: En facturas de este proveedor, la columna BLTO es bultos y DZ son docenas…"
                        className="w-full resize-none rounded-lg border border-amber-200 bg-white px-2.5 py-2 text-xs outline-none dark:border-amber-800 dark:bg-slate-950"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={resolveBusy}
                      onClick={() => void handleResolve()}
                      className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-white hover:bg-amber-500 disabled:opacity-50"
                    >
                      {resolveBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      Marcar resuelto
                    </button>
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
