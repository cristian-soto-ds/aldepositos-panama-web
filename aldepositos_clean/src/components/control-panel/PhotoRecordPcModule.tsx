"use client";

/**
 * Módulo PC — solo marcar qué RAs necesitan registro fotográfico.
 * La captura la hacen inventariadores en el módulo Celular.
 */

import React, { useMemo, useState } from "react";
import {
  BookmarkMinus,
  BookmarkPlus,
  ChevronDown,
  ListFilter,
  Search,
} from "lucide-react";
import type { Task } from "@/lib/types/task";
import {
  getTaskPhotos,
  isPhotoRegistrationRequested,
  setPhotoRegistrationRequested,
} from "@/lib/raPhotoRecord";

type PhotoRecordPcModuleProps = {
  tasks: Task[];
  onUpdateTask: (task: Task) => void | Promise<void>;
};

type ListFilter = "todos" | "cola" | "sin-marcar";
type PhotosFilter = "Todos" | "con-fotos" | "sin-fotos";

const TODOS = "Todos";

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "es"),
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-w-0 flex-1 basis-[7.5rem]">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        title={label}
        className="w-full cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-2 pr-7 text-[10px] font-bold dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

export function PhotoRecordPcModule({
  tasks,
  onUpdateTask,
}: PhotoRecordPcModuleProps) {
  const [search, setSearch] = useState("");
  const [listFilter, setListFilter] = useState<ListFilter>("todos");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [clientFilter, setClientFilter] = useState(TODOS);
  const [providerFilter, setProviderFilter] = useState(TODOS);
  const [brandFilter, setBrandFilter] = useState(TODOS);
  const [photosFilter, setPhotosFilter] = useState<PhotosFilter>("Todos");
  const [busyId, setBusyId] = useState<string | null>(null);

  const eligibleTasks = useMemo(
    () =>
      tasks
        .filter((t) => !t.dispatched)
        .sort((a, b) => String(b.ra).localeCompare(String(a.ra))),
    [tasks],
  );

  const clients = useMemo(
    () =>
      uniqueSorted(
        eligibleTasks.map((t) => String(t.mainClient ?? "").trim() || "Sin cliente"),
      ),
    [eligibleTasks],
  );

  const providers = useMemo(
    () =>
      uniqueSorted(
        eligibleTasks.map(
          (t) => String(t.provider ?? "").trim() || "Sin proveedor",
        ),
      ),
    [eligibleTasks],
  );

  const brands = useMemo(
    () =>
      uniqueSorted(
        eligibleTasks.map((t) => String(t.brand ?? "").trim() || "Sin marca"),
      ),
    [eligibleTasks],
  );

  const filteredTasks = useMemo(() => {
    let list = eligibleTasks;
    if (listFilter === "cola") {
      list = list.filter((t) => isPhotoRegistrationRequested(t));
    } else if (listFilter === "sin-marcar") {
      list = list.filter((t) => !isPhotoRegistrationRequested(t));
    }

    if (clientFilter !== TODOS) {
      list = list.filter(
        (t) => (String(t.mainClient ?? "").trim() || "Sin cliente") === clientFilter,
      );
    }
    if (providerFilter !== TODOS) {
      list = list.filter(
        (t) =>
          (String(t.provider ?? "").trim() || "Sin proveedor") === providerFilter,
      );
    }
    if (brandFilter !== TODOS) {
      list = list.filter(
        (t) => (String(t.brand ?? "").trim() || "Sin marca") === brandFilter,
      );
    }
    if (photosFilter === "con-fotos") {
      list = list.filter((t) => getTaskPhotos(t).length > 0);
    } else if (photosFilter === "sin-fotos") {
      list = list.filter((t) => getTaskPhotos(t).length === 0);
    }

    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) => {
      const hay = [t.ra, t.mainClient, t.subClient, t.provider, t.brand]
        .map((s) => String(s ?? "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [
    eligibleTasks,
    search,
    listFilter,
    clientFilter,
    providerFilter,
    brandFilter,
    photosFilter,
  ]);

  const queueCount = useMemo(
    () => eligibleTasks.filter((t) => isPhotoRegistrationRequested(t)).length,
    [eligibleTasks],
  );

  const activeFiltersCount = [
    clientFilter,
    providerFilter,
    brandFilter,
    photosFilter,
  ].filter((v) => v !== TODOS && v !== "Todos").length;

  const clearFilters = () => {
    setClientFilter(TODOS);
    setProviderFilter(TODOS);
    setBrandFilter(TODOS);
    setPhotosFilter("Todos");
  };

  const toggleRequested = async (task: Task) => {
    setBusyId(task.id);
    try {
      const next = setPhotoRegistrationRequested(
        task,
        !isPhotoRegistrationRequested(task),
      );
      await onUpdateTask(next);
    } finally {
      setBusyId(null);
    }
  };

  const markAllVisible = async (requested: boolean) => {
    const targets = filteredTasks.filter(
      (t) => isPhotoRegistrationRequested(t) !== requested,
    );
    for (const t of targets) {
      setBusyId(t.id);
      await onUpdateTask(setPhotoRegistrationRequested(t, requested));
    }
    setBusyId(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-700 dark:bg-slate-900 sm:px-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-sky-600 dark:text-sky-400">
              Registro fotográfico · PC
            </p>
            <h1 className="text-lg font-black uppercase tracking-widest text-[#16263F] dark:text-slate-100 sm:text-xl">
              Cola de fotos
            </h1>
            <p className="mt-0.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
              Indicá qué RAs necesitan fotos. Los inventariadores las toman en
              Celular.
            </p>
          </div>
          <p className="text-sm font-black tabular-nums text-[#16263F] dark:text-slate-100">
            {queueCount} en cola
          </p>
        </div>
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-3 overflow-hidden p-4 sm:gap-4 sm:p-6">
        <div className="flex shrink-0 flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900 sm:p-2.5">
          <div className="flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar RA, cliente…"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-xs font-semibold dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="hidden gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800 sm:flex">
              {(
                [
                  ["todos", "Todos"],
                  ["cola", "Cola"],
                  ["sin-marcar", "Sin"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setListFilter(id)}
                  className={`rounded-md px-2 py-1 text-[9px] font-black uppercase tracking-wide ${
                    listFilter === id
                      ? "bg-white text-[#16263F] shadow-sm dark:bg-slate-950 dark:text-slate-100"
                      : "text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              className={`inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1.5 text-[9px] font-black uppercase tracking-widest ${
                filtersOpen || activeFiltersCount > 0
                  ? "border-[#16263F] bg-[#16263F] text-white"
                  : "border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-200"
              }`}
            >
              <ListFilter className="h-3.5 w-3.5" />
              {activeFiltersCount > 0 ? activeFiltersCount : "Filtros"}
            </button>
          </div>

          <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800 sm:hidden">
            {(
              [
                ["todos", "Todos"],
                ["cola", "Cola"],
                ["sin-marcar", "Sin marcar"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setListFilter(id)}
                className={`flex-1 rounded-md px-1.5 py-1 text-[9px] font-black uppercase tracking-wide ${
                  listFilter === id
                    ? "bg-white text-[#16263F] shadow-sm dark:bg-slate-950 dark:text-slate-100"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {filtersOpen && (
            <div className="flex flex-wrap items-center gap-1.5">
              <FilterSelect
                label="Cliente"
                value={clientFilter}
                onChange={setClientFilter}
              >
                <option value={TODOS}>Cliente: todos</option>
                {clients.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                label="Proveedor"
                value={providerFilter}
                onChange={setProviderFilter}
              >
                <option value={TODOS}>Proveedor: todos</option>
                {providers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                label="Marca"
                value={brandFilter}
                onChange={setBrandFilter}
              >
                <option value={TODOS}>Marca: todas</option>
                {brands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                label="Fotos"
                value={photosFilter}
                onChange={(v) => setPhotosFilter(v as PhotosFilter)}
              >
                <option value="Todos">Fotos: todas</option>
                <option value="sin-fotos">Sin fotos</option>
                <option value="con-fotos">Con fotos</option>
              </FilterSelect>
              {activeFiltersCount > 0 && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-500 underline"
                >
                  Limpiar
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <p className="text-[10px] font-semibold text-slate-500">
              <span className="font-black text-[#16263F] dark:text-slate-100">
                {filteredTasks.length}
              </span>{" "}
              RA{filteredTasks.length === 1 ? "" : "s"}
            </p>
            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={filteredTasks.length === 0 || busyId !== null}
                onClick={() => void markAllVisible(true)}
                className="rounded-md bg-[#16263F] px-2 py-1 text-[8px] font-black uppercase tracking-widest text-white disabled:opacity-40"
              >
                Marcar
              </button>
              <button
                type="button"
                disabled={filteredTasks.length === 0 || busyId !== null}
                onClick={() => void markAllVisible(false)}
                className="rounded-md border border-slate-200 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-slate-600 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300"
              >
                Quitar
              </button>
            </div>
          </div>
        </div>

        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {filteredTasks.length === 0 ? (
            <li className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm font-semibold text-slate-400 dark:border-slate-600">
              No hay RAs con estos filtros.
            </li>
          ) : (
            filteredTasks.map((t) => {
              const requested = isPhotoRegistrationRequested(t);
              const photos = getTaskPhotos(t).length;
              const busy = busyId === t.id;
              return (
                <li
                  key={t.id}
                  className={`flex items-center gap-3 rounded-2xl border bg-white p-3 shadow-sm dark:bg-slate-900 sm:p-4 ${
                    requested
                      ? "border-amber-300 dark:border-amber-700"
                      : "border-slate-200 dark:border-slate-700"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-black text-[#16263F] dark:text-slate-100">
                        RA {t.ra}
                      </span>
                      {requested && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[8px] font-black uppercase text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
                          En cola
                        </span>
                      )}
                      {photos > 0 && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {photos} foto{photos === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-500">
                      {t.mainClient || "Sin cliente"}
                      {t.provider ? ` · ${t.provider}` : ""}
                      {t.brand ? ` · ${t.brand}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void toggleRequested(t)}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2.5 text-[10px] font-black uppercase tracking-widest disabled:opacity-50 ${
                      requested
                        ? "border-2 border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
                        : "bg-[#16263F] text-white"
                    }`}
                  >
                    {requested ? (
                      <>
                        <BookmarkMinus className="h-3.5 w-3.5" />
                        Quitar
                      </>
                    ) : (
                      <>
                        <BookmarkPlus className="h-3.5 w-3.5" />
                        Marcar
                      </>
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
