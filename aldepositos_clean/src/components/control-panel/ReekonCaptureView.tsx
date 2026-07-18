"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Layers,
  LayoutGrid,
  List,
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  Recycle,
  Save,
  Trash2,
} from "lucide-react";
import type { QuickMeasureRow, ReferenceCaptureMode } from "@/lib/quickInventoryTypes";
import { isQuickRowComplete } from "@/lib/quickInventoryTypes";
import {
  SyncStatusBadge,
  type AutosaveState,
  type SyncStatus,
} from "@/components/control-panel/SyncStatusBadge";
import { ReekonReferenceListSheet } from "@/components/control-panel/ReekonReferenceListSheet";
import {
  cubicajeM3FromDims,
  formatCubicaje2,
  formatMeasure2,
  normalizeMeasureField,
  sanitizeMeasureTyping,
} from "@/lib/measureDecimals";
import { useReekonTapeInput } from "@/hooks/useReekonTapeInput";
type DimField = "l" | "w" | "h";

type ReekonCaptureViewProps = {
  measureRows: QuickMeasureRow[];
  referenceMode: ReferenceCaptureMode;
  onSwitchReferenceMode: (mode: ReferenceCaptureMode) => void;
  activeRowId: string | null;
  onActiveRowChange: (id: string) => void;
  onUpdateRow: (id: string, field: keyof QuickMeasureRow, value: string | boolean | string[]) => void;
  onReferenceChange: (id: string, value: string) => void;
  onReferenceBlur: (id: string, value: string) => void;
  onAddRow: () => void;
  /** Paletizado: crear una paleta nueva (siguiente número) y enfocar su primera fila. */
  onAddPallet?: () => void;
  /** Paletizado: añadir una fila a una paleta ya existente (la de la fila activa). */
  onAddRowToPallet?: (palletNum: number) => void;
  /** Paletizado: fijar el peso total de una paleta (se replica en todas sus filas). */
  onSetPalletWeight?: (palletNum: number, value: string) => void;
  onDeleteRow: (id: string) => void;
  raLabel: string;
  declaredBultos: number;
  physicalBultos: number;
  faltantes: number;
  totalCbm: number;
  totalWeight: number;
  completedCount: number;
  onBack: () => void;
  onSwitchToTable: () => void;
  onSave: () => void;
  onPause?: () => void;
  onResume?: () => void;
  isPaused?: boolean;
  canPause?: boolean;
  autosaveState: AutosaveState;
  isSaving: boolean;
  /** Estado de sincronización enriquecido (última sync, conexión, cola). */
  syncStatus?: SyncStatus;
};

const DIM_ORDER: DimField[] = ["l", "w", "h"];
const DIM_LABELS: Record<DimField, string> = { l: "Largo", w: "Ancho", h: "Alto" };

const REEKON_MODES: { id: ReferenceCaptureMode; label: string }[] = [
  { id: "with", label: "Con refs" },
  { id: "without", label: "Sin refs" },
  { id: "palletized", label: "Paletizado" },
];

function palletOf(row: QuickMeasureRow): number {
  return Math.max(1, Number(row.pallet) || 1);
}

function strVal(v: string | number | undefined): string {
  return String(v ?? "").trim();
}

/**
 * Enfoca un input de la cinta sin abrir el teclado virtual (Android/iOS).
 * `inputMode="none"` no basta en muchos celulares (Gboard/SwiftKey); hace falta
 * `readOnly` antes del focus. La REEKON sigue enviando teclas HID.
 *
 * Campo numérico (peso o dimensión) con BORRADOR LOCAL: lo tecleado vive en un
 * estado propio y no se escribe al estado global en cada tecla. Solo se sincroniza
 * desde `value` cuando el campo NO tiene foco, y se confirma (normalizado) al salir
 * del campo. Así el guardado/normalización que da la vuelta por la sincronización
 * no pisa lo que el inventariador está escribiendo (ej. "21.32" ya no se auto-
 * completa a "21.00" al hacer una pausa buscando el punto).
 *
 * Para dimensiones (cinta REEKON): al pulsar Enter se confirma el borrador ANTES
 * de avanzar de campo/línea, para no perder la última medida (el Alto).
 */
