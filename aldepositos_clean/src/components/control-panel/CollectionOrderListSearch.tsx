"use client";

import React, { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";

type CollectionOrderListSearchProps = {
  value: string;
  onChange: (value: string) => void;
};

/**
 * Lupa de búsqueda de OR. En celular es solo el ícono y se abre al tocarla;
 * en pantallas grandes queda visible. Atajo: «/» enfoca el campo, Esc limpia.
 */
export function CollectionOrderListSearch({
  value,
  onChange,
}: CollectionOrderListSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hasValue = value.trim().length > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className={`group relative flex h-8 items-center rounded-lg border bg-white transition-[width,border-color,box-shadow] duration-200 ease-out focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-500/15 sm:h-9 dark:bg-slate-900 ${
        hasValue
          ? "w-40 border-indigo-300 sm:w-52 lg:w-56 dark:border-indigo-500/50"
          : "w-8 cursor-pointer border-slate-200 focus-within:w-40 sm:w-9 sm:focus-within:w-52 lg:w-36 lg:cursor-text lg:focus-within:w-56 dark:border-slate-600"
      }`}
      onClick={() => inputRef.current?.focus()}
    >
      <Search
        className={`pointer-events-none absolute left-2 h-4 w-4 shrink-0 transition-colors sm:left-2.5 ${
          hasValue ? "text-indigo-500" : "text-slate-400 group-focus-within:text-indigo-500"
        }`}
        aria-hidden
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (value) onChange("");
            else inputRef.current?.blur();
          }
        }}
        placeholder="Buscar OR…"
        title="Buscar por número de OR, proveedor, cliente, marca, RA o referencia"
        aria-label="Buscar órdenes de recolección"
        autoComplete="off"
        spellCheck={false}
        className="h-full w-full min-w-0 rounded-lg bg-transparent pl-8 pr-7 text-xs font-medium text-slate-800 outline-none placeholder:text-slate-400 sm:pl-9 dark:text-slate-100 [&::-webkit-search-cancel-button]:hidden"
      />
      {hasValue ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label="Limpiar búsqueda"
          title="Limpiar (Esc)"
          className="absolute right-1.5 inline-flex h-5 w-5 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-2 hidden rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-semibold leading-4 text-slate-400 group-focus-within:hidden lg:block dark:border-slate-600 dark:bg-slate-800">
          /
        </kbd>
      )}
    </div>
  );
}
