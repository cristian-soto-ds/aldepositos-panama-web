"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Check,
  CheckCircle2,
  Circle,
  Edit,
  Download,
  LayoutGrid,
  Loader2,
  Pause,
  Play,
  Plus,
  Recycle,
  Ruler,
  Smartphone,
  Trash2,
} from "lucide-react";
import { RaTaskCard } from "@/components/control-panel/RaTaskCard";
import { useSharedNow } from "@/hooks/useSharedNow";

const ReekonCaptureView = dynamic(
  () =>
    import("@/components/control-panel/ReekonCaptureView").then(
      (m) => m.ReekonCaptureView,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center p-8 text-sm font-semibold text-slate-500">
        Cargando Reekon…
      </div>
    ),
  },
);
import {
  SyncStatusBadge,
  type AutosaveState,
} from "@/components/control-panel/SyncStatusBadge";
import { RemoteSyncBanner } from "@/components/control-panel/RemoteSyncBanner";
import { GeminiSparkIcon } from "@/components/ui/GeminiSparkIcon";
import { extractReferenciasBultosFromFile } from "@/lib/quickAiExtract";
import { useEditingFocusRef, useInventoryRealtimeSync } from "@/hooks/useInventoryRealtimeSync";
import { tableScrollHostClass } from "@/lib/responsiveUi";
import {
  applyConsecutiveReferences,
  buildReferenceSnapshot,
  buildSourceReferenceSnapshot,
  captureSourceReferencesFromRows,
  CAPTURE_LAYOUT_STORAGE_KEY,
  ensurePalletNumbers,
  isAutoConsecutiveBlock,
  isCaptureLayout,
  isReferenceCaptureMode,
  maxPalletNumber,
  mergePreservingRealReferences,
  renumberConsecutiveReferences,
  renumberPallets,
  restoreSourceReferences,
  taskHasImportedReferences,
  nextConsecutiveReference,
  stripQuickRowsForPersist,
  mergeReempaqueFlagsOntoRows,
  type CaptureLayout,
  type QuickMeasureRow,
  type ReferenceCaptureMode,
} from "@/lib/quickInventoryTypes";
import type { ControlPanelHome } from "@/components/control-panel/ControlPanelHome";
import { InventoryCsvExportModal } from "@/components/modals/InventoryCsvExportModal";
import {
  countInventarioCsvRows,
  downloadInventarioCsv,
} from "@/lib/exportInventarioCsv";
import {
  getSharedWorkPresenceTabId,
  publishWorkPresence,
  clearWorkPresence,
} from "@/lib/panelPresence";
import { presenceVisibleLabel } from "@/lib/viewerIdentity";
import { useInventoryPresenceByRa } from "@/hooks/useInventoryPresenceByRa";
import { liveOperatorsForRa } from "@/lib/presenceByRa";
import { canManageInventoryPause } from "@/lib/inventoryOperatorsAllowlist";
import {
  applyInventoryAttribution,
  inventoryCompletedByLabel,
} from "@/lib/taskContributors";
import { fetchTaskById } from "@/lib/supabase";
import { measureDataLooksEmpty } from "@/lib/taskListSlim";
import {
  applyInventorySessionOnSave,
  pauseInventory,
  resumeInventory,
} from "@/lib/inventorySessionTiming";
import {
  cubicajeM3FromDims,
  formatCubicaje2,
  formatMeasure2,
  normalizeMeasureField,
  roundUpMeasure,
  sanitizeMeasureTyping,
  sumCubicajeM3,
} from "@/lib/measureDecimals";
import { InventoryReceptionCompact } from "@/components/control-panel/InventoryReceptionCompact";
import {
  buildMeasurePatchFromCatalog,
  getReferenceCatalogItem,
  normalizePartNumber,
  type InventoryCatalogModule,
} from "@/lib/referenceCatalog";
import { raClientGroupLabel } from "@/lib/collectionOrderToTask";

type Task = Parameters<typeof ControlPanelHome>[0]["tasks"][number];

type QuickInventoryEntryProps = {
  tasks: Task[];
  onUpdateTask: (task: Task) => void;
  onDeleteTask: (id: string) => void;
  openManualModal: () => void;
  openEditModal: (task: Task) => void;
  /** Fusiona el detalle hidratado (measureData) en el estado del panel. */
  onHydrateTask?: (task: Task) => void;
  /** Si se envía, el panel principal puede mostrar quién tiene un RA abierto (pestañas mismo equipo). */
  presenceUserKey?: string | null;
  presenceUserLabel?: string | null;
  /** URL pública del avatar (visible para otros en presencia). */
  presenceAvatarUrl?: string | null;
};

type MeasureRow = {
  id: string;
  referencia?: string;
  bultos?: string | number;
  l?: string | number;
  w?: string | number;
  h?: string | number;
  weight?: string | number;
  volumenM3?: string | number;
  unidad?: string;
  reempaque?: boolean;
  bultoContenedor?: string;
  referenciasContenedor?: string;
  reempaqueRefs?: string[];
  referenciaContenedora?: string;
  pallet?: number;
  palletWeight?: string | number;
};

/**
 * Quita los campos propios del modo paletizado (pallet / palletWeight) al salir de
 * ese modo, de forma que el contenido de las filas refleje siempre el modo activo.
 * Conserva la identidad del objeto si la fila no tenía datos de paleta.
 */
function stripPalletFields<T extends MeasureRow>(rows: T[]): T[] {
  return rows.map((r) => {
    if (r.pallet === undefined && r.palletWeight === undefined) return r;
    const { pallet: _pallet, palletWeight: _palletWeight, ...rest } = r;
    return rest as T;
  });
}

/** Copia de filas del modo «Con refs» antes de pasar a sin refs / paletizado. */
function buildWithModeSnapshot(
  rows: MeasureRow[],
  sourceReferences: Record<string, string>,
): MeasureRow[] {
  return JSON.parse(
    JSON.stringify(
      stripQuickRowsForPersist(
        restoreSourceReferences(stripPalletFields(rows), sourceReferences),
      ),
    ),
  ) as MeasureRow[];
}

/**
 * Campo de peso de paleta con borrador local: escribir es instantáneo (sin tocar
 * el estado global por tecla) y solo se confirma al salir del campo. Evita el
 * "se borra y reescribe" y el bloqueo al replicar el peso en todas las filas.
 */
const PalletWeightInput = React.memo(function PalletWeightInput({
  palletNum,
  value,
  onCommit,
}: {
  palletNum: number;
  value: string;
  onCommit: (palletNum: number, value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onChange={(ev) => setDraft(sanitizeMeasureTyping(ev.target.value))}
      onBlur={() => {
        focusedRef.current = false;
        const norm = normalizeMeasureField(draft);
        setDraft(norm);
        onCommit(palletNum, norm);
      }}
      className="no-spinners w-20 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-center text-xs font-bold tabular-nums text-indigo-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-200"
      placeholder="kg"
      title={`Peso total de la Paleta ${palletNum} (kg)`}
    />
  );
});

type WeightMode = "no_weight" | "per_bundle" | "by_reference" | "excel_fixed";

type QuickDraft = {
  updatedAt: number;
  rows: MeasureRow[];
  weightMode?: WeightMode;
  referenceMode?: ReferenceCaptureMode;
  captureLayout?: CaptureLayout;
  sourceReferences?: Record<string, string>;
  /** Filas originales del modo «Con refs» para restaurar al volver. */
  withModeRowsSnapshot?: MeasureRow[];
};

const inventoryDraftKey = (taskId: string, kind: "quick" | "airway") =>
  `${kind}_inventory_draft_v1_${taskId}`;

/** Ingreso rápido incluye RAs legacy tipo `airway` / `detailed` (módulos eliminados). */
function isQuickInventoryTask(t: Task): boolean {
  return (
    !t.type ||
    t.type === "quick" ||
    t.type === "airway" ||
    t.type === "detailed"
  );
}

function taskDraftKind(task: Pick<Task, "type"> | null | undefined): "quick" | "airway" {
  return task?.type === "airway" ? "airway" : "quick";
}

const generateId = () => Math.random().toString(36).substr(2, 9);

function createEmptyMeasureRow(): MeasureRow {
  return {
    id: generateId(),
    referencia: "",
    bultos: "",
    l: "",
    w: "",
    h: "",
    weight: "",
    reempaque: false,
    bultoContenedor: "",
    referenciasContenedor: "",
    reempaqueRefs: [],
    referenciaContenedora: "",
  };
}
const CATALOG_DEBOUNCE_MS = 500;
const QUICK_AUTOSAVE_MS = 1100;
/** Throttle de borrador local (menos JSON.stringify / deep-clone que el autosave). */
const QUICK_DRAFT_PERSIST_MS = 2500;
const QUICK_PRESENCE_HEARTBEAT_MS = 28_000;
// Reintentos con backoff cuando el guardado en el servidor falla (red caída, etc.).
const AUTOSAVE_RETRY_BACKOFF_MS = [1000, 2000, 5000, 10000];
const QUICK_WEIGHT_MODE: WeightMode = "per_bundle";
const RA_LIST_VIRTUALIZE_THRESHOLD = 80;
const RA_LIST_PAGE_SIZE = 60;

function CaptureLayoutToggle({
  layout,
  onChange,
}: {
  layout: CaptureLayout;
  onChange: (layout: CaptureLayout) => void;
}) {
  return (
    <div className="inline-flex flex-1 items-center rounded-md border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-600 dark:bg-slate-800/50 sm:flex-none">
      <button
        type="button"
        onClick={() => onChange("table")}
        className={`inline-flex flex-1 touch-target items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px] font-semibold transition sm:flex-none sm:gap-1.5 sm:px-3 sm:text-xs ${
          layout === "table"
            ? "bg-white text-[#16263F] shadow-sm dark:bg-slate-900 dark:text-slate-100"
            : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
        }`}
      >
        <LayoutGrid className="icon-sm" />
        <span className="sm:inline">Tabla</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("reekon")}
        className={`inline-flex flex-1 touch-target items-center justify-center gap-1 rounded px-2 py-1.5 text-[11px] font-semibold transition sm:flex-none sm:gap-1.5 sm:px-3 sm:text-xs ${
          layout === "reekon"
            ? "bg-white text-[#16263F] shadow-sm dark:bg-slate-900 dark:text-slate-100"
            : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
        }`}
      >
        <Smartphone className="icon-sm" />
        Reekon
      </button>
    </div>
  );
}

function hasQuickRequiredData(rows: MeasureRow[]): boolean {
  if (rows.length === 0) return false;
  return rows.every((row) => {
    const referencia = String(row.referencia ?? "").trim();
    // Reempaque: solo necesita referencia (no lleva bultos, peso ni medidas).
    if (row.reempaque === true) return referencia.length > 0;
    const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
    const l = parseFloat(String(row.l ?? 0)) || 0;
    const w = parseFloat(String(row.w ?? 0)) || 0;
    const h = parseFloat(String(row.h ?? 0)) || 0;
    return referencia.length > 0 && bultos > 0 && l > 0 && w > 0 && h > 0;
  });
}

function isQuickRowComplete(row: MeasureRow): boolean {
  const referencia = String(row.referencia ?? "").trim();
  // Reempaque: se considera completa con solo la referencia.
  if (row.reempaque === true) return referencia.length > 0;
  const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
  const l = parseFloat(String(row.l ?? 0)) || 0;
  const w = parseFloat(String(row.w ?? 0)) || 0;
  const h = parseFloat(String(row.h ?? 0)) || 0;
  return referencia.length > 0 && bultos > 0 && l > 0 && w > 0 && h > 0;
}

function quickRowHasPartialData(row: MeasureRow): boolean {
  const referencia = String(row.referencia ?? "").trim();
  if (row.reempaque === true) return referencia.length > 0;
  const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
  const l = parseFloat(String(row.l ?? 0)) || 0;
  const w = parseFloat(String(row.w ?? 0)) || 0;
  const h = parseFloat(String(row.h ?? 0)) || 0;
  const weight = parseFloat(String(row.weight ?? 0)) || 0;
  return referencia.length > 0 || bultos > 0 || l > 0 || w > 0 || h > 0 || weight > 0;
}