function focusTapeField(el: HTMLInputElement) {
  el.readOnly = true;
  el.focus({ preventScroll: true });
  el.select();
  const vk = (navigator as Navigator & { virtualKeyboard?: { hide?: () => void } })
    .virtualKeyboard;
  vk?.hide?.();
}

const ReekonMeasureInput = memo(function ReekonMeasureInput({
  rowId,
  field,
  value,
  onCommit,
  isDimension = false,
  onTapeKeyDown,
}: {
  rowId: string;
  field: "weight" | DimField;
  value: string;
  onCommit: (rowId: string, field: "weight" | DimField, value: string) => void;
  isDimension?: boolean;
  onTapeKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);
  const draftRef = useRef(value);
  const replaceOnTypeRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      draftRef.current = value;
      setDraft(value);
    }
  }, [value]);

  const commit = (raw: string) => {
    const norm = normalizeMeasureField(raw);
    draftRef.current = norm;
    setDraft(norm);
    onCommit(rowId, field, norm);
  };

  const filled = Boolean(draft.trim());

  return (
    <input
      type="text"
      inputMode={isDimension ? "none" : "decimal"}
      readOnly={isDimension}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="done"
      {...(isDimension ? { "data-reekon-field": field } : {})}
      className={`reekon-input reekon-input-immersive w-full text-center ${
        isDimension && filled ? "reekon-input-filled" : ""
      }`}
      value={draft}
      placeholder="0.00"
      onTouchStart={
        isDimension
          ? (e) => {
              // Android: marcar readOnly ANTES del focus del toque evita Gboard/SwiftKey.
              e.currentTarget.readOnly = true;
            }
          : undefined
      }
      onFocus={(e) => {
        focusedRef.current = true;
        if (isDimension) {
          // Mantener readOnly y cerrar teclado si venía de Bultos/Peso.
          e.currentTarget.readOnly = true;
          replaceOnTypeRef.current = true;
          e.currentTarget.select();
          const vk = (navigator as Navigator & { virtualKeyboard?: { hide?: () => void } })
            .virtualKeyboard;
          vk?.hide?.();
          return;
        }
        e.currentTarget.select();
      }}
      onChange={
        isDimension
          ? undefined
          : (e) => {
              const next = sanitizeMeasureTyping(e.target.value);
              draftRef.current = next;
              setDraft(next);
            }
      }
      onBlur={() => {
        focusedRef.current = false;
        replaceOnTypeRef.current = false;
        commit(draftRef.current);
      }}
      onKeyDown={
        isDimension
          ? (e) => {
              // HID de la cinta: readOnly bloquea onChange; aplicamos teclas a mano.
              if (e.key === "Backspace") {
                e.preventDefault();
                replaceOnTypeRef.current = false;
                const next = draftRef.current.slice(0, -1);
                draftRef.current = next;
                setDraft(next);
                return;
              }
              if (e.key === "Delete") {
                e.preventDefault();
                replaceOnTypeRef.current = false;
                draftRef.current = "";
                setDraft("");
                return;
              }
              if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                e.preventDefault();
                const next = sanitizeMeasureTyping(
                  replaceOnTypeRef.current ? e.key : draftRef.current + e.key,
                );
                replaceOnTypeRef.current = false;
                draftRef.current = next;
                setDraft(next);
                return;
              }
              if (e.key === "Enter" && onTapeKeyDown) {
                // Confirmar borrador ANTES de avanzar (no perder el Alto).
                commit(draftRef.current);
                onTapeKeyDown(e);
              }
            }
          : undefined
      }
    />
  );
});

