"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  BookMarked,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  REFERENCE_CATALOG_EMPTY_FORM,
  deleteReferenceCatalogRow,
  fetchReferenceCatalogPage,
  insertReferenceCatalogRow,
  normalizePartNumber,
  referenceRecordToForm,
  updateReferenceCatalogRow,
  type ReferenceCatalogRecord,
  type ReferenceCatalogSaveInput,
} from "@/lib/referenceCatalog";

const PAGE_SIZE = 30;

function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(n);
}

type EditorMode = "create" | "edit";

export function ReferenceCatalogModule() {
  const [rows, setRows] = useState<ReferenceCatalogRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [searchApplied, setSearchApplied] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("create");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ReferenceCatalogSaveInput>(
    REFERENCE_CATALOG_EMPTY_FORM,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setBanner(null);
    const { rows: data, total: count } = await fetchReferenceCatalogPage({
      search: searchApplied,
      page,
      pageSize: PAGE_SIZE,
    });
    setRows(data);
    setTotal(count);
    setLoading(false);
  }, [page, searchApplied]);

  useEffect(() => {
    // Carga y paginación: patrón estándar de fetch con setState al recibir datos.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sincronizar lista con Supabase
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const openCreate = () => {
    setEditorMode("create");
    setEditingId(null);
    setForm({ ...REFERENCE_CATALOG_EMPTY_FORM });
    setEditorOpen(true);
    setBanner(null);
  };

  const openEdit = (r: ReferenceCatalogRecord) => {
    setEditorMode("edit");
    setEditingId(r.id);
    setForm(referenceRecordToForm(r));
    setEditorOpen(true);
    setBanner(null);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingId(null);
    setForm({ ...REFERENCE_CATALOG_EMPTY_FORM });
  };

  const onSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setBanner(null);
    const result =
      editorMode === "create"
        ? await insertReferenceCatalogRow(form)
        : editingId
          ? await updateReferenceCatalogRow(editingId, form)
          : { ok: false as const, message: "Fila no válida." };
    setSaving(false);
    if (!result.ok) {
      setBanner({ type: "err", text: result.message });
      return;
    }
    setBanner({ type: "ok", text: "Guardado correctamente." });
    closeEditor();
    void load();
  };

  const onDelete = async (r: ReferenceCatalogRecord) => {
    if (
      !window.confirm(
        `¿Eliminar la referencia «${r.numero_parte}» del catálogo? Esto no afecta órdenes ya capturadas.`,
      )
    ) {
      return;
    }
    setBanner(null);
    const result = await deleteReferenceCatalogRow(r.id);
    if (!result.ok) {
      setBanner({ type: "err", text: result.message });
      return;
    }
    setBanner({ type: "ok", text: "Referencia eliminada." });
    void load();
  };

  const applySearch = () => {
    setSearchApplied(searchInput.trim());
    setPage(0);
  };

  const normPreview = normalizePartNumber(form.numero_parte);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
      <header className="shrink-0 flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-end md:justify-between dark:border-slate-700">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[#16263F] dark:text-slate-100">
            <BookMarked className="h-7 w-7 shrink-0 text-emerald-600" />
            <h1 className="text-xl font-black uppercase tracking-tight md:text-2xl">
              Catálogo de referencias
            </h1>
          </div>
          <p className="max-w-xl text-xs font-medium text-slate-600 dark:text-slate-400 md:text-sm">
            Maestro WMS: número de parte, medidas y peso. Se usa para autocompletar
            en ingreso rápido y detallado. Clave única: número normalizado (mayúsculas,
            sin espacios extra).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-black uppercase tracking-wider text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/80"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            Actualizar
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-md transition hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            Nueva referencia
          </button>
        </div>
      </header>

      {banner && (
        <div
          className={`shrink-0 rounded-xl border px-4 py-3 text-sm font-semibold ${
            banner.type === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
              : "border-red-200 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
          }`}
        >
          {banner.text}
        </div>
      )}

      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applySearch();
            }}
            placeholder="Buscar por número de parte o descripción…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm font-medium text-[#16263F] outline-none ring-emerald-500/20 focus:border-emerald-500 focus:ring-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <button
          type="button"
          onClick={applySearch}
          className="rounded-xl bg-[#16263F] px-5 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-md transition hover:bg-black dark:bg-slate-700 dark:hover:bg-slate-600"
        >
          Buscar
        </button>
      </div>

      <div className="inventory-table-scroll-host flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[960px] border-collapse text-left text-xs md:text-sm">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 text-[9px] font-black uppercase tracking-widest text-slate-600 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/95 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2.5">Nº parte</th>
                <th className="px-3 py-2.5">Descripción</th>
                <th className="px-3 py-2.5 text-center">Piezas</th>
                <th className="px-3 py-2.5 text-center">L/W/H cm</th>
                <th className="px-3 py-2.5 text-center">Peso/pz kg</th>
                <th className="px-3 py-2.5 text-center">m³</th>
                <th className="px-3 py-2.5">Und.</th>
                <th className="px-3 py-2.5 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center">
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-emerald-600" />
                    <p className="mt-2 text-sm font-bold text-slate-500">
                      Cargando catálogo…
                    </p>
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-12 text-center text-sm font-medium text-slate-500"
                  >
                    No hay filas. Ajusta la búsqueda o crea una referencia nueva.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="transition-colors hover:bg-sky-50/60 dark:hover:bg-slate-800/80"
                  >
                    <td className="px-3 py-2 font-bold text-[#16263F] dark:text-slate-100">
                      {r.numero_parte}
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-slate-600 dark:text-slate-300" title={r.descripcion ?? ""}>
                      {r.descripcion || "—"}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      {fmtNum(r.piezas)}
                    </td>
                    <td className="px-3 py-2 text-center text-[11px] font-medium tabular-nums text-slate-700 dark:text-slate-300">
                      {fmtNum(r.longitud_cm)} / {fmtNum(r.ancho_cm)} /{" "}
                      {fmtNum(r.altura_cm)}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      {fmtNum(r.peso_por_pieza_kg)}
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">
                      {fmtNum(r.volumen_m3)}
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                      {r.unidad || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDelete(r)}
                          className="rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                          title="Eliminar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/90 px-3 py-2.5 text-xs font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-400">
          <span>
            {total === 0
              ? "0 referencias"
              : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} de ${total}`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-lg border border-slate-200 bg-white p-2 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[4rem] text-center tabular-nums">
              {page + 1} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages - 1 || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-lg border border-slate-200 bg-white p-2 disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {editorOpen && (
        <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
          <div
            className="flex max-h-[min(92dvh,720px)] w-full max-w-lg flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-600 dark:bg-slate-900 sm:rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ref-catalog-editor-title"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <h2
                id="ref-catalog-editor-title"
                className="text-sm font-black uppercase tracking-wide text-[#16263F] dark:text-slate-100"
              >
                {editorMode === "create"
                  ? "Nueva referencia"
                  : "Editar referencia"}
              </h2>
              <button
                type="button"
                onClick={closeEditor}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => void onSubmitForm(e)}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
            >
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                    Número de parte *
                  </label>
                  <input
                    required
                    value={form.numero_parte}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, numero_parte: e.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-[#16263F] outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <p className="mt-1 text-[10px] font-medium text-slate-500">
                    Clave única (normalizada):{" "}
                    <span className="font-mono text-emerald-700 dark:text-emerald-400">
                      {normPreview || "—"}
                    </span>
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                    Descripción
                  </label>
                  <input
                    value={form.descripcion}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, descripcion: e.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Piezas
                    </label>
                    <input
                      inputMode="numeric"
                      value={form.piezas}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, piezas: e.target.value }))
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm tabular-nums dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Unidad
                    </label>
                    <input
                      value={form.unidad}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, unidad: e.target.value }))
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ["longitud_cm", "L (cm)"],
                      ["ancho_cm", "W (cm)"],
                      ["altura_cm", "H (cm)"],
                    ] as const
                  ).map(([key, label]) => (
                    <div key={key}>
                      <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                        {label}
                      </label>
                      <input
                        inputMode="decimal"
                        value={form[key]}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, [key]: e.target.value }))
                        }
                        className="w-full rounded-xl border border-slate-200 px-2 py-2 text-sm tabular-nums dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      />
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Peso / pieza (kg)
                    </label>
                    <input
                      inputMode="decimal"
                      value={form.peso_por_pieza_kg}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          peso_por_pieza_kg: e.target.value,
                        }))
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm tabular-nums dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Volumen (m³)
                    </label>
                    <input
                      inputMode="decimal"
                      value={form.volumen_m3}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, volumen_m3: e.target.value }))
                      }
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm tabular-nums dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
                <button
                  type="button"
                  onClick={closeEditor}
                  className="flex-1 rounded-xl border border-slate-200 py-3 text-xs font-black uppercase tracking-wider text-slate-600 dark:border-slate-600 dark:text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-xs font-black uppercase tracking-wider text-white disabled:opacity-60"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