function quickRowsHaveAnyCapture(rows: MeasureRow[]): boolean {
  return rows.some((row) => {
    const referencia = String(row.referencia ?? "").trim();
    const bultos = parseFloat(String(row.bultos ?? 0)) || 0;
    const l = parseFloat(String(row.l ?? 0)) || 0;
    const w = parseFloat(String(row.w ?? 0)) || 0;
    const h = parseFloat(String(row.h ?? 0)) || 0;
    const weight = parseFloat(String(row.weight ?? 0)) || 0;
    const bultoContenedor = String(row.bultoContenedor ?? "").trim();
    const referenciasContenedor = String(row.referenciasContenedor ?? "").trim();
    const reempaqueRefsCount = Array.isArray(row.reempaqueRefs)
      ? row.reempaqueRefs.length
      : 0;
    const referenciaContenedora = String(row.referenciaContenedora ?? "").trim();
    return (
      referencia.length > 0 ||
      bultos > 0 ||
      l > 0 ||
      w > 0 ||
      h > 0 ||
      weight > 0 ||
      row.reempaque === true ||
      bultoContenedor.length > 0 ||
      referenciasContenedor.length > 0 ||
      reempaqueRefsCount > 0 ||
      referenciaContenedora.length > 0
    );
  });
}

type MeasureTableRowProps = {
  row: MeasureRow;
  displayNum: number;
  referenceLabel: number;
  showReferenceColumn: boolean;
  showWeightColumn: boolean;
  referenceMode: ReferenceCaptureMode;
  onUpdateValue: (
    id: string,
    field: keyof MeasureRow | keyof QuickMeasureRow,
    value: string | boolean | string[],
  ) => void;
  onCommitMeasure: (
    id: string,
    field: "l" | "w" | "h" | "weight",
    value: string,
  ) => void;
  onToggleReempaque: (id: string) => void;
  onDeleteRow: (id: string) => void;
  onReferenceChange: (id: string, value: string) => void;
  onReferenceBlur: (id: string, value: string) => void;
};

/**
 * Fila de captura memoizada. Solo se re-renderiza cuando cambian sus propias
 * props (la fila editada), evitando repintar toda la tabla en cada tecla.
 */