/**
 * Campo de texto (Bultos o Referencia) con el MISMO borrador local que
 * `ReekonMeasureInput`: lo tecleado vive en estado local y solo se sincroniza
 * desde `value` cuando no tiene foco; se confirma al salir del campo (`onBlur`).
 * Evita que el guardado/sincronización pise lo que el usuario está escribiendo
 * (ej. "324" o "REFERENCIA 1" con pausas).
 *
 * `sanitize` limpia lo tecleado en vivo (p.ej. solo dígitos para bultos). Para
 * texto libre, pásalo como identidad.
 */
const ReekonDraftInput = memo(function ReekonDraftInput({
  rowId,
  value,
  onCommit,
  sanitize,
  className,
  placeholder,
  inputMode = "text",
}: {
  rowId: string;
  value: string;
  onCommit: (rowId: string, value: string) => void;
  sanitize?: (raw: string) => string;
  className: string;
  placeholder?: string;
  inputMode?: "text" | "numeric" | "decimal";
}) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  return (
    <input
      type="text"
      inputMode={inputMode}
      autoComplete="off"
      className={className}
      value={draft}
      placeholder={placeholder}
      onFocus={(e) => {
        focusedRef.current = true;
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(sanitize ? sanitize(e.target.value) : e.target.value)}
      onBlur={() => {
        focusedRef.current = false;
        onCommit(rowId, draft);
      }}
    />
  );
});