const MeasureTableRow = React.memo(function MeasureTableRow({
  row,
  displayNum,
  referenceLabel,
  showReferenceColumn,
  showWeightColumn,
  referenceMode,
  onUpdateValue,
  onCommitMeasure,
  onToggleReempaque,
  onDeleteRow,
  onReferenceChange,
  onReferenceBlur,
}: MeasureTableRowProps) {
  const b = parseFloat(String(row.bultos)) || 0;
  const rowCbm = cubicajeM3FromDims(
    row.l,
    row.w,
    row.h,
    row.bultos,
    row.reempaque === true,
  );
  const rowPesoTotal = roundUpMeasure(b * (parseFloat(String(row.weight)) || 0));
  const rowComplete = isQuickRowComplete(row);
  const rowPartial = !rowComplete && quickRowHasPartialData(row);
  const isReempaque = row.reempaque === true;
  // Paletizado: el peso se captura por paleta (en la cabecera), no por fila.
  const palletized = referenceMode === "palletized";

  return (
    <tr
      className={`group transition-colors hover:bg-sky-50/60 dark:hover:bg-sky-950/20 ${
        isReempaque
          ? "border-l-[3px] border-l-violet-400 bg-violet-50/40 dark:bg-violet-950/20"
          : rowComplete
          ? "border-l-[3px] border-l-emerald-400 bg-emerald-50/30 dark:bg-emerald-950/10"
          : rowPartial
            ? "border-l-[3px] border-l-amber-400 bg-amber-50/20 dark:bg-amber-950/10"
            : "border-l-[3px] border-l-transparent odd:bg-white even:bg-slate-50/40 dark:odd:bg-slate-900 dark:even:bg-slate-800/30"
      }`}
    >
      <td className="px-2 py-1.5 text-center">
        {isReempaque ? (
          <div className="flex flex-col items-center gap-0.5" title="Reempaque: no capturar bultos, peso ni medidas">
            <Recycle className="h-4 w-4 text-violet-500" aria-hidden />
            <span className="text-[8px] font-black uppercase tracking-wider text-violet-600 dark:text-violet-400">
              Reemp.
            </span>
          </div>
        ) : rowComplete ? (
          <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-500" aria-label="Línea completa" />
        ) : rowPartial ? (
          <Circle className="mx-auto h-4 w-4 text-amber-400 fill-amber-100 dark:fill-amber-950/50" aria-label="Línea incompleta" />
        ) : (
          <span className="text-sm font-bold tabular-nums text-slate-300 dark:text-slate-600">
            {displayNum}
          </span>
        )}
      </td>

      {showReferenceColumn && (
        <td className="px-2 py-1.5 align-top">
          {referenceMode === "without" ? (
            <span className="inline-flex w-full items-center justify-center rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-2 text-sm font-bold tabular-nums text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {referenceLabel}
            </span>
          ) : (
            <input
              type="text"
              onChange={(e) => onReferenceChange(row.id, e.target.value)}
              onBlur={(e) => onReferenceBlur(row.id, e.target.value)}
              value={row.referencia || ""}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left text-sm font-semibold text-[#16263F] outline-none transition-all placeholder:text-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-600"
              placeholder="Ej. WT-2524"
            />
          )}
        </td>
      )}

      <td className="px-2 py-1.5">
        <input
          type="number"
          disabled={isReempaque}
          onChange={(e) => onUpdateValue(row.id, "bultos", e.target.value)}
          value={row.bultos ?? ""}
          className="no-spinners w-full rounded-lg border border-blue-200 bg-blue-50/50 py-2 text-center text-sm font-bold tabular-nums text-blue-700 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-300 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
          placeholder={isReempaque ? "—" : "1"}
        />
      </td>

      {showWeightColumn && (
        <td className="px-2 py-1.5">
          {palletized ? (
            <span
              className="flex w-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 py-2 text-xs font-medium text-slate-400 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-500"
              title="El peso se captura por paleta"
            >
              —
            </span>
          ) : (
            <input
              type="number"
              disabled={isReempaque}
              onChange={(e) =>
                onUpdateValue(row.id, "weight", sanitizeMeasureTyping(e.target.value))
              }
              onBlur={(e) => onCommitMeasure(row.id, "weight", e.target.value)}
              value={row.weight ?? ""}
              className="no-spinners w-full rounded-lg border border-slate-200 bg-white py-2 text-center text-sm font-semibold tabular-nums text-[#16263F] outline-none transition-all focus:border-[#16263F] focus:ring-2 focus:ring-[#16263F]/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
              placeholder={isReempaque ? "—" : "kg"}
              title="Peso por bulto (kg)"
            />
          )}
        </td>
      )}

      <td className="px-2 py-1.5">
        <input
          type="number"
          disabled={isReempaque}
          onChange={(e) =>
            onUpdateValue(row.id, "l", sanitizeMeasureTyping(e.target.value))
          }
          onBlur={(e) => onCommitMeasure(row.id, "l", e.target.value)}
          value={row.l ?? ""}
          className="no-spinners w-full rounded-lg border border-slate-200 bg-white py-2 text-center text-sm font-semibold tabular-nums text-[#16263F] outline-none transition-all focus:border-[#16263F] focus:ring-2 focus:ring-[#16263F]/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
          placeholder={isReempaque ? "—" : "cm"}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          disabled={isReempaque}
          onChange={(e) =>
            onUpdateValue(row.id, "w", sanitizeMeasureTyping(e.target.value))
          }
          onBlur={(e) => onCommitMeasure(row.id, "w", e.target.value)}
          value={row.w ?? ""}
          className="no-spinners w-full rounded-lg border border-slate-200 bg-white py-2 text-center text-sm font-semibold tabular-nums text-[#16263F] outline-none transition-all focus:border-[#16263F] focus:ring-2 focus:ring-[#16263F]/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
          placeholder={isReempaque ? "—" : "cm"}
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          disabled={isReempaque}
          onChange={(e) =>
            onUpdateValue(row.id, "h", sanitizeMeasureTyping(e.target.value))
          }
          onBlur={(e) => onCommitMeasure(row.id, "h", e.target.value)}
          value={row.h ?? ""}
          className="no-spinners w-full rounded-lg border border-slate-200 bg-white py-2 text-center text-sm font-semibold tabular-nums text-[#16263F] outline-none transition-all focus:border-[#16263F] focus:ring-2 focus:ring-[#16263F]/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800 dark:disabled:text-slate-600"
          placeholder={isReempaque ? "—" : "cm"}
        />
      </td>

      <td className="bg-slate-50 px-2 py-1.5 text-center text-sm font-bold tabular-nums text-[#16263F] dark:bg-slate-800/60 dark:text-slate-100 md:text-base">
        {isReempaque ? "—" : formatCubicaje2(rowCbm) || "0.00"}
      </td>
      {showWeightColumn && (
        <td className="bg-slate-50 px-2 py-1.5 text-center text-sm font-bold tabular-nums text-[#16263F] dark:bg-slate-800/60 dark:text-slate-100 md:text-base">
          {isReempaque || palletized ? "—" : formatMeasure2(rowPesoTotal) || "0.00"}
        </td>
      )}
      <td className="px-2 py-1.5">
        <div className="flex items-center justify-center gap-1">
          <button
            type="button"
            onClick={() => onToggleReempaque(row.id)}
            aria-pressed={isReempaque}
            title={
              isReempaque
                ? "Quitar reempaque"
                : "Marcar como reempaque (sin bultos, peso ni medidas)"
            }
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
              isReempaque
                ? "bg-violet-500 text-white shadow-sm hover:bg-violet-600"
                : "text-slate-400 hover:bg-violet-50 hover:text-violet-500 dark:hover:bg-violet-950/40"
            }`}
          >
            <Recycle size={15} />
          </button>
          <button
            type="button"
            onClick={() => onDeleteRow(row.id)}
            title="Eliminar línea"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-all hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </td>
    </tr>
  );
});

export function QuickInventoryEntry({
  tasks,
  onUpdateTask,
  onDeleteTask,
  openManualModal,
  openEditModal,
  onHydrateTask,
  presenceUserKey = null,
  presenceUserLabel = null,
  presenceAvatarUrl = null,
}: QuickInventoryEntryProps) {
  const [viewMode, setViewMode] = useState<
    "pending" | "completed" | "priority"
  >("pending");
  const [listVisibleCount, setListVisibleCount] = useState(RA_LIST_PAGE_SIZE);
  const sharedNowMs = useSharedNow(30_000);
  const presenceByRa = useInventoryPresenceByRa();
  const pendingSelectIdRef = useRef<string | null>(null);
  const lastDraftPersistAtRef = useRef(0);
  const canPauseInventory = canManageInventoryPause(
    presenceUserKey,
    presenceUserLabel,
  );

  const moduleTasks = useMemo(() => {
    const filtered = tasks.filter((t) => {
      if (!isQuickInventoryTask(t)) return false;
      if (viewMode === "completed") {
        return t.status === "completed";
      }
      if (viewMode === "priority") {
        return (
          t.status === "pending" &&
          (t.containerDraft === true || t.dispatched === true)
        );
      }
      return (
        (t.status === "pending" ||
          t.status === "in_progress" ||
          t.status === "paused") &&
        !t.containerDraft &&
        !t.dispatched
      );
    });
    return [...filtered].sort((a, b) =>
      String(a.ra ?? "").localeCompare(String(b.ra ?? ""), undefined, {
        numeric: true,
      }),
    );
  }, [tasks, viewMode]);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [leavePromptOpen, setLeavePromptOpen] = useState(false);
  const [clientFilter, setClientFilter] = useState<string>("Todos");
  const [measureRows, setMeasureRows] = useState<MeasureRow[]>([]);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>("idle");
  const [autosaveTick, setAutosaveTick] = useState(0);
  // Momento del último guardado confirmado por el servidor (ms epoch).
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  // Cambios locales aún no confirmados en el servidor (para el indicador).
  const [pendingCount, setPendingCount] = useState(0);
  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptsRef = useRef(0);
  const isSavingRef = useRef(false);
  const queuedRef = useRef(false);
  const queuedHashRef = useRef<string>("");
  const lastSavedHashRef = useRef<string>("");
  // Hash del último cambio pendiente de guardar (para poder hacer flush al salir).
  const pendingAutosaveHashRef = useRef<string>("");
  // Espejo de flushAutosave para poder invocarlo desde funciones/efectos definidos
  // antes que él (p. ej. clearTask) sin problemas de orden de declaración.
  const flushAutosaveRef = useRef<() => void>(() => {});
  const activeTaskIdRef = useRef<string | null>(null);
  const latestRowsRef = useRef<MeasureRow[]>([]);
  const latestTaskRef = useRef<Task | null>(null);
  const [csvExportOpen, setCsvExportOpen] = useState(false);
  const [captureLayout, setCaptureLayout] = useState<CaptureLayout>("table");
  const [referenceMode, setReferenceMode] = useState<ReferenceCaptureMode>("with");
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [palletModalOpen, setPalletModalOpen] = useState(false);
  const [palletModalValue, setPalletModalValue] = useState("");
  const [aiExtractBusy, setAiExtractBusy] = useState(false);
  const [aiExtractError, setAiExtractError] = useState<string | null>(null);
  const aiFileRef = useRef<HTMLInputElement>(null);
  const sourceReferencesRef = useRef<Record<string, string>>({});
  const withModeRowsSnapshotRef = useRef<MeasureRow[] | null>(null);
  // Espejo del modo de captura para leerlo de forma síncrona (p. ej. al aplicar
  // un modo que acaba de llegar por el canal en vivo, antes del re-render).
  const referenceModeRef = useRef<ReferenceCaptureMode>(referenceMode);
  const catalogDebounceRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});
  const catalogSeqRef = useRef<Record<string, number>>({});
  const onLocalSaveCompletedRef = useRef<() => void>(() => {});
  // IDs de filas eliminadas localmente que aún podrían venir en un eco atrasado
  // de la BD/en vivo. Se filtran de cualquier estado remoto entrante hasta que la
  // BD confirme la eliminación (deja de traerlas). Evita que una fila borrada
  // "reaparezca" y entre en bucle de borrado.
  const pendingDeletionIdsRef = useRef<Set<string>>(new Set());

  const prepareRowsFromRemote = useCallback(
    (remote: Task): MeasureRow[] => {
      let taskRows =
        remote.measureData && remote.measureData.length > 0
          ? stripQuickRowsForPersist(
              JSON.parse(JSON.stringify(remote.measureData)) as MeasureRow[],
            )
          : [];
      // Autoridad local sobre eliminaciones: si el estado remoto todavía trae una
      // fila que acabamos de borrar (eco atrasado), la quitamos. Cuando la BD ya no
      // la incluye, damos la eliminación por confirmada y limpiamos el guard.
      const pendingDel = pendingDeletionIdsRef.current;
      if (pendingDel.size > 0) {
        const remoteIds = new Set(taskRows.map((r) => r.id));
        for (const id of Array.from(pendingDel)) {
          if (!remoteIds.has(id)) pendingDel.delete(id);
        }
        if (pendingDel.size > 0) {
          taskRows = taskRows.filter((r) => !pendingDel.has(r.id));
        }
      }
      const incomingSnapshot = taskHasImportedReferences(taskRows)
        ? buildSourceReferenceSnapshot(taskRows, taskRows)
        : buildReferenceSnapshot(taskRows);
      if (!isAutoConsecutiveBlock(taskRows)) {
        sourceReferencesRef.current = mergePreservingRealReferences(
          sourceReferencesRef.current,
          incomingSnapshot,
        );
      }
      // Usa el modo más reciente (ref) para que un cambio de modo recién recibido
      // por el canal en vivo transforme correctamente las filas entrantes.
      let mode = referenceModeRef.current;
      // Señal inequívoca: si las filas remotas ya traen paleta, el pedido es
      // paletizado. Autocorrige el modo aunque no llegue el aviso en vivo (BD).
      const rawIsPalletized = taskRows.some((r) => Number(r.pallet) >= 1);
      if (rawIsPalletized && mode !== "palletized") {
        mode = "palletized";
        referenceModeRef.current = "palletized";
        setReferenceMode("palletized");
      }
      if (mode === "palletized") {
        return taskRows.length > 0
          ? ensurePalletNumbers(applyConsecutiveReferences(taskRows))
          : [];
      }
      if (mode === "without") {
        return taskRows.length > 0
          ? applyConsecutiveReferences(stripPalletFields(taskRows))
          : [];
      }
      return restoreSourceReferences(
        stripPalletFields(taskRows),
        sourceReferencesRef.current,
      );
    },
    [],
  );

  useEffect(() => {
    // Al cambiar de RA, descarta eliminaciones pendientes de la tarea anterior.
    pendingDeletionIdsRef.current.clear();
    if (!selectedTask) return;
    setMeasureRows((prev) => {
      const next = stripQuickRowsForPersist(prev);
      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
    });
  }, [selectedTask?.id]);

  const buildEditorHash = useCallback(
    (rows: MeasureRow[]) =>
      JSON.stringify({ rows, referenceMode, captureLayout }),
    [referenceMode, captureLayout],
  );

  const isEditingRef = useEditingFocusRef();

  const getLiveTaskMeta = useCallback(
    (rows: MeasureRow[]) => {
      const hasCapture = quickRowsHaveAnyCapture(rows);
      const totalsBultos = rows.reduce(
        (a, row) => a + (parseFloat(String(row.bultos)) || 0),
        0,
      );
      const expected = selectedTask?.expectedBultos ?? 0;
      const requiredOk = hasCapture && hasQuickRequiredData(rows);
      // Correcciones: un RA ya completado no pierde ese estado al ajustar bultos.
      const isCompleted =
        selectedTask?.status === "completed"
          ? requiredOk
          : requiredOk && totalsBultos >= expected;
      const base = selectedTask ?? ({ status: "pending" } as Task);
      const withSession = applyInventorySessionOnSave({
        task: base,
        hasCapture,
        isCompleted,
        workStatusWhenActive: "in_progress",
        forceResume: false,
      });
      return {
        currentBultos: hasCapture ? totalsBultos : 0,
        status: withSession.status,
      };
    },
    [selectedTask],
  );

  const {
    remoteUpdatePending,
    applyPendingRemoteUpdate,
    onLocalSaveCompleted,
  } = useInventoryRealtimeSync({
    tasks,
    selectedTask,
    measureRows,
    setSelectedTask,
    setMeasureRows,
    isSavingRef,
    isEditingRef,
    lastSavedHashRef,
    latestRowsRef,
    latestTaskRef,
    buildHash: buildEditorHash,
    prepareRowsFromRemote,
    getLiveTaskMeta,
    userKey: presenceUserKey,
    liveReferenceMode: referenceMode,
    onRemoteReferenceMode: (mode) => {
      if (isReferenceCaptureMode(mode) && mode !== referenceModeRef.current) {
        referenceModeRef.current = mode;
        setReferenceMode(mode);
      }
    },
    onTaskRemoved: () => {
      setSelectedTask(null);
      activeTaskIdRef.current = null;
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    },
  });

  onLocalSaveCompletedRef.current = onLocalSaveCompleted;

  useEffect(() => {
    referenceModeRef.current = referenceMode;
  }, [referenceMode]);

  useEffect(() => {
    const debRef = catalogDebounceRef;
    return () => {
      Object.values(debRef.current).forEach(clearTimeout);
      debRef.current = {};
    };
  }, []);

  useEffect(() => {
    const key = (presenceUserKey ?? "").trim();
    if (!key) {
      void clearWorkPresence(getSharedWorkPresenceTabId());
      return;
    }
    const rawLabel = String(presenceUserLabel ?? "").trim();
    const label =
      rawLabel || presenceVisibleLabel(presenceUserLabel, key.includes("@") ? key : null);
    const presenceModule = "quick" as const;
    const tabId = getSharedWorkPresenceTabId();
    const send = () => {
      publishWorkPresence({
        tabId,
        userKey: key,
        userLabel: label,
        avatarUrl: presenceAvatarUrl?.trim() || null,
        ra: selectedTask ? String(selectedTask.ra ?? "").trim() : "",
        module: presenceModule,
      });
    };
    send();
    const interval = window.setInterval(send, QUICK_PRESENCE_HEARTBEAT_MS);
    return () => {
      window.clearInterval(interval);
      void clearWorkPresence(tabId);
    };
  }, [
    selectedTask,
    presenceUserKey,
    presenceUserLabel,
    presenceAvatarUrl,
  ]);

  const groupedTasks = useMemo(
    () =>
      moduleTasks.reduce<Record<string, Task[]>>((groups, task) => {
        const client = raClientGroupLabel(task.mainClient);
        if (!groups[client]) groups[client] = [];
        groups[client].push(task);
        return groups;
      }, {}),
    [moduleTasks],
  );

  const clients = useMemo(() => Object.keys(groupedTasks), [groupedTasks]);
  const totalModuleTasks = moduleTasks.length;

  const displayedTasks = useMemo(() => {
    if (clientFilter !== "Todos" && clients.includes(clientFilter)) {
      return groupedTasks[clientFilter] ?? moduleTasks;
    }
    return moduleTasks;
  }, [moduleTasks, groupedTasks, clientFilter, clients]);

  useEffect(() => {
    setListVisibleCount(RA_LIST_PAGE_SIZE);
  }, [viewMode, clientFilter]);

  const visibleListTasks = useMemo(() => {
    if (displayedTasks.length <= RA_LIST_VIRTUALIZE_THRESHOLD) {
      return displayedTasks;
    }
    return displayedTasks.slice(0, listVisibleCount);
  }, [displayedTasks, listVisibleCount]);

  const selectTaskRef = useRef<(task: Task) => void>(() => {});

  const onSelectRaCard = useCallback((task: Task) => {
    selectTaskRef.current(task);
  }, []);

  const onEditRaCard = useCallback(
    (task: Task) => {
      if (viewMode === "completed") {
        selectTaskRef.current(task);
      } else {
        openEditModal(task);
      }
    },
    [viewMode, openEditModal],
  );

  const calculateTotals = () => {
    if (!selectedTask) return { bultos: 0, cbm: 0, weight: 0 };

    const bultos = measureRows.reduce(
      (a, row) => a + (parseFloat(String(row.bultos)) || 0),
      0,
    );
    const cbmNumber = sumCubicajeM3(measureRows);

    // Paletizado: el peso se captura una vez por paleta (no por bulto).
    const weight =
      referenceMode === "palletized"
        ? roundUpMeasure(
            (() => {
              const seen = new Set<number>();
              let acc = 0;
              for (const row of measureRows) {
                const p = Math.max(1, Number(row.pallet) || 1);
                if (seen.has(p)) continue;
                seen.add(p);
                acc += parseFloat(String(row.palletWeight)) || 0;
              }
              return acc;
            })(),
          )
        : roundUpMeasure(
            measureRows.reduce((acc, row) => {
              const rowWeight = parseFloat(String(row.weight)) || 0;
              const b = parseFloat(String(row.bultos)) || 0;
              return acc + rowWeight * b;
            }, 0),
          );

    return { bultos, cbm: cbmNumber, weight };
  };

  const commitMeasureField = useCallback(
    (rowId: string, field: "l" | "w" | "h" | "weight", raw: string) => {
      const normalized = normalizeMeasureField(raw);
      setMeasureRows((prev) =>
        prev.map((r) => (r.id === rowId ? { ...r, [field]: normalized } : r)),
      );
      // Al salir del campo, persiste de inmediato (tras aplicar el estado) en vez
      // de esperar el debounce completo: reduce la ventana de pérdida de datos.
      if (typeof window !== "undefined") {
        window.setTimeout(() => flushAutosaveRef.current(), 0);
      }
    },
    [],
  );

  const handleSelectTask = (listTask: Task) => {
    void (async () => {
    pendingSelectIdRef.current = listTask.id;
    let task = listTask;
    if (measureDataLooksEmpty(listTask.measureData)) {
      try {
        const loaded = await fetchTaskById(listTask.id);
        if (pendingSelectIdRef.current !== listTask.id) return;
        if (loaded) {
          task = loaded;
          onHydrateTask?.(loaded);
        }
      } catch (e) {
        console.error(e);
        if (pendingSelectIdRef.current !== listTask.id) return;
      }
    }
    if (pendingSelectIdRef.current !== listTask.id) return;

    setSelectedTask(task);
    activeTaskIdRef.current = task.id;
    withModeRowsSnapshotRef.current = null;
    sourceReferencesRef.current = {};

    const taskRows =
      task.measureData && task.measureData.length > 0
        ? stripQuickRowsForPersist(
            JSON.parse(JSON.stringify(task.measureData)) as MeasureRow[],
          )
        : [createEmptyMeasureRow()];
    const serverRows = taskRows;
    const serverHasCapture = quickRowsHaveAnyCapture(taskRows);
    let rowsToUse = taskRows;
    // Si las filas guardadas ya traen número de paleta, la tarea es paletizada:
    // así se restaura la agrupación y el peso de paleta aunque no exista borrador local.
    const serverIsPalletized = taskRows.some(
      (r) => Number(r.pallet) >= 1,
    );
    let refModeToUse: ReferenceCaptureMode = serverIsPalletized
      ? "palletized"
      : taskHasImportedReferences(taskRows)
        ? "with"
        : "without";
    if (isReferenceCaptureMode(task.referenceMode)) {
      refModeToUse = task.referenceMode;
    }
    let layoutToUse: CaptureLayout =
      typeof window !== "undefined" && window.innerWidth < 768 ? "reekon" : "table";

    if (typeof window !== "undefined") {
      const rawDraft = window.localStorage.getItem(
        inventoryDraftKey(task.id, taskDraftKind(task)),
      );
      const savedLayout = window.localStorage.getItem(CAPTURE_LAYOUT_STORAGE_KEY);
      if (isCaptureLayout(savedLayout)) {
        layoutToUse = savedLayout;
      }
      if (rawDraft) {
        try {
          const parsed = JSON.parse(rawDraft) as QuickDraft;
          if (isReferenceCaptureMode(parsed.referenceMode)) {
            refModeToUse = parsed.referenceMode;
          }
          if (isCaptureLayout(parsed.captureLayout)) {
            layoutToUse = parsed.captureLayout;
          }
          if (
            parsed.sourceReferences &&
            typeof parsed.sourceReferences === "object"
          ) {
            sourceReferencesRef.current = mergePreservingRealReferences(
              parsed.sourceReferences,
              sourceReferencesRef.current,
            );
          }
          if (
            Array.isArray(parsed.withModeRowsSnapshot) &&
            parsed.withModeRowsSnapshot.length > 0
          ) {
            withModeRowsSnapshotRef.current = stripQuickRowsForPersist(
              parsed.withModeRowsSnapshot,
            );
          }
          if (
            isReferenceCaptureMode(parsed.referenceMode) &&
            parsed.referenceMode !== "with"
          ) {
            if (Array.isArray(parsed.rows)) {
              rowsToUse = stripQuickRowsForPersist(parsed.rows);
            }
          } else if (Array.isArray(parsed.rows) && parsed.rows.length > 0) {
            const draftHasCapture = quickRowsHaveAnyCapture(parsed.rows);
            if (!serverHasCapture && draftHasCapture) {
              rowsToUse = stripQuickRowsForPersist(parsed.rows);
            } else if (serverHasCapture) {
              rowsToUse = taskRows;
            } else {
              rowsToUse = stripQuickRowsForPersist(parsed.rows);
            }
          }
        } catch {
          // ignore invalid draft
        }
      }
    }

    const serverSnapshot = taskHasImportedReferences(serverRows)
      ? buildSourceReferenceSnapshot(rowsToUse, serverRows)
      : buildReferenceSnapshot(rowsToUse);
    sourceReferencesRef.current = mergePreservingRealReferences(
      sourceReferencesRef.current,
      serverSnapshot,
    );

    if (!withModeRowsSnapshotRef.current && taskHasImportedReferences(serverRows)) {
      withModeRowsSnapshotRef.current = buildWithModeSnapshot(
        serverRows,
        sourceReferencesRef.current,
      );
    }

    if (refModeToUse === "palletized") {
      rowsToUse =
        rowsToUse.length > 0
          ? ensurePalletNumbers(applyConsecutiveReferences(rowsToUse))
          : [];
    } else if (refModeToUse === "without") {
      rowsToUse =
        rowsToUse.length > 0
          ? applyConsecutiveReferences(stripPalletFields(rowsToUse))
          : [];
    } else {
      rowsToUse = restoreSourceReferences(
        stripPalletFields(rowsToUse),
        sourceReferencesRef.current,
      );
      if (!withModeRowsSnapshotRef.current && rowsToUse.length > 0) {
        withModeRowsSnapshotRef.current = buildWithModeSnapshot(
          rowsToUse,
          sourceReferencesRef.current,
        );
      }
    }

    rowsToUse = stripQuickRowsForPersist(rowsToUse);

    const firstPending = rowsToUse.find((r) => !isQuickRowComplete(r));
    setExpandedRowId(firstPending?.id ?? rowsToUse[0]?.id ?? null);
    setReferenceMode(refModeToUse);
    setCaptureLayout(layoutToUse);
    setMeasureRows(rowsToUse);
    latestRowsRef.current = rowsToUse;
    latestTaskRef.current = task;
    lastSavedHashRef.current = JSON.stringify({
      rows: rowsToUse,
      referenceMode: refModeToUse,
      captureLayout: layoutToUse,
    });
    setAutosaveState("idle");
    })();
  };
  selectTaskRef.current = handleSelectTask;

  const clearTask = () => {
    // Persiste de inmediato cualquier cambio pendiente antes de abandonar la RA,
    // en vez de descartar el guardado debounced (evita perder la última medida).
    flushAutosaveRef.current();
    setLeavePromptOpen(false);
    setSelectedTask(null);
    activeTaskIdRef.current = null;
    withModeRowsSnapshotRef.current = null;
    sourceReferencesRef.current = {};
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  };

  const requestLeave = () => {
    if (!selectedTask) return;
    if (!canPauseInventory) {
      clearTask();
      return;
    }
    // Ya pausado: salir sin preguntar.
    if (selectedTask.status === "paused") {
      clearTask();
      return;
    }
    const hasCapture = quickRowsHaveAnyCapture(measureRows);
    const totalsBultos = measureRows.reduce(
      (a, row) => a + (parseFloat(String(row.bultos)) || 0),
      0,
    );
    const requiredOk = hasCapture && hasQuickRequiredData(measureRows);
    const isCompleted =
      selectedTask.status === "completed"
        ? requiredOk
        : requiredOk && totalsBultos >= selectedTask.expectedBultos;
    // Inventariador con trabajo abierto (no pausado): pedir pausa al volver.
    // Correcciones de completados: salir sin pedir pausa.
    if (selectedTask.status !== "completed" && hasCapture && !isCompleted) {
      setLeavePromptOpen(true);
      return;
    }
    clearTask();
  };

  const pauseAndExit = async () => {
    if (!selectedTask) return;
    const task = selectedTask;
    const rows = latestRowsRef.current;
    const hasCapture = quickRowsHaveAnyCapture(rows);
    const totalsBultos = rows.reduce(
      (a, row) => a + (parseFloat(String(row.bultos)) || 0),
      0,
    );
    const persistedRows = hasCapture ? stripQuickRowsForPersist(rows) : [];
    const withData: Task = {
      ...task,
      measureData: JSON.parse(JSON.stringify(persistedRows)),
      currentBultos: hasCapture ? totalsBultos : 0,
      weightMode: QUICK_WEIGHT_MODE,
      referenceMode: referenceModeRef.current,
      originalExpectedBultos: task.originalExpectedBultos || task.expectedBultos,
      manualTotalWeight:
        task.manualTotalWeight !== undefined ? task.manualTotalWeight : 0,
    };
    const paused = pauseInventory(
      applyInventorySessionOnSave({
        task: withData,
        hasCapture,
        isCompleted: false,
        workStatusWhenActive: "in_progress",
        forceResume: false,
      }),
    );
    const updatedTask = applyInventoryAttribution(paused, {
      userKey: presenceUserKey,
      userLabel: presenceUserLabel,
      // Siempre atribuir al inventariador que pausa (refresca `at` para el badge).
      hasCapture: true,
      isCompleted: false,
    });
    const currentHash = JSON.stringify({
      rows,
      referenceMode: referenceModeRef.current,
      captureLayout,
    });
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    pendingAutosaveHashRef.current = currentHash;
    setAutosaveState("saving");
    try {
      await Promise.resolve((onUpdateTask as (t: Task) => unknown)(updatedTask));
      lastSavedHashRef.current = currentHash;
      setLastSavedAt(Date.now());
      setPendingCount(0);
      setAutosaveState("saved");
      setLeavePromptOpen(false);
      setSelectedTask(null);
      activeTaskIdRef.current = null;
      withModeRowsSnapshotRef.current = null;
      sourceReferencesRef.current = {};
    } catch {
      setAutosaveState("error");
      scheduleAutosaveRetry();
    }
  };

  const resumePausedInventory = async () => {
    if (!selectedTask || selectedTask.status !== "paused") return;
    const next = resumeInventory(selectedTask, "in_progress");
    const updatedTask = applyInventoryAttribution(
      { ...next, updatedAt: new Date().toISOString() },
      {
        userKey: presenceUserKey,
        userLabel: presenceUserLabel,
        hasCapture: true,
        isCompleted: false,
      },
    );
    setSelectedTask(updatedTask);
    latestTaskRef.current = updatedTask;
    try {
      await Promise.resolve((onUpdateTask as (t: Task) => unknown)(updatedTask));
    } catch {
      setAutosaveState("error");
    }
  };

  const setCaptureLayoutWithPersist = (layout: CaptureLayout) => {
    setCaptureLayout(layout);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CAPTURE_LAYOUT_STORAGE_KEY, layout);
    }
  };

  const switchReferenceMode = (mode: ReferenceCaptureMode) => {
    if (mode === referenceMode) return;

    let nextRows: MeasureRow[] = [];

    if (referenceMode === "with") {
      withModeRowsSnapshotRef.current = buildWithModeSnapshot(
        measureRows,
        sourceReferencesRef.current,
      );
      sourceReferencesRef.current = captureSourceReferencesFromRows(
        withModeRowsSnapshotRef.current,
        sourceReferencesRef.current,
      );
    }

    if (mode === "with") {
      const snapshot = withModeRowsSnapshotRef.current;
      nextRows =
        snapshot && snapshot.length > 0
          ? (JSON.parse(JSON.stringify(snapshot)) as MeasureRow[])
          : restoreSourceReferences(
              stripPalletFields(measureRows),
              sourceReferencesRef.current,
            );
      nextRows = restoreSourceReferences(nextRows, sourceReferencesRef.current);
    } else {
      nextRows = [];
    }

    referenceModeRef.current = mode;
    setReferenceMode(mode);
    setMeasureRows(nextRows);
    setExpandedRowId(
      nextRows.find((r) => !isQuickRowComplete(r))?.id ?? nextRows[0]?.id ?? null,
    );

    if (selectedTask) {
      persistQuickDraft(selectedTask.id, nextRows, mode, captureLayout);
    }
  };

  const addRow = () => {
    const newId = generateId();
    setMeasureRows((prev) => {
      const autoRef = referenceMode !== "with";
      const nextRef = autoRef ? nextConsecutiveReference(prev) : "";
      // Paletizado: la nueva fila se añade a la última paleta abierta.
      const pallet =
        referenceMode === "palletized"
          ? Math.max(1, maxPalletNumber(prev))
          : undefined;
      return [
        ...prev,
        {
          id: newId,
          referencia: nextRef,
          bultos: autoRef ? "1" : "",
          l: "",
          w: "",
          h: "",
          weight: "",
          reempaque: false,
          bultoContenedor: "",
          referenciasContenedor: "",
          reempaqueRefs: [],
          referenciaContenedora: "",
          ...(pallet ? { pallet } : {}),
        },
      ];
    });
    if (captureLayout === "reekon") {
      setExpandedRowId(newId);
    }
  };

  /**
   * Alde.IA: lee un documento y agrega SOLO referencias + bultos como filas nuevas.
   * El resto (medidas, peso, etc.) lo captura el inventariador después.
   */
  const runAiRefExtract = async (file: File) => {
    setAiExtractBusy(true);
    setAiExtractError(null);
    try {
      const lines = await extractReferenciasBultosFromFile(file);
      if (lines.length === 0) {
        setAiExtractError("No se detectaron referencias en el documento.");
        return;
      }
      let firstNewId: string | null = null;
      setMeasureRows((prev) => {
        // Conserva las filas con datos; descarta las vacías (p. ej. la fila inicial).
        const kept = prev.filter((r) => quickRowHasPartialData(r));
        const pallet =
          referenceMode === "palletized" ? Math.max(1, maxPalletNumber(kept)) : undefined;
        const additions: MeasureRow[] = lines.map((l) => {
          const id = generateId();
          if (!firstNewId) firstNewId = id;
          return {
            id,
            referencia: l.referencia,
            bultos: l.bultos,
            l: "",
            w: "",
            h: "",
            weight: "",
            reempaque: false,
            bultoContenedor: "",
            referenciasContenedor: "",
            reempaqueRefs: [],
            referenciaContenedora: "",
            ...(pallet ? { pallet } : {}),
          };
        });
        return [...kept, ...additions];
      });
      if (firstNewId) setExpandedRowId(firstNewId);
    } catch (err) {
      setAiExtractError(
        err instanceof Error ? err.message : "No se pudo leer el documento.",
      );
    } finally {
      setAiExtractBusy(false);
    }
  };

  /** Abre el selector de archivo para la lectura con Alde.IA. */
  const openAiFilePicker = () => {
    if (aiExtractBusy) return;
    setAiExtractError(null);
    aiFileRef.current?.click();
  };

  /**
   * Paletizado: crea una paleta con un número concreto y su primera fila.
   * El número lo elige el inventariador (con aviso de colisión en el modal).
   */
  const createPalletWithNumber = (palletNum: number) => {
    const newId = generateId();
    setMeasureRows((prev) => {
      const next: MeasureRow[] = [
        ...prev,
        {
          id: newId,
          referencia: nextConsecutiveReference(prev),
          bultos: "1",
          l: "",
          w: "",
          h: "",
          weight: "",
          reempaque: false,
          bultoContenedor: "",
          referenciasContenedor: "",
          reempaqueRefs: [],
          referenciaContenedora: "",
          pallet: palletNum,
        },
      ];
      // Se añade al final sin renumerar: no se recrean las filas existentes.
      return next;
    });
    if (captureLayout === "reekon") {
      setExpandedRowId(newId);
    }
  };

  /** Números de paleta actualmente presentes (propios y de otros inventariadores). */
  const existingPalletNumbers = useMemo(() => {
    const set = new Set<number>();
    for (const r of measureRows) set.add(Math.max(1, Number(r.pallet) || 1));
    return set;
  }, [measureRows]);

  const openPalletModal = () => {
    setPalletModalValue(String(maxPalletNumber(measureRows) + 1));
    setPalletModalOpen(true);
  };

  const confirmPalletModal = () => {
    const num = parseInt(palletModalValue, 10);
    if (!Number.isFinite(num) || num < 1) return;
    if (existingPalletNumbers.has(num)) return;
    createPalletWithNumber(num);
    setPalletModalOpen(false);
  };

  /** Paletizado: fija el peso total de una paleta (se replica en todas sus filas). */
  const setPalletWeight = useCallback((palletNum: number, value: string) => {
    setMeasureRows((prev) =>
      prev.map((r) => {
        if (Math.max(1, Number(r.pallet) || 1) !== palletNum) return r;
        // Conserva la identidad si el valor no cambia (evita repintar la fila).
        return String(r.palletWeight ?? "") === value
          ? r
          : { ...r, palletWeight: value };
      }),
    );
    // El peso de paleta se confirma al salir del campo: persiste de inmediato.
    if (typeof window !== "undefined") {
      window.setTimeout(() => flushAutosaveRef.current(), 0);
    }
  }, []);

  /** Paletizado: añade una fila dentro de una paleta concreta (la inserta al final de su grupo). */
  const addRowToPallet = (palletNum: number) => {
    const newId = generateId();
    setMeasureRows((prev) => {
      // Hereda el peso ya asignado a la paleta (se captura una sola vez por paleta).
      const existingPalletWeight =
        prev.find(
          (r) =>
            Math.max(1, Number(r.pallet) || 1) === palletNum &&
            String(r.palletWeight ?? "").trim() !== "",
        )?.palletWeight ?? "";
      const newRow: MeasureRow = {
        id: newId,
        // Referencia única sin renumerar el resto (en paletizado no se muestra,
        // pero debe ser no vacía para poder marcar la fila como completa).
        referencia: nextConsecutiveReference(prev),
        bultos: "1",
        l: "",
        w: "",
        h: "",
        weight: "",
        reempaque: false,
        bultoContenedor: "",
        referenciasContenedor: "",
        reempaqueRefs: [],
        referenciaContenedora: "",
        pallet: palletNum,
        palletWeight: existingPalletWeight,
      };
      let lastIdx = -1;
      prev.forEach((r, i) => {
        if (Math.max(1, Number(r.pallet) || 1) === palletNum) lastIdx = i;
      });
      const next = [...prev];
      if (lastIdx === -1) next.push(newRow);
      else next.splice(lastIdx + 1, 0, newRow);
      // Sin renumerar: se conserva la identidad de todas las filas existentes.
      return next;
    });
    if (captureLayout === "reekon") {
      setExpandedRowId(newId);
    }
  };

  /** Paletizado: elimina una paleta completa (todas sus filas) y renumera el resto. */
  const deletePallet = (palletNum: number) => {
    const rowsInPallet = measureRows.filter(
      (r) => Math.max(1, Number(r.pallet) || 1) === palletNum,
    );
    const hasData = rowsInPallet.some((r) => quickRowHasPartialData(r));
    if (
      hasData &&
      typeof window !== "undefined" &&
      !window.confirm(
        `¿Eliminar la Paleta ${palletNum} y sus ${rowsInPallet.length} fila(s)?`,
      )
    ) {
      return;
    }
    for (const r of rowsInPallet) {
      const t = catalogDebounceRef.current[r.id];
      if (t) {
        clearTimeout(t);
        delete catalogDebounceRef.current[r.id];
      }
      delete sourceReferencesRef.current[r.id];
      // Marca cada fila de la paleta como eliminada (guard anti-reaparición).
      pendingDeletionIdsRef.current.add(r.id);
    }
    setMeasureRows((prev) => {
      const remaining = prev.filter(
        (r) => Math.max(1, Number(r.pallet) || 1) !== palletNum,
      );
      if (remaining.length === 0) {
        return [
          {
            ...createEmptyMeasureRow(),
            bultos: "1",
            referencia: "1",
            pallet: 1,
          },
        ];
      }
      return renumberConsecutiveReferences(renumberPallets(remaining));
    });
  };

  const deleteRow = useCallback(
    (idToRemove: string) => {
      const t = catalogDebounceRef.current[idToRemove];
      if (t) {
        clearTimeout(t);
        delete catalogDebounceRef.current[idToRemove];
      }
      delete sourceReferencesRef.current[idToRemove];
      setMeasureRows((prev) => {
        if (prev.length <= 1) return prev;
        // Marca la fila como eliminada para que un eco remoto no la reinserte.
        pendingDeletionIdsRef.current.add(idToRemove);
        const next = prev.filter((r) => r.id !== idToRemove);
        return referenceMode !== "with"
          ? renumberConsecutiveReferences(next)
          : next;
      });
    },
    [referenceMode],
  );

  const updateRowValue = useCallback(
    (
      id: string,
      field: keyof MeasureRow | keyof QuickMeasureRow,
      value: string | boolean | string[],
    ) =>
      setMeasureRows((prev) =>
        prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
      ),
    [],
  );

  /** Marca/desmarca una fila como reempaque (sin bultos, peso ni medidas). */
  const toggleReempaque = useCallback((id: string) => {
    setMeasureRows((prev) => {
      const next = prev.map((row) => {
        if (row.id !== id) return row;
        const nextFlag = !row.reempaque;
        if (nextFlag) {
          return {
            ...row,
            reempaque: true,
            bultos: "",
            weight: "",
            l: "",
            w: "",
            h: "",
          };
        }
        return { ...row, reempaque: false };
      });
      // Persistir de inmediato para que inventariadores vean la marca en vivo.
      latestRowsRef.current = next;
      queueMicrotask(() => {
        flushAutosaveRef.current();
      });
      return next;
    });
  }, []);

  const runCatalogLookup = useCallback(
    async (rowId: string, rawReferencia: string) => {
      const key = normalizePartNumber(rawReferencia);
      if (!key) {
        return;
      }
      const seq = (catalogSeqRef.current[rowId] =
        (catalogSeqRef.current[rowId] ?? 0) + 1);
      const item = await getReferenceCatalogItem(key);
      if (catalogSeqRef.current[rowId] !== seq) return;
      if (!item) {
        return;
      }
      const mod: InventoryCatalogModule =
        taskDraftKind(selectedTask) === "airway" ? "airway" : "quick";
      const patch = buildMeasurePatchFromCatalog(mod, item);
      setMeasureRows((prev) =>
        stripQuickRowsForPersist(
          prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
        ),
      );
    },
    [selectedTask],
  );

  const scheduleCatalogLookup = useCallback(
    (rowId: string, raw: string) => {
      const prevT = catalogDebounceRef.current[rowId];
      if (prevT) clearTimeout(prevT);
      catalogDebounceRef.current[rowId] = setTimeout(() => {
        delete catalogDebounceRef.current[rowId];
        void runCatalogLookup(rowId, raw);
      }, CATALOG_DEBOUNCE_MS);
    },
    [runCatalogLookup],
  );

  const handleReferenceChange = useCallback(
    (rowId: string, value: string) => {
      updateRowValue(rowId, "referencia", value);
      const trimmed = value.trim();
      if (trimmed) sourceReferencesRef.current[rowId] = trimmed;
      else delete sourceReferencesRef.current[rowId];
      scheduleCatalogLookup(rowId, value);
    },
    [updateRowValue, scheduleCatalogLookup],
  );

  const handleReferenceBlur = useCallback(
    (rowId: string, value: string) => {
      const t = catalogDebounceRef.current[rowId];
      if (t) {
        clearTimeout(t);
        delete catalogDebounceRef.current[rowId];
      }
      void runCatalogLookup(rowId, value);
    },
    [runCatalogLookup],
  );

  const persistQuickDraft = (
    taskId: string,
    rows: MeasureRow[],
    refMode: ReferenceCaptureMode,
    layout: CaptureLayout,
    opts?: { force?: boolean },
  ) => {
    if (typeof window === "undefined") return;
    const now = Date.now();
    if (
      !opts?.force &&
      now - lastDraftPersistAtRef.current < QUICK_DRAFT_PERSIST_MS
    ) {
      return;
    }
    lastDraftPersistAtRef.current = now;
    const draft: QuickDraft = {
      updatedAt: now,
      rows: JSON.parse(JSON.stringify(stripQuickRowsForPersist(rows))) as MeasureRow[],
      weightMode: QUICK_WEIGHT_MODE,
      referenceMode: refMode,
      captureLayout: layout,
      sourceReferences: { ...sourceReferencesRef.current },
      withModeRowsSnapshot: withModeRowsSnapshotRef.current
        ? (JSON.parse(
            JSON.stringify(withModeRowsSnapshotRef.current),
          ) as MeasureRow[])
        : undefined,
    };
    window.localStorage.setItem(
      inventoryDraftKey(taskId, taskDraftKind(latestTaskRef.current)),
      JSON.stringify(draft),
    );
  };

  // Reintenta el guardado con backoff usando SIEMPRE el estado más reciente
  // (evita sobrescribir datos nuevos con una versión vieja que había fallado).
  const scheduleAutosaveRetry = () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    const attempt = retryAttemptsRef.current;
    const delay =
      AUTOSAVE_RETRY_BACKOFF_MS[
        Math.min(attempt, AUTOSAVE_RETRY_BACKOFF_MS.length - 1)
      ];
    retryAttemptsRef.current = attempt + 1;
    setAutosaveState(
      typeof navigator !== "undefined" && !navigator.onLine
        ? "offline"
        : "retrying",
    );
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      const task = latestTaskRef.current;
      const hash = pendingAutosaveHashRef.current;
      if (task && hash && hash !== lastSavedHashRef.current) {
        void runAutosave(task, latestRowsRef.current, hash);
      } else {
        retryAttemptsRef.current = 0;
        setAutosaveState("saved");
      }
    }, delay);
  };

  const runAutosave = async (task: Task, rows: MeasureRow[], hash: string) => {
    if (isSavingRef.current) {
      queuedRef.current = true;
      queuedHashRef.current = hash;
      return;
    }

    // Monitores: no deben pisar medidas del inventariador, pero sí pueden
    // sincronizar marcas de reempaque para que el equipo las vea en vivo.
    if (!canPauseInventory) {
      const serverRows = (Array.isArray(task.measureData) ? task.measureData : []) as MeasureRow[];
      const localPersisted = stripQuickRowsForPersist(rows);
      const { rows: merged, changed: reempaqueChanged } =
        mergeReempaqueFlagsOntoRows(serverRows, localPersisted);

      if (!reempaqueChanged) {
        lastSavedHashRef.current = hash;
        pendingAutosaveHashRef.current = hash;
        setPendingCount(0);
        setAutosaveState("saved");
        return;
      }

      isSavingRef.current = true;
      setAutosaveState("saving");
      const updatedTask: Task = {
        ...task,
        measureData: JSON.parse(
          JSON.stringify(stripQuickRowsForPersist(merged)),
        ),
      };

      let failed = false;
      try {
        await Promise.resolve((onUpdateTask as (t: Task) => unknown)(updatedTask));
        if (activeTaskIdRef.current === task.id) {
          setSelectedTask(updatedTask);
          // Mantener marcas de reempaque visibles sin perder edición local.
          setMeasureRows((prev) => {
            const byId = new Map(
              merged.map((r) => [String(r.id ?? ""), r] as const),
            );
            return prev.map((row) => {
              const m = byId.get(String(row.id ?? ""));
              if (!m) return row;
              const want = m.reempaque === true;
              if ((row.reempaque === true) === want) return row;
              if (want) {
                return {
                  ...row,
                  reempaque: true,
                  bultos: "",
                  weight: "",
                  l: "",
                  w: "",
                  h: "",
                };
              }
              return { ...row, reempaque: false };
            });
          });
        }
        lastSavedHashRef.current = hash;
        retryAttemptsRef.current = 0;
        if (retryTimerRef.current) {
          clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        setLastSavedAt(Date.now());
        setAutosaveState("saved");
        setPendingCount(0);
        onLocalSaveCompletedRef.current();
      } catch (e) {
        console.error(e);
        failed = true;
        setAutosaveState("error");
      } finally {
        isSavingRef.current = false;
      }

      if (failed) {
        scheduleAutosaveRetry();
      }
      return;
    }

    isSavingRef.current = true;
    setAutosaveState("saving");

    const hasCapture = quickRowsHaveAnyCapture(rows);
    const totalsBultos = rows.reduce(
      (a, row) => a + (parseFloat(String(row.bultos)) || 0),
      0,
    );
    const originalExpected = task.originalExpectedBultos || task.expectedBultos;
    const requiredOk = hasCapture && hasQuickRequiredData(rows);
    const priorStatus = task.status;
    const isCompleted =
      priorStatus === "completed"
        ? requiredOk
        : requiredOk && totalsBultos >= task.expectedBultos;

    const persistedRows = hasCapture ? stripQuickRowsForPersist(rows) : [];
    if (!hasCapture && typeof window !== "undefined") {
      window.localStorage.removeItem(inventoryDraftKey(task.id, taskDraftKind(task)));
    }

    const measureChanged =
      JSON.stringify(task.measureData ?? []) !== JSON.stringify(persistedRows);
    const referenceModeChanged =
      (task.referenceMode ?? null) !== (referenceModeRef.current ?? null);
    // Solo reanudar pausa si hubo cambio real de captura (no por abrir el RA).
    const forceResume = task.status === "paused" && measureChanged;

    const withData: Task = {
      ...task,
      measureData: JSON.parse(JSON.stringify(persistedRows)),
      currentBultos: hasCapture ? totalsBultos : 0,
      weightMode: QUICK_WEIGHT_MODE,
      referenceMode: referenceModeRef.current,
      originalExpectedBultos: originalExpected,
      manualTotalWeight:
        task.manualTotalWeight !== undefined ? task.manualTotalWeight : 0,
    };
    const withSession = applyInventorySessionOnSave({
      task: withData,
      hasCapture,
      isCompleted,
      workStatusWhenActive: "in_progress",
      forceResume,
    });

    const statusUnchanged = withSession.status === task.status;
    if (!measureChanged && !referenceModeChanged && statusUnchanged && !isCompleted) {
      lastSavedHashRef.current = hash;
      setAutosaveState("saved");
      setPendingCount(0);
      isSavingRef.current = false;
      onLocalSaveCompletedRef.current();
      return;
    }

    const updatedTask: Task = applyInventoryAttribution(withSession, {
      userKey: presenceUserKey,
      userLabel: presenceUserLabel,
      hasCapture,
      isCompleted,
      priorStatus,
    });

    let failed = false;
    try {
      await Promise.resolve((onUpdateTask as (t: Task) => unknown)(updatedTask));
      if (activeTaskIdRef.current === task.id) {
        setSelectedTask(updatedTask);
      }
      lastSavedHashRef.current = hash;
      retryAttemptsRef.current = 0;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      setLastSavedAt(Date.now());
      setAutosaveState("saved");
      setAutosaveTick((v) => v + 1);
    } catch {
      failed = true;
    } finally {
      isSavingRef.current = false;
      onLocalSaveCompletedRef.current();
      if (queuedRef.current && queuedHashRef.current !== lastSavedHashRef.current) {
        // Hay un cambio más nuevo en cola: guárdalo (tiene prioridad sobre un reintento).
        queuedRef.current = false;
        const latestHash =
          queuedHashRef.current ||
          JSON.stringify({
            rows: latestRowsRef.current,
          });
        queuedHashRef.current = "";
        if (latestTaskRef.current) {
          await runAutosave(
            latestTaskRef.current,
            latestRowsRef.current,
            latestHash,
          );
        }
      } else if (failed) {
        scheduleAutosaveRetry();
      }
    }
  };

  // Guarda de inmediato cualquier cambio pendiente (sin esperar al debounce).
  // Se usa al salir de la RA, al desmontar y al ocultar/cerrar la pestaña.
  const flushAutosave = () => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    const task = latestTaskRef.current;
    if (task) {
      persistQuickDraft(
        task.id,
        latestRowsRef.current,
        referenceModeRef.current,
        captureLayout,
        { force: true },
      );
    }
    const hash = pendingAutosaveHashRef.current;
    if (task && hash && hash !== lastSavedHashRef.current) {
      void runAutosave(task, latestRowsRef.current, hash);
    }
  };
  flushAutosaveRef.current = flushAutosave;

  useEffect(() => {
    if (!selectedTask) return;
    latestRowsRef.current = measureRows;
    latestTaskRef.current = selectedTask;
    const hash = JSON.stringify({ rows: measureRows, referenceMode, captureLayout });
    pendingAutosaveHashRef.current = hash;
    persistQuickDraft(selectedTask.id, measureRows, referenceMode, captureLayout);
    const dirty = hash !== lastSavedHashRef.current;
    setPendingCount(dirty ? 1 : 0);
    if (!dirty) return;

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = setTimeout(() => {
      void runAutosave(selectedTask, measureRows, hash);
    }, QUICK_AUTOSAVE_MS);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [measureRows, selectedTask, referenceMode, captureLayout]);

  // Refleja en pendingCount cuando un guardado confirma (hash guardado == pendiente).
  useEffect(() => {
    if (autosaveState === "saved" || autosaveState === "idle") {
      const hash = pendingAutosaveHashRef.current;
      if (!hash || hash === lastSavedHashRef.current) setPendingCount(0);
    }
  }, [autosaveState, autosaveTick]);

  // Flush al desmontar y cuando la pestaña se oculta/cierra (PWA móvil incluida).
  useEffect(() => {
    const flush = () => flushAutosaveRef.current();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  // Estado de conexión + reintento inmediato al recuperar la red.
  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      const task = latestTaskRef.current;
      const hash = pendingAutosaveHashRef.current;
      if (task && hash && hash !== lastSavedHashRef.current) {
        void runAutosave(task, latestRowsRef.current, hash);
      }
    };
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const saveOrder = async () => {
    if (!selectedTask) return;
    if (!canPauseInventory) {
      clearTask();
      return;
    }
    const totals = calculateTotals();
    const hasCapture = quickRowsHaveAnyCapture(measureRows);
    const originalExpected =
      selectedTask.originalExpectedBultos || selectedTask.expectedBultos;
    const requiredOk = hasCapture && hasQuickRequiredData(measureRows);
    const priorStatus = selectedTask.status;
    const isCompleted =
      priorStatus === "completed"
        ? requiredOk
        : requiredOk && totals.bultos >= selectedTask.expectedBultos;

    const persistedRows = hasCapture ? stripQuickRowsForPersist(measureRows) : [];
    if (!hasCapture && typeof window !== "undefined") {
      window.localStorage.removeItem(
        inventoryDraftKey(selectedTask.id, taskDraftKind(selectedTask)),
      );
    }

    const measureChanged =
      JSON.stringify(selectedTask.measureData ?? []) !==
      JSON.stringify(persistedRows);
    const withData: Task = {
      ...selectedTask,
      measureData: JSON.parse(JSON.stringify(persistedRows)),
      currentBultos: hasCapture ? totals.bultos : 0,
      weightMode: QUICK_WEIGHT_MODE,
      referenceMode: referenceModeRef.current,
      originalExpectedBultos: originalExpected,
      manualTotalWeight:
        selectedTask.manualTotalWeight !== undefined
          ? selectedTask.manualTotalWeight
          : 0,
    };
    const withSession = applyInventorySessionOnSave({
      task: withData,
      hasCapture,
      isCompleted,
      workStatusWhenActive: "in_progress",
      forceResume: selectedTask.status === "paused" && measureChanged,
    });

    const updatedTask: Task = applyInventoryAttribution(withSession, {
      userKey: presenceUserKey,
      userLabel: presenceUserLabel,
      hasCapture,
      isCompleted,
      priorStatus,
    });

    const currentHash = JSON.stringify({
      rows: measureRows,
      referenceMode,
      captureLayout,
    });
    pendingAutosaveHashRef.current = currentHash;
    setAutosaveState("saving");
    try {
      await Promise.resolve((onUpdateTask as (t: Task) => unknown)(updatedTask));
      // Marca el estado como guardado para que el flush de clearTask no dispare
      // un segundo guardado redundante del mismo contenido.
      lastSavedHashRef.current = currentHash;
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(
          inventoryDraftKey(selectedTask.id, taskDraftKind(selectedTask)),
        );
      }
      retryAttemptsRef.current = 0;
      setLastSavedAt(Date.now());
      setPendingCount(0);
      setAutosaveState("saved");
      clearTask();
    } catch {
      // No limpiamos la RA: mantenemos lo capturado y reintentamos en segundo plano.
      setAutosaveState("error");
      scheduleAutosaveRetry();
    }
  };

  const tableMinWidthClass = "min-w-[1180px]";

  // Lista de órdenes (sin task seleccionado) — encabezado fijo, solo la lista con barra de desplazamiento
  if (!selectedTask) {
    return (
      <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
        <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
          <div className="mb-2 shrink-0 space-y-2 sm:mb-4 sm:space-y-4 md:mb-6 md:space-y-6">
            <div className="flex flex-row items-center justify-between gap-2 sm:gap-4">
              <div>
                <h2 className="flex items-center gap-1.5 text-base font-bold text-[#16263F] dark:text-slate-100 sm:gap-2 sm:text-fluid-title md:gap-3">
                  <Box className="h-4 w-4 shrink-0 text-[#16263F] dark:text-slate-100 sm:icon-lg" />
                  Ingreso rápido
                </h2>
              </div>
              <button
                type="button"
                onClick={openManualModal}
                className="flex w-auto cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-[#16263F] px-2.5 py-1.5 text-[10px] font-semibold text-white shadow-md transition hover:bg-[#0f172a] active:scale-95 sm:gap-2 sm:rounded-xl sm:px-4 sm:py-2.5 sm:text-xs md:px-5 md:py-3 md:text-sm"
              >
                <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="sm:hidden">Nueva</span>
                <span className="hidden sm:inline">Nueva orden manual</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-0.5 rounded-lg border border-slate-200 bg-slate-100/80 p-0.5 dark:border-slate-600 dark:bg-slate-800/50 sm:gap-1 sm:rounded-xl sm:p-1">
              <button
                type="button"
                onClick={() => {
                  setViewMode("pending");
                  setClientFilter("Todos");
                }}
                className={`rounded-md px-1 py-1.5 text-[10px] font-semibold transition-all sm:rounded-lg sm:px-4 sm:py-2.5 sm:text-xs ${
                  viewMode === "pending"
                    ? "bg-white text-blue-600 shadow-sm dark:bg-slate-900 dark:text-blue-400"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                Pendientes
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode("priority");
                  setClientFilter("Todos");
                }}
                className={`rounded-md px-1 py-1.5 text-[10px] font-semibold transition-all sm:rounded-lg sm:px-4 sm:py-2.5 sm:text-xs ${
                  viewMode === "priority"
                    ? "bg-red-500 text-white shadow-sm"
                    : "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                }`}
              >
                <span className="sm:hidden">Prioridad</span>
                <span className="hidden sm:inline">Prioridad contenedor</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setViewMode("completed");
                  setClientFilter("Todos");
                }}
                className={`rounded-md px-1 py-1.5 text-[10px] font-semibold transition-all sm:rounded-lg sm:px-4 sm:py-2.5 sm:text-xs ${
                  viewMode === "completed"
                    ? "bg-white text-emerald-600 shadow-sm dark:bg-slate-900"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                }`}
              >
                Completados
              </button>
            </div>

            {clients.length > 0 && (
              <div className="flex items-center gap-1.5 sm:gap-3">
                <label
                  htmlFor="quick-client-filter"
                  className="shrink-0 text-[8px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 sm:text-[10px]"
                >
                  Cliente
                </label>
                <select
                  id="quick-client-filter"
                  value={clientFilter}
                  onChange={(e) => setClientFilter(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[#16263F] outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 sm:max-w-md sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs"
                >
                  <option value="Todos">TODOS ({totalModuleTasks})</option>
                  {clients.map((c) => (
                    <option key={c} value={c}>
                      {c} ({groupedTasks[c].length})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-[max(6rem,calc(env(safe-area-inset-bottom,0px)+4.5rem))] sm:pb-20">
            <div className="grid grid-cols-1 gap-2.5 sm:gap-3">
              {displayedTasks.length === 0 ? (
                <div className="rounded-[2rem] border border-slate-200 bg-white p-8 text-center font-bold text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-500 md:p-16">
                  No hay órdenes{" "}
                  {viewMode === "completed"
                    ? "completadas"
                    : viewMode === "priority"
                      ? "marcadas como prioridad para contenedor"
                      : "pendientes regulares"}
                  .
                </div>
              ) : (
                <>
                  {visibleListTasks.map((t) => (
                    <div key={t.id}>
                      <RaTaskCard
                        task={t}
                        viewMode={viewMode}
                        liveWorkers={liveOperatorsForRa(presenceByRa, t.ra)}
                        nowMs={sharedNowMs}
                        onSelect={onSelectRaCard}
                        onEdit={onEditRaCard}
                        onDelete={onDeleteTask}
                      />
                    </div>
                  ))}
                  {displayedTasks.length > visibleListTasks.length ? (
                    <button
                      type="button"
                      onClick={() =>
                        setListVisibleCount((n) => n + RA_LIST_PAGE_SIZE)
                      }
                      className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      Mostrar más (
                      {displayedTasks.length - visibleListTasks.length} restantes)
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Vista de captura de medidas.
  // El "declarado" del detalle debe coincidir con el de la tarjeta (expectedBultos,
  // que es el valor editable). Así, si el usuario cambia los bultos del RA, el
  // detalle (DECL / progreso) se actualiza de inmediato.
  const t = selectedTask;
  const totals = calculateTotals();
  const originalExpected =
    t?.expectedBultos && t.expectedBultos > 0
      ? t.expectedBultos
      : t?.originalExpectedBultos || 0;
  const faltantes = originalExpected - totals.bultos;

  const showWeightColumn = true;
  const palletized = referenceMode === "palletized";
  // La referencia se captura en «Con/Sin refs»; en Paletizado se oculta (agrupa por paleta).
  const showReferenceColumn = !palletized;
  const measureColumnCount =
    1 +
    (showReferenceColumn ? 1 : 0) +
    1 +
    (showWeightColumn ? 1 : 0) +
    3 +
    1 +
    (showWeightColumn ? 1 : 0) +
    1;
  const completedRows = measureRows.filter((row) => isQuickRowComplete(row)).length;

  const completedByLabel =
    t?.status === "completed" ? inventoryCompletedByLabel(t) : null;
  const correctionBanner =
    t?.status === "completed" ? (
      <div
        role="status"
        className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100"
      >
        Corrección de medidas
        {completedByLabel ? (
          <span className="font-bold"> · se mantiene Por {completedByLabel}</span>
        ) : null}
      </div>
    ) : null;

  if (captureLayout === "reekon") {
    return (
      <>
        {remoteUpdatePending ? (
          <div className="fixed inset-x-0 top-0 z-[10001] p-2">
            <RemoteSyncBanner onApply={applyPendingRemoteUpdate} />
          </div>
        ) : null}
        <input
          ref={aiFileRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={(ev) => {
            const file = ev.target.files?.[0];
            ev.target.value = "";
            if (file) void runAiRefExtract(file);
          }}
        />
        <div className="flex h-full min-h-0 w-full flex-1 flex-col">
          {correctionBanner ? (
            <div className="shrink-0 px-2 pt-2 sm:px-3">{correctionBanner}</div>
          ) : null}
          <ReekonCaptureView
          measureRows={measureRows}
          referenceMode={referenceMode}
          onSwitchReferenceMode={switchReferenceMode}
          activeRowId={expandedRowId}
          onActiveRowChange={setExpandedRowId}
          onUpdateRow={(id, field, value) => updateRowValue(id, field, value)}
          onReferenceChange={(id, value) => {
            updateRowValue(id, "referencia", value);
            const trimmed = String(value ?? "").trim();
            if (trimmed) {
              sourceReferencesRef.current[id] = trimmed;
            } else {
              delete sourceReferencesRef.current[id];
            }
            scheduleCatalogLookup(id, value);
          }}
          onReferenceBlur={(id, value) => {
            const deb = catalogDebounceRef.current[id];
            if (deb) {
              clearTimeout(deb);
              delete catalogDebounceRef.current[id];
            }
            void runCatalogLookup(id, value);
          }}
          onAddRow={addRow}
          onAddPallet={() =>
            createPalletWithNumber(maxPalletNumber(measureRows) + 1)
          }
          onAddRowToPallet={addRowToPallet}
          onSetPalletWeight={setPalletWeight}
          onDeleteRow={deleteRow}
          raLabel={String(t.ra ?? "")}
          declaredBultos={originalExpected}
          physicalBultos={totals.bultos}
          faltantes={faltantes}
          totalCbm={totals.cbm}
          totalWeight={totals.weight}
          completedCount={completedRows}
          onBack={requestLeave}
          onSwitchToTable={() => setCaptureLayoutWithPersist("table")}
          onSave={saveOrder}
          onPause={canPauseInventory ? () => void pauseAndExit() : undefined}
          onResume={canPauseInventory ? () => void resumePausedInventory() : undefined}
          isPaused={t.status === "paused"}
          canPause={
            canPauseInventory &&
            quickRowsHaveAnyCapture(measureRows) &&
            t.status !== "completed"
          }
          autosaveState={autosaveState}
          isSaving={autosaveState === "saving"}
          syncStatus={{
            state: autosaveState,
            lastSavedAt,
            pendingCount,
            isOnline,
          }}
        />
        </div>
        {leavePromptOpen ? (
          <div
            className="fixed inset-0 z-[100000] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-pause-title-reekon"
          >
            <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
              <h3
                id="leave-pause-title-reekon"
                className="text-base font-black text-[#16263F] dark:text-slate-100"
              >
                ¿Pausar inventario?
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Debes pausar el inventario antes de salir, o confirmar que
                quieres salir sin pausar. Si lo dejas en curso, seguirá
                apareciendo como activo en la lista.
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => void pauseAndExit()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#16263F] py-2.5 text-sm font-bold text-white"
                >
                  <Pause className="h-4 w-4" />
                  Pausar y salir
                </button>
                <button
                  type="button"
                  onClick={clearTask}
                  className="flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                >
                  Salir sin pausar
                </button>
                <button
                  type="button"
                  onClick={() => setLeavePromptOpen(false)}
                  className="flex w-full items-center justify-center rounded-xl py-2 text-sm font-semibold text-slate-500"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <InventoryCsvExportModal
          open={csvExportOpen}
          raLabel={String(t.ra ?? "")}
          defaultNumero={String(t.ra ?? "").trim()}
          onCancel={() => setCsvExportOpen(false)}
          onConfirm={(numeroDocumento) => {
            const rows = measureRows as unknown as Record<string, unknown>[];
            if (countInventarioCsvRows(rows) === 0) {
              // eslint-disable-next-line no-alert
              alert("No hay líneas con datos para exportar.");
              setCsvExportOpen(false);
              return;
            }
            const variant = taskDraftKind(t);
            const raSafe = String(t.ra ?? "RA").replace(/[/\\?%*:|"<>]/g, "-");
            downloadInventarioCsv({
              numeroDocumento,
              measureRows: rows,
              variant,
              filenameBase: `inventario-${variant}-${raSafe}`,
            });
            setCsvExportOpen(false);
          }}
        />
      </>
    );
  }

  return (
    <>
    <div className="flex h-full min-h-0 w-full flex-1 flex-col animate-fade">
      <div className="mb-2 shrink-0 space-y-2 px-0.5 md:px-0">
        {remoteUpdatePending ? (
          <RemoteSyncBanner onApply={applyPendingRemoteUpdate} />
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={requestLeave}
            className="inline-flex touch-target items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-2.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-[#16263F] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-slate-100 sm:gap-2 sm:px-3"
          >
            <ArrowLeft className="icon-sm" />
            <span className="truncate">Volver</span>
          </button>
          <button
            type="button"
            onClick={() => setCsvExportOpen(true)}
            title="Descargar CSV compatible con Excel"
            className="inline-flex touch-target items-center justify-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-2 py-2.5 text-xs font-semibold text-sky-900 transition hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100 dark:hover:bg-sky-900/50 sm:gap-2 sm:px-3"
          >
            <Download className="icon-sm" />
            <span className="truncate">CSV</span>
          </button>
        </div>

          {t && (
            <div className="flex flex-wrap items-center gap-2">
              <CaptureLayoutToggle
                layout={captureLayout}
                onChange={setCaptureLayoutWithPersist}
              />
              <span className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-[#16263F] shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 sm:flex-none sm:text-sm">
                <Box className="icon-sm text-blue-600 dark:text-blue-400" />
                RA-{t.ra}
              </span>
              <SyncStatusBadge
                status={{
                  state: autosaveState,
                  lastSavedAt,
                  pendingCount,
                  isOnline,
                }}
              />
            </div>
          )}

        {t && (
          <button
            type="button"
            onClick={() => setCaptureLayoutWithPersist("reekon")}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/80 px-3 py-2 text-[11px] font-semibold text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-100 sm:hidden"
          >
            <Smartphone className="icon-sm" />
            Usar vista Reekon — mejor para celular
          </button>
        )}

        {correctionBanner}
      </div>

      {t && (
        <div className="flex h-full min-h-0 max-h-full flex-1 flex-col gap-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:gap-2 sm:rounded-2xl sm:p-2 md:p-3">
          <InventoryReceptionCompact
            friendly
            leadingIcon={<Box className="h-4 w-4" aria-hidden />}
            badge="RA · referencia previa"
            provider={t.provider}
            brand={t.brand}
            expectedCbm={t.expectedCbm}
            expectedWeight={t.expectedWeight}
            subClient={t.subClient}
            notes={t.notes}
            captureEyebrow="Progreso de recepción"
            declared={originalExpected}
            physical={totals.bultos}
            faltantes={faltantes}
            totalCbm={totals.cbm}
            totalWeight={totals.weight}
            totalWeightDecimals={1}
          />

          <div className="flex min-h-0 flex-1 basis-0 flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-600">
            <div className="flex shrink-0 flex-col gap-2 border-b border-slate-200 bg-slate-50/90 px-2 py-2 dark:border-slate-600 dark:bg-slate-800/50 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-3">
              <div className="flex min-w-0 items-center gap-2">
                <Ruler className="icon-sm shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#16263F] dark:text-slate-100">
                    Captura de medidas
                  </p>
                  {referenceMode !== "palletized" && (
                    <p className="hidden text-[11px] text-slate-500 dark:text-slate-400 sm:block">
                      {referenceMode === "with"
                        ? "Referencias del RA, bultos, peso y dimensiones en cm"
                        : "Numeración consecutiva — solo bultos y dimensiones"}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
                <input
                  ref={aiFileRef}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  className="hidden"
                  onChange={(ev) => {
                    const file = ev.target.files?.[0];
                    ev.target.value = "";
                    if (file) void runAiRefExtract(file);
                  }}
                />
                <button
                  type="button"
                  onClick={openAiFilePicker}
                  disabled={aiExtractBusy}
                  title="Leer un documento con Alde.IA y agregar solo referencias y bultos"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11px] font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-60 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200 dark:hover:bg-violet-900/50 sm:text-xs"
                >
                  {aiExtractBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <GeminiSparkIcon size={14} />
                  )}
                  {aiExtractBusy ? "Leyendo…" : "Leer documento"}
                </button>
                <div className="inline-flex w-full items-center gap-1 rounded-xl border border-slate-200 bg-white px-1.5 py-1 dark:border-slate-600 dark:bg-slate-900 sm:w-auto">
                  <div className="inline-flex w-full rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-600 dark:bg-slate-800 sm:w-auto">
                    <button
                      type="button"
                      onClick={() => switchReferenceMode("with")}
                      className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold transition sm:flex-none sm:px-3 sm:text-xs ${
                        referenceMode === "with"
                          ? "bg-[#16263F] text-white shadow-sm"
                          : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900"
                      }`}
                    >
                      Con refs
                    </button>
                    <button
                      type="button"
                      onClick={() => switchReferenceMode("without")}
                      className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold transition sm:flex-none sm:px-3 sm:text-xs ${
                        referenceMode === "without"
                          ? "bg-[#16263F] text-white shadow-sm"
                          : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900"
                      }`}
                    >
                      Sin refs
                    </button>
                    <button
                      type="button"
                      onClick={() => switchReferenceMode("palletized")}
                      className={`flex-1 rounded-md px-2 py-1.5 text-[10px] font-semibold transition sm:flex-none sm:px-3 sm:text-xs ${
                        referenceMode === "palletized"
                          ? "bg-[#16263F] text-white shadow-sm"
                          : "text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900"
                      }`}
                    >
                      Paletizado
                    </button>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-[10px] font-medium text-slate-500 dark:text-slate-400 sm:text-[11px]">
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500 sm:h-3.5 sm:w-3.5" />
                    {completedRows} ok
                  </span>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  <span>{measureRows.length} líneas</span>
                </div>
              </div>
            </div>

            {aiExtractError ? (
              <div className="shrink-0 border-b border-red-200 bg-red-50 px-3 py-1.5 text-[11px] font-medium text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {aiExtractError}
              </div>
            ) : null}
            <div className="inventory-table-scroll-host table-scroll-hint flex min-h-0 flex-1 basis-0 flex-col overflow-hidden bg-white dark:bg-slate-900">
            <div className={`${tableScrollHostClass} inventory-measures-scroll`}>
            <table
              className={`w-full border-collapse text-left text-sm md:min-w-full ${tableMinWidthClass}`}
            >
              <thead className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 text-[10px] font-semibold text-slate-600 shadow-sm backdrop-blur-sm dark:border-slate-600 dark:bg-slate-900/95 dark:text-slate-300 md:text-xs supports-[backdrop-filter]:bg-white/90">
                <tr>
                  <th className="w-10 px-2 py-2.5 text-center" title="Número de línea">#</th>
                  {showReferenceColumn && (
                    <th className="min-w-[7rem] px-2 py-2.5 text-left">Referencia</th>
                  )}
                  <th className="w-24 px-2 py-2.5 text-center">Bultos</th>
                  {showWeightColumn && (
                    <th
                      className="w-24 px-2 py-2.5 text-center"
                      title={
                        palletized
                          ? "El peso se captura por paleta (arriba de cada grupo)"
                          : "Peso de un bulto en kilogramos"
                      }
                    >
                      {palletized ? "Peso (paleta)" : "Peso/bulto (kg)"}
                    </th>
                  )}
                  <th className="w-20 px-2 py-2.5 text-center" title="Largo en centímetros">Largo</th>
                  <th className="w-20 px-2 py-2.5 text-center" title="Ancho en centímetros">Ancho</th>
                  <th className="w-20 px-2 py-2.5 text-center" title="Alto en centímetros">Alto</th>
                  <th className="bg-slate-50 px-2 py-2.5 text-center font-bold text-[#16263F] dark:bg-slate-800/60 dark:text-slate-100">
                    Volumen (m³)
                  </th>
                  {showWeightColumn && (
                    <th className="bg-slate-50 px-2 py-2.5 text-center font-bold text-[#16263F] dark:bg-slate-800/60 dark:text-slate-100">
                      Peso total (kg)
                    </th>
                  )}
                  <th className="w-20 px-2 py-2.5 text-center" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(() => {
                  let lastPallet: number | null = null;
                  let palletRowNum = 0;
                  return measureRows.map((row, idx) => {
                  const rowPallet = Math.max(1, Number(row.pallet) || 1);
                  const isNewPallet = palletized && rowPallet !== lastPallet;
                  if (isNewPallet) {
                    lastPallet = rowPallet;
                    palletRowNum = 0;
                  }
                  palletRowNum += 1;
                  const displayNum = palletized ? palletRowNum : idx + 1;

                  return (
                    <React.Fragment key={row.id}>
                    {isNewPallet && (
                      <tr className="bg-indigo-50/80 dark:bg-indigo-950/30">
                        <td colSpan={measureColumnCount} className="px-3 py-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                              <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
                              Paleta {rowPallet}
                            </span>
                            <div className="ml-auto flex items-center gap-1.5">
                              <label className="text-[10px] font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
                                Peso paleta
                              </label>
                              <PalletWeightInput
                                palletNum={rowPallet}
                                value={String(row.palletWeight ?? "")}
                                onCommit={setPalletWeight}
                              />
                              <span className="text-[10px] font-semibold text-indigo-500 dark:text-indigo-400">
                                kg
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => addRowToPallet(rowPallet)}
                                title={`Añadir fila a la Paleta ${rowPallet}`}
                                className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-indigo-600 transition hover:bg-indigo-50 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                              >
                                <Plus className="h-3 w-3" aria-hidden /> Fila
                              </button>
                              <button
                                type="button"
                                onClick={() => deletePallet(rowPallet)}
                                title={`Eliminar la Paleta ${rowPallet}`}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-red-200 bg-white text-red-500 transition hover:bg-red-50 hover:text-red-600 dark:border-red-900/50 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950/40"
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                    <MeasureTableRow
                      row={row}
                      displayNum={displayNum}
                      referenceLabel={showReferenceColumn ? idx + 1 : 0}
                      showReferenceColumn={showReferenceColumn}
                      showWeightColumn={showWeightColumn}
                      referenceMode={referenceMode}
                      onUpdateValue={updateRowValue}
                      onCommitMeasure={commitMeasureField}
                      onToggleReempaque={toggleReempaque}
                      onDeleteRow={deleteRow}
                      onReferenceChange={handleReferenceChange}
                      onReferenceBlur={handleReferenceBlur}
                    />
                    </React.Fragment>
                  );
                  });
                })()}
              </tbody>
            </table>
            </div>
            </div>
          </div>

          <div className="isolate z-10 shrink-0 space-y-1.5 border-t border-slate-200 pt-2 dark:border-slate-600 sm:space-y-2 sm:pt-3">
            {palletized ? (
              <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-2">
                <button
                  type="button"
                  onClick={addRow}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 py-2 text-[11px] font-semibold text-slate-600 transition-all hover:border-slate-400 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:rounded-xl sm:py-3 sm:text-xs md:text-sm"
                >
                  <Plus className="icon-sm" /> Agregar fila a la paleta
                </button>
                <button
                  type="button"
                  onClick={openPalletModal}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border-2 border-indigo-300 bg-indigo-50 py-2 text-[11px] font-bold text-indigo-700 transition-all hover:border-indigo-400 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-950/60 sm:rounded-xl sm:py-3 sm:text-xs md:text-sm"
                >
                  <LayoutGrid className="icon-sm" /> Agregar otra paleta
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={addRow}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 py-2 text-[11px] font-semibold text-slate-600 transition-all hover:border-slate-400 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:rounded-xl sm:py-3 sm:text-xs md:text-sm"
              >
                <Plus className="icon-sm" /> Agregar
              </button>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              {canPauseInventory && t.status === "paused" ? (
                <button
                  type="button"
                  onClick={() => void resumePausedInventory()}
                  className="flex w-full touch-target items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 py-2.5 text-sm font-bold text-emerald-800 transition-all hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 sm:py-3"
                >
                  <Play className="icon-md" />
                  Reanudar
                </button>
              ) : canPauseInventory &&
                quickRowsHaveAnyCapture(measureRows) &&
                t.status !== "completed" ? (
                <button
                  type="button"
                  onClick={() => void pauseAndExit()}
                  className="flex w-full touch-target items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-100 py-2.5 text-sm font-bold text-slate-700 transition-all hover:bg-slate-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 sm:py-3"
                >
                  <Pause className="icon-md" />
                  Pausar
                </button>
              ) : null}
              <button
                type="button"
                onClick={saveOrder}
                className="flex w-full touch-target items-center justify-center gap-2 rounded-xl bg-[#16263F] py-2.5 text-sm font-bold text-white shadow-lg transition-all hover:bg-[#0f172a] active:scale-[0.99] sm:py-3 md:py-4"
              >
                <Check className="icon-md" />
                Guardar orden
              </button>
            </div>
            <p className="hidden text-center text-[11px] text-slate-400 dark:text-slate-500 sm:block">
              Los cambios se guardan automáticamente mientras capturas
            </p>
          </div>
        </div>
      )}
    </div>
    {leavePromptOpen ? (
      <div
        className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-pause-title"
      >
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <h3
            id="leave-pause-title"
            className="text-base font-black text-[#16263F] dark:text-slate-100"
          >
            ¿Pausar inventario?
          </h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Hay captura a medias. Si lo dejas en curso, seguirá apareciendo como
            activo en la lista.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => void pauseAndExit()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#16263F] py-2.5 text-sm font-bold text-white"
            >
              <Pause className="h-4 w-4" />
              Pausar y salir
            </button>
            <button
              type="button"
              onClick={clearTask}
              className="flex w-full items-center justify-center rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            >
              Salir sin pausar
            </button>
            <button
              type="button"
              onClick={() => setLeavePromptOpen(false)}
              className="flex w-full items-center justify-center rounded-xl py-2 text-sm font-semibold text-slate-500"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    ) : null}
    <InventoryCsvExportModal
      open={csvExportOpen}
      raLabel={String(t.ra ?? "")}
      defaultNumero={String(t.ra ?? "").trim()}
      onCancel={() => setCsvExportOpen(false)}
      onConfirm={(numeroDocumento) => {
        const rows = measureRows as unknown as Record<string, unknown>[];
        if (countInventarioCsvRows(rows) === 0) {
          // eslint-disable-next-line no-alert
          alert("No hay líneas con datos para exportar.");
          setCsvExportOpen(false);
          return;
        }
        const variant = taskDraftKind(t);
        const raSafe = String(t.ra ?? "RA").replace(/[/\\?%*:|"<>]/g, "-");
        downloadInventarioCsv({
          numeroDocumento,
          measureRows: rows,
          variant,
          filenameBase: `inventario-${variant}-${raSafe}`,
        });
        setCsvExportOpen(false);
      }}
    />
    {palletModalOpen && (() => {
      const parsed = parseInt(palletModalValue, 10);
      const valid = Number.isFinite(parsed) && parsed >= 1;
      const collides = valid && existingPalletNumbers.has(parsed);
      const suggestedFree = maxPalletNumber(measureRows) + 1;
      return (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          onClick={() => setPalletModalOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
                <LayoutGrid className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h3 className="text-sm font-black text-slate-800 dark:text-slate-100">
                  Nueva paleta
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Elige el número de paleta a crear
                </p>
              </div>
            </div>
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={palletModalValue}
              onChange={(e) =>
                setPalletModalValue(e.target.value.replace(/[^\d]/g, ""))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && valid && !collides) confirmPalletModal();
              }}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-center text-lg font-black text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              placeholder={String(suggestedFree)}
            />
            {collides && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="font-bold">
                  La Paleta {parsed} ya está creada y otro inventariador puede
                  estar trabajando en ella.
                </p>
                <p className="mt-0.5">
                  ¿Quieres crear otra paleta? Elige un número libre.
                </p>
                <button
                  type="button"
                  onClick={() => setPalletModalValue(String(suggestedFree))}
                  className="mt-2 inline-flex items-center gap-1 rounded-lg bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800 transition hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-100 dark:hover:bg-amber-900/60"
                >
                  Usar Paleta {suggestedFree}
                </button>
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setPalletModalOpen(false)}
                className="flex-1 rounded-xl border border-slate-300 bg-white py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmPalletModal}
                disabled={!valid || collides}
                className="flex-1 rounded-xl bg-indigo-600 py-2 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Crear paleta
              </button>
            </div>
          </div>
        </div>
      );
    })()}
    </>
  );
}