export function ReekonCaptureView({
  measureRows,
  referenceMode,
  onSwitchReferenceMode,
  activeRowId,
  onActiveRowChange,
  onUpdateRow,
  onReferenceChange,
  onReferenceBlur,
  onAddRow,
  onAddPallet,
  onAddRowToPallet,
  onSetPalletWeight,
  onDeleteRow,
  raLabel,
  declaredBultos,
  physicalBultos,
  faltantes,
  totalCbm,
  totalWeight,
  completedCount,
  onBack,
  onSwitchToTable,
  onSave,
  onPause,
  onResume,
  isPaused = false,
  canPause = false,
  autosaveState,
  isSaving,
  syncStatus,
}: ReekonCaptureViewProps) {
  const formRef = useRef<HTMLDivElement>(null);
  const { handleDimensionKeyDown } = useReekonTapeInput();

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [refListOpen, setRefListOpen] = useState(false);

  // Peso de paleta con borrador local: escribir es instantáneo y solo se confirma
  // al salir del campo (evita el bloqueo al replicar el peso en todas las filas).
  const [palletWeightDraft, setPalletWeightDraft] = useState("");
  const palletWeightFocused = useRef(false);

  // Cuando saltamos de línea con la cinta, enfocamos el Largo de la nueva línea.
  const focusLargoOnNext = useRef(false);

  const activeIndex = useMemo(
    () => measureRows.findIndex((r) => r.id === activeRowId),
    [measureRows, activeRowId],
  );
  const activeRow = activeIndex >= 0 ? measureRows[activeIndex] : measureRows[0] ?? null;
  const activeId = activeRow?.id ?? null;
  const palletized = referenceMode === "palletized";

  const rowCbm = activeRow
    ? cubicajeM3FromDims(activeRow.l, activeRow.w, activeRow.h, activeRow.bultos, activeRow.reempaque)
    : 0;
  const rowComplete = activeRow ? isQuickRowComplete(activeRow) : false;
  // Reempaque: referencia que no se mide (no lleva bultos/peso/medidas).
  const isReempaque = activeRow?.reempaque === true;

  const activePalletWeight = String(activeRow?.palletWeight ?? "");
  useEffect(() => {
    if (!palletWeightFocused.current) setPalletWeightDraft(activePalletWeight);
  }, [activePalletWeight, activeId]);

  // Mantiene la referencia activa siempre visible en el carrusel (orden de la tabla).
  const refStripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeIndex < 0) return;
    const chips = refStripRef.current?.querySelectorAll<HTMLElement>("[data-ref-chip]");
    chips?.[activeIndex]?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [activeIndex, activeId]);

  useEffect(() => {
    document.documentElement.classList.add("reekon-immersive-active");
    document.body.classList.add("reekon-immersive-active");
    return () => {
      document.documentElement.classList.remove("reekon-immersive-active");
      document.body.classList.remove("reekon-immersive-active");
    };
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    onFs();
    // Al salir de la vista, abandonar pantalla completa si sigue activa.
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  const enterFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      /* Bloqueado por el navegador (sin gesto o no soportado). */
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await enterFullscreen();
      }
    } catch {
      /* Algunos navegadores móviles no lo permiten; se ignora. */
    }
  }, [enterFullscreen]);

  // Pantalla completa automática en móvil al abrir el RA (y al cambiar de RA).
  // Si el navegador exige gesto, entra con el primer toque dentro de la vista.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const isMobile =
      window.matchMedia("(max-width: 900px)").matches &&
      window.matchMedia("(pointer: coarse)").matches;
    if (!isMobile) return;

    void enterFullscreen();

    const onFirstGesture = () => {
      void enterFullscreen();
    };
    document.addEventListener("pointerdown", onFirstGesture, { once: true });
    return () => document.removeEventListener("pointerdown", onFirstGesture);
  }, [raLabel, enterFullscreen]);

  useEffect(() => {
    if (!activeRowId && measureRows.length > 0) {
      onActiveRowChange(measureRows[0].id);
    }
  }, [activeRowId, measureRows, onActiveRowChange]);

  const focusDim = useCallback((field: DimField) => {
    const el = formRef.current?.querySelector<HTMLInputElement>(
      `input[data-reekon-field="${field}"]`,
    );
    if (!el) return;
    // Si el foco venía de Bultos/Peso, blur primero para cerrar el teclado virtual.
    const active = document.activeElement;
    if (
      active instanceof HTMLInputElement &&
      active !== el &&
      !active.dataset.reekonField
    ) {
      active.blur();
      window.setTimeout(() => focusTapeField(el), 30);
      return;
    }
    focusTapeField(el);
  }, []);

  // Tras cambiar de línea con la cinta, enfocar Largo automáticamente.
  useEffect(() => {
    if (!focusLargoOnNext.current) return;
    focusLargoOnNext.current = false;
    const t = setTimeout(() => focusDim("l"), 80);
    return () => clearTimeout(t);
  }, [activeId, focusDim]);

  const selectRow = useCallback((id: string) => onActiveRowChange(id), [onActiveRowChange]);

  // En paletizado, "añadir fila" se agrega a la paleta de la fila activa (no siempre
  // a la última). Así, aunque vayas por la paleta 3, puedes seguir sumando a la 1.
  const addRowHere = useCallback(() => {
    if (palletized && activeRow && onAddRowToPallet) {
      onAddRowToPallet(palletOf(activeRow));
      return;
    }
    onAddRow();
  }, [palletized, activeRow, onAddRowToPallet, onAddRow]);

  const goPrev = () => {
    if (activeIndex > 0) selectRow(measureRows[activeIndex - 1].id);
  };
  const goNext = () => {
    if (activeIndex < measureRows.length - 1) selectRow(measureRows[activeIndex + 1].id);
  };

  const handleDeleteCurrent = () => {
    if (!activeId || measureRows.length <= 1) return;
    const idx = activeIndex;
    const nextId = measureRows[idx + 1]?.id ?? measureRows[idx - 1]?.id;
    onDeleteRow(activeId);
    if (nextId) onActiveRowChange(nextId);
  };

  // Al terminar el Alto con la cinta: salta a la siguiente línea y enfoca su Largo.
  const finishMeasuresAndAdvance = () => {
    if (activeIndex < measureRows.length - 1) {
      focusLargoOnNext.current = true;
      onActiveRowChange(measureRows[activeIndex + 1].id);
    }
  };

  const progressPct = measureRows.length ? Math.round((completedCount / measureRows.length) * 100) : 0;
  const pendingCount = measureRows.length - completedCount;

  return (
    <div className="reekon-immersive text-slate-900 dark:text-slate-100">
      {/* Header compacto */}
      <header className="reekon-safe-top shrink-0 border-b border-slate-200/80 bg-white/95 px-3 py-2 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto flex w-full max-w-md items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-slate-800"
            aria-label="Volver"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{raLabel || "Inventario"}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {isPaused ? (
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  En pausa ·{" "}
                </span>
              ) : null}
              {completedCount}/{measureRows.length} líneas · {physicalBultos}/{declaredBultos} bultos
              {faltantes > 0 ? ` · faltan ${faltantes}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100 dark:active:bg-slate-800"
            aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onSwitchToTable}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 active:bg-slate-100 dark:active:bg-slate-800"
            aria-label="Vista tabla"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
        <div className="mx-auto mt-2 h-1 w-full max-w-md overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </header>

      {/* Selector de modo (no invasivo) */}
      <div className="mx-auto flex w-full max-w-md shrink-0 items-center gap-2 px-3 pt-1.5">
        <div className="inline-flex flex-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-600 dark:bg-slate-800">
          {REEKON_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onSwitchReferenceMode(m.id)}
              className={`flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                referenceMode === m.id
                  ? "bg-[#16263F] text-white shadow-sm"
                  : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Selector de líneas (en el mismo orden de la tabla) */}
      <div
        ref={refStripRef}
        className="reekon-ref-strip mx-auto w-full max-w-md shrink-0 border-b border-slate-100 dark:border-slate-800"
      >
        {measureRows.map((row, i) => {
          const done = isQuickRowComplete(row);
          const reemp = row.reempaque === true;
          const isActive = row.id === activeId;
          let label: string;
          if (palletized) {
            const pnum = palletOf(row);
            const subIdx = measureRows
              .slice(0, i + 1)
              .filter((r) => palletOf(r) === pnum).length;
            label = `P${pnum}-${subIdx}`;
          } else {
            label =
              referenceMode === "with" && strVal(row.referencia)
                ? strVal(row.referencia)
                : `#${i + 1}`;
          }
          return (
            <button
              key={row.id}
              type="button"
              data-ref-chip
              onClick={() => selectRow(row.id)}
              className={`reekon-ref-chip border ${
                isActive
                  ? reemp
                    ? "border-violet-500 bg-violet-100 text-violet-800 shadow-sm dark:border-violet-400 dark:bg-violet-900/50 dark:text-violet-200"
                    : "border-blue-500 bg-blue-50 text-blue-800 shadow-sm dark:border-blue-400 dark:bg-blue-950/50 dark:text-blue-200"
                  : reemp
                    ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                    : done
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
                      : "border-slate-200 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
              }`}
              title={reemp ? "Reempaque (no se mide)" : undefined}
            >
              {reemp ? (
                <Recycle className="h-3 w-3 shrink-0" />
              ) : done ? (
                <Check className="h-3 w-3 shrink-0" />
              ) : null}
              <span className="max-w-[7rem] truncate">{label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={addRowHere}
          className="reekon-ref-chip border border-dashed border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-300"
          aria-label={
            palletized && activeRow
              ? `Nueva fila en la paleta ${palletOf(activeRow)}`
              : "Nueva línea"
          }
        >
          <Plus className="h-3.5 w-3.5" />
          {palletized && activeRow ? `Fila P${palletOf(activeRow)}` : "Nueva"}
        </button>
        {palletized && onAddPallet ? (
          <button
            type="button"
            onClick={onAddPallet}
            className="reekon-ref-chip border border-dashed border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
            aria-label="Nueva paleta"
          >
            <Layers className="h-3.5 w-3.5" />
            Paleta
          </button>
        ) : null}
      </div>

      <div className="mx-auto flex w-full max-w-md shrink-0 justify-center border-b border-slate-100 px-3 py-1.5 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setRefListOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 active:scale-[0.98] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          <List className="h-3.5 w-3.5" />
          Ver todas las referencias
          {pendingCount > 0 ? (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
              {pendingCount} pend.
            </span>
          ) : null}
        </button>
      </div>

      {/* Navegación entre líneas */}
      <div className="mx-auto flex w-full max-w-md shrink-0 items-center justify-between border-b border-slate-100 px-3 py-1.5 dark:border-slate-800">
        <button
          type="button"
          onClick={goPrev}
          disabled={activeIndex <= 0}
          className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 disabled:opacity-30 dark:text-slate-400"
        >
          <ChevronLeft className="h-4 w-4" />
          Ant.
        </button>
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
          Línea {activeIndex + 1} de {measureRows.length}
        </span>
        <button
          type="button"
          onClick={goNext}
          disabled={activeIndex >= measureRows.length - 1}
          className="flex items-center gap-0.5 rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 disabled:opacity-30 dark:text-slate-400"
        >
          Sig.
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Panel principal: todos los campos editables directamente */}
      <main ref={formRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4">
        <div className="mx-auto w-full max-w-md">
          {!activeRow || !activeId ? (
            <p className="py-8 text-center text-sm text-slate-500">Agrega una línea para comenzar.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {referenceMode === "with" ? (
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Referencia
                  </label>
                  <ReekonDraftInput
                    rowId={activeId}
                    value={String(activeRow.referencia ?? "")}
                    onCommit={(id, v) => {
                      onReferenceChange(id, v);
                      onReferenceBlur(id, v);
                    }}
                    className="reekon-input reekon-input-immersive w-full"
                    placeholder="Referencia"
                    inputMode="text"
                  />
                </div>
              ) : palletized ? (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 py-2 text-sm font-bold text-violet-700 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300">
                  <Layers className="h-4 w-4" />
                  Paleta {palletOf(activeRow)}
                </div>
              ) : null}

              {isReempaque ? (
                <div className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-4 text-violet-800 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-200">
                  <Recycle className="h-7 w-7 shrink-0" />
                  <div>
                    <p className="text-sm font-bold">Reempaque</p>
                    <p className="text-xs text-violet-600 dark:text-violet-300">
                      Esta referencia es un reempaque: no se captura bulto, peso ni medidas.
                    </p>
                  </div>
                </div>
              ) : (
                <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Bultos
                  </label>
                  <ReekonDraftInput
                    rowId={activeId}
                    value={String(activeRow.bultos ?? "")}
                    onCommit={(id, v) => onUpdateRow(id, "bultos", v)}
                    sanitize={(raw) => raw.replace(/\D/g, "")}
                    className="reekon-input reekon-input-immersive w-full text-center"
                    placeholder="0"
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {palletized ? `Peso paleta ${palletOf(activeRow)} (kg)` : "Peso (kg)"}
                  </label>
                  {palletized && onSetPalletWeight ? (
                    <input
                      type="text"
                      inputMode="decimal"
                      className="reekon-input reekon-input-immersive w-full text-center"
                      value={palletWeightDraft}
                      placeholder="0.00"
                      onFocus={(e) => {
                        palletWeightFocused.current = true;
                        e.currentTarget.select();
                      }}
                      onChange={(e) => setPalletWeightDraft(e.target.value)}
                      onBlur={() => {
                        palletWeightFocused.current = false;
                        const norm = normalizeMeasureField(palletWeightDraft);
                        setPalletWeightDraft(norm);
                        onSetPalletWeight(palletOf(activeRow), norm);
                      }}
                    />
                  ) : (
                    <ReekonMeasureInput
                      rowId={activeId}
                      field="weight"
                      value={String(activeRow.weight ?? "")}
                      onCommit={onUpdateRow}
                    />
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Medidas con la cinta (Largo → Ancho → Alto)
                </label>
                <div className="reekon-measure-grid">
                  {DIM_ORDER.map((dim) => (
                    <div key={dim} className="reekon-measure-cell">
                      <span className="mb-1 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {DIM_LABELS[dim]}
                      </span>
                      <ReekonMeasureInput
                        rowId={activeId}
                        field={dim}
                        value={String(activeRow[dim] ?? "")}
                        onCommit={onUpdateRow}
                        isDimension
                        onTapeKeyDown={(e) =>
                          handleDimensionKeyDown(e, dim, formRef.current, finishMeasuresAndAdvance)
                        }
                      />
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 text-center text-[11px] text-slate-400">
                  Cada clic de la cinta escribe la medida y salta al siguiente lado. Tras el Alto pasa a la siguiente línea.
                </p>
              </div>

              <div className="flex items-center justify-center gap-3 text-xs">
                {rowCbm > 0 ? (
                  <span className="text-slate-500">
                    Cubicaje: <span className="font-bold">{formatCubicaje2(rowCbm)} m³</span>
                  </span>
                ) : null}
                {rowComplete ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3.5 w-3.5" />
                    Línea completa
                  </span>
                ) : null}
              </div>
                </>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="reekon-safe-bottom shrink-0 border-t border-slate-200 bg-white px-3 pt-2 dark:border-slate-700 dark:bg-slate-900">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Total {formatCubicaje2(totalCbm)} m³</span>
            <span>{formatMeasure2(totalWeight)} kg</span>
            {syncStatus ? (
              <SyncStatusBadge
                status={syncStatus}
                className="!px-2 !py-1 !text-[11px]"
              />
            ) : (
              <span>
                {autosaveState === "saving" ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Guardando…
                  </span>
                ) : autosaveState === "saved" ? (
                  "Guardado"
                ) : autosaveState === "error" ? (
                  "Error al guardar"
                ) : (
                  "Borrador"
                )}
              </span>
            )}
          </div>
          <div className="flex items-stretch gap-2.5">
            <button
              type="button"
              onClick={handleDeleteCurrent}
              disabled={measureRows.length <= 1}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-red-200 bg-red-50 text-red-600 active:scale-95 disabled:opacity-30 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400"
              aria-label="Eliminar línea"
            >
              <Trash2 className="h-6 w-6" />
            </button>
            {isPaused && onResume ? (
              <button
                type="button"
                onClick={onResume}
                disabled={isSaving}
                className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl border border-emerald-300 bg-emerald-50 text-base font-bold text-emerald-800 active:scale-[0.98] disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
              >
                <Play className="h-5 w-5" />
                Reanudar
              </button>
            ) : canPause && onPause ? (
              <button
                type="button"
                onClick={onPause}
                disabled={isSaving}
                className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-slate-50 text-base font-bold text-slate-700 active:scale-[0.98] disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              >
                <Pause className="h-5 w-5" />
                Pausar
              </button>
            ) : (
              <button
                type="button"
                onClick={addRowHere}
                className="flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-slate-50 text-base font-bold text-slate-700 active:scale-[0.98] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
              >
                <Plus className="h-5 w-5" />
                {palletized && activeRow ? `Fila P${palletOf(activeRow)}` : "Línea"}
              </button>
            )}
            {!isPaused && canPause && onPause ? (
              <button
                type="button"
                onClick={addRowHere}
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-slate-300 bg-slate-50 text-slate-700 active:scale-95 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                aria-label={palletized && activeRow ? `Agregar fila P${palletOf(activeRow)}` : "Agregar línea"}
              >
                <Plus className="h-6 w-6" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="flex h-14 flex-[1.5] items-center justify-center gap-2 rounded-2xl bg-blue-600 text-base font-bold text-white shadow-sm active:scale-[0.98] disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
              Guardar
            </button>
          </div>
        </div>
      </footer>

      <ReekonReferenceListSheet
        open={refListOpen}
        onClose={() => setRefListOpen(false)}
        measureRows={measureRows}
        referenceMode={referenceMode}
        activeRowId={activeId}
        onSelectRow={selectRow}
        completedCount={completedCount}
        faltantes={faltantes}
      />
    </div>
  );
}
