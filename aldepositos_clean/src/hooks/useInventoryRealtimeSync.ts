"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSharedWorkPresenceTabId } from "@/lib/panelPresence";
import {
  flushTaskLivePublish,
  isForeignLiveUpdate,
  scheduleTaskLivePublish,
  subscribeLiveUpdates,
  type TaskLiveUpdate,
} from "@/lib/liveCollaboration";
import type { Task } from "@/lib/types/task";
import { measureDataLooksEmpty } from "@/lib/taskListSlim";

type MergeRemoteOptions = { fromLive?: boolean };

type InventoryRealtimeSyncOptions<TRow> = {
  tasks: Task[];
  selectedTask: Task | null;
  measureRows: TRow[];
  setSelectedTask: React.Dispatch<React.SetStateAction<Task | null>>;
  setMeasureRows: React.Dispatch<React.SetStateAction<TRow[]>>;
  isSavingRef: React.MutableRefObject<boolean>;
  isEditingRef?: React.MutableRefObject<boolean>;
  lastSavedHashRef: React.MutableRefObject<string>;
  latestRowsRef: React.MutableRefObject<TRow[]>;
  latestTaskRef: React.MutableRefObject<Task | null>;
  buildHash: (rows: TRow[]) => string;
  prepareRowsFromRemote: (remote: Task) => TRow[];
  /**
   * Fusiona filas locales con remotas (3 vías) para colaboración multi-usuario.
   * Si no se pasa, se reemplaza el estado local (comportamiento anterior).
   */
  mergeRowsWithRemote?: (
    localRows: TRow[],
    remoteRows: TRow[],
    options?: MergeRemoteOptions,
  ) => TRow[];
  /** Snapshot persistido del servidor (para el merge a 3 vías). */
  onServerSnapshot?: (rows: TRow[]) => void;
  getLiveTaskMeta: (rows: TRow[]) => {
    currentBultos: number;
    status: string;
    capturedWeight?: number;
    rowCount?: number;
    completeRowCount?: number;
  };
  userKey?: string | null;
  onTaskRemoved?: () => void;
  /** Modo de captura local a difundir en vivo (con/sin refs o paletizado). */
  liveReferenceMode?: string;
  /** Se invoca cuando llega un modo de captura remoto distinto (otra vista/dispositivo). */
  onRemoteReferenceMode?: (mode: string) => void;
  /**
   * Si true (p. ej. monitor sin permiso de inventariar), los broadcasts remotos
   * siempre se aplican aunque el editor local esté "dirty".
   */
  preferRemoteUpdates?: boolean;
};

/**
 * Sincroniza el editor con:
 * - Broadcast en vivo (~80 ms) mientras otro operador escribe
 * - Supabase Realtime / refetch al guardar en BD
 * - Merge concurrente para no pisar medidas de otro inventariador
 *
 * Nota: durante autosave no se muestra el banner «otro operador» — se encola
 * el remoto y se fusiona al terminar el guardado (evita falsos positivos al
 * borrar/editar en ráfaga).
 */
export function useInventoryRealtimeSync<TRow>({
  tasks,
  selectedTask,
  measureRows,
  setSelectedTask,
  setMeasureRows,
  isSavingRef,
  lastSavedHashRef,
  latestRowsRef,
  latestTaskRef,
  buildHash,
  prepareRowsFromRemote,
  mergeRowsWithRemote,
  onServerSnapshot,
  getLiveTaskMeta,
  userKey,
  onTaskRemoved,
  liveReferenceMode,
  onRemoteReferenceMode,
  preferRemoteUpdates = false,
}: InventoryRealtimeSyncOptions<TRow>) {
  const [remoteUpdatePending, setRemoteUpdatePending] = useState(false);
  const lastRemoteMeasureHashRef = useRef("");
  /** Evita rebroadcast del estado que acabamos de recibir/fusionar (eco → rate-limit). */
  const lastLivePublishedHashRef = useRef("");
  const pendingRemoteTaskRef = useRef<Task | null>(null);
  const selectedId = selectedTask?.id ?? null;
  const prevSelectedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedId === prevSelectedIdRef.current) return;
    prevSelectedIdRef.current = selectedId;
    const remote = selectedId ? tasks.find((t) => t.id === selectedId) : null;
    lastRemoteMeasureHashRef.current = remote
      ? JSON.stringify(remote.measureData ?? [])
      : "";
    lastLivePublishedHashRef.current = "";
    pendingRemoteTaskRef.current = null;
    setRemoteUpdatePending(false);
  }, [selectedId, tasks]);

  const applyRemote = useCallback(
    (remote: Task, fromLive = false) => {
      const remoteRows = prepareRowsFromRemote(remote);
      const localRows = latestRowsRef.current;
      const localHash = buildHash(localRows);
      const isDirty = localHash !== lastSavedHashRef.current;

      // Eco de BD más viejo que nuestro último guardado: no reaplicar filas
      // (evita que una paleta nueva parpadee y desaparezca).
      if (!fromLive && remote.updatedAt && latestTaskRef.current?.updatedAt) {
        const remoteT = Date.parse(String(remote.updatedAt));
        const localT = Date.parse(String(latestTaskRef.current.updatedAt));
        if (
          Number.isFinite(remoteT) &&
          Number.isFinite(localT) &&
          remoteT < localT
        ) {
          lastRemoteMeasureHashRef.current = JSON.stringify(
            remote.measureData ?? [],
          );
          pendingRemoteTaskRef.current = null;
          setRemoteUpdatePending(false);
          return;
        }
      }

      // Colaboración: fusionar con el baseline ANTERIOR al snapshot remoto.
      // Si actualizamos el baseline antes del merge, los borrados remotos se
      // reinsertan como «filas locales nuevas» y los conteos divergen.
      const shouldMerge =
        Boolean(mergeRowsWithRemote) &&
        (isDirty || fromLive || preferRemoteUpdates) &&
        localRows.length > 0;

      const newRows =
        shouldMerge && mergeRowsWithRemote
          ? mergeRowsWithRemote(localRows, remoteRows, { fromLive })
          : remoteRows;

      // Snapshot persistido DESPUÉS del merge.
      if (!fromLive) {
        onServerSnapshot?.(remoteRows);
      }

      // Sin merge (legado): eco de BD con menos filas y altas locales → no pisar UI.
      if (
        !mergeRowsWithRemote &&
        isDirty &&
        !fromLive &&
        remoteRows.length < localRows.length
      ) {
        const remoteIds = new Set(
          remoteRows.map((r) => String((r as { id?: string }).id ?? "")),
        );
        const hasLocalOnly = localRows.some(
          (r) => !remoteIds.has(String((r as { id?: string }).id ?? "")),
        );
        if (hasLocalOnly) {
          setSelectedTask((prev) => {
            if (!prev || prev.id !== remote.id) return remote;
            return {
              ...prev,
              status: remote.status,
              currentBultos: remote.currentBultos,
              expectedBultos: remote.expectedBultos,
              capturedWeight: remote.capturedWeight,
              updatedAt: remote.updatedAt,
              measureData: localRows as unknown[],
            };
          });
          lastRemoteMeasureHashRef.current = JSON.stringify(
            remote.measureData ?? [],
          );
          pendingRemoteTaskRef.current = null;
          setRemoteUpdatePending(false);
          return;
        }
      }

      if (buildHash(newRows) === buildHash(latestRowsRef.current)) {
        setSelectedTask((prev) => {
          if (!prev || prev.id !== remote.id) return remote;
          return {
            ...prev,
            ...remote,
            measureData: newRows as unknown[],
            currentBultos: remote.currentBultos,
            status: remote.status,
          };
        });
        latestTaskRef.current = {
          ...(latestTaskRef.current ?? remote),
          ...remote,
          measureData: newRows as unknown[],
        };
        if (!fromLive && !isDirty) {
          lastSavedHashRef.current = buildHash(newRows);
        }
        lastRemoteMeasureHashRef.current = JSON.stringify(remote.measureData ?? []);
        pendingRemoteTaskRef.current = null;
        setRemoteUpdatePending(false);
        return;
      }

      setMeasureRows(newRows);
      latestRowsRef.current = newRows;
      // Si vino de otro cliente (live o BD), no reenviamos el mismo contenido.
      if (fromLive || shouldMerge) {
        lastLivePublishedHashRef.current = buildHash(newRows);
      }
      const nextTask: Task = {
        ...(latestTaskRef.current && latestTaskRef.current.id === remote.id
          ? latestTaskRef.current
          : remote),
        ...remote,
        measureData: newRows as unknown[],
      };
      setSelectedTask(nextTask);
      latestTaskRef.current = nextTask;

      // Si fusionamos estando dirty, NO marcamos como guardado: el autosave
      // persistirá el resultado unido. Si estábamos limpios, sí.
      if (!fromLive && !isDirty) {
        lastSavedHashRef.current = buildHash(newRows);
      }
      lastRemoteMeasureHashRef.current = JSON.stringify(remote.measureData ?? []);
      pendingRemoteTaskRef.current = null;
      setRemoteUpdatePending(false);
    },
    [
      buildHash,
      latestRowsRef,
      latestTaskRef,
      lastSavedHashRef,
      mergeRowsWithRemote,
      onServerSnapshot,
      preferRemoteUpdates,
      prepareRowsFromRemote,
      setMeasureRows,
      setSelectedTask,
    ],
  );

  const applyLiveUpdate = useCallback(
    (update: TaskLiveUpdate) => {
      const liveHash = JSON.stringify(update.measureData);
      if (liveHash === lastRemoteMeasureHashRef.current) return;

      const base = latestTaskRef.current ?? selectedTask;
      if (!base || base.id !== update.taskId) return;

      const remote: Task = {
        ...base,
        measureData: update.measureData,
        currentBultos: update.currentBultos,
        status: update.status,
        ...(typeof update.capturedWeight === "number"
          ? { capturedWeight: update.capturedWeight }
          : {}),
        ...(typeof update.rowCount === "number" ? { rowCount: update.rowCount } : {}),
        ...(typeof update.completeRowCount === "number"
          ? { completeRowCount: update.completeRowCount }
          : {}),
      };

      if (isSavingRef.current) {
        // Cola silenciosa: el banner amarillo durante autosave (borrados rápidos)
        // era un falso positivo del eco propio y al aplicarlo “regresaba” filas.
        pendingRemoteTaskRef.current = remote;
        return;
      }

      if (
        typeof update.referenceMode === "string" &&
        update.referenceMode &&
        onRemoteReferenceMode
      ) {
        onRemoteReferenceMode(update.referenceMode);
      }

      // Siempre fusionar en vivo (aunque dirty): dos cintas en el mismo RA.
      applyRemote(remote, true);
    },
    [
      applyRemote,
      isSavingRef,
      latestTaskRef,
      onRemoteReferenceMode,
      selectedTask,
    ],
  );

  const applyPendingRemoteUpdate = useCallback(() => {
    const remote = pendingRemoteTaskRef.current;
    if (remote) applyRemote(remote, true);
  }, [applyRemote]);

  const onLocalSaveCompleted = useCallback(() => {
    // Tras guardar, fusionar en silencio cualquier remoto que llegó durante el save.
    const pending = pendingRemoteTaskRef.current;
    if (pending) {
      pendingRemoteTaskRef.current = null;
      setRemoteUpdatePending(false);
      applyRemote(pending, true);
      return;
    }
    setRemoteUpdatePending(false);
  }, [applyRemote]);

  useEffect(() => {
    if (!selectedId) {
      lastRemoteMeasureHashRef.current = "";
      pendingRemoteTaskRef.current = null;
      setRemoteUpdatePending(false);
      return;
    }

    const remote = tasks.find((t) => t.id === selectedId);
    if (!remote) {
      onTaskRemoved?.();
      return;
    }

    // Lista slim (sin measureData): no pisar filas locales del editor abierto.
    if (measureDataLooksEmpty(remote.measureData)) {
      setSelectedTask((prev) => {
        if (!prev || prev.id !== remote.id) return prev;
        if (
          prev.status === remote.status &&
          prev.currentBultos === remote.currentBultos &&
          prev.expectedBultos === remote.expectedBultos &&
          prev.capturedWeight === remote.capturedWeight &&
          prev.completeRowCount === remote.completeRowCount &&
          prev.rowCount === remote.rowCount &&
          prev.updatedAt === remote.updatedAt
        ) {
          return prev;
        }
        return {
          ...prev,
          status: remote.status,
          currentBultos: remote.currentBultos,
          expectedBultos: remote.expectedBultos,
          capturedWeight: remote.capturedWeight,
          completeRowCount: remote.completeRowCount,
          rowCount: remote.rowCount,
          updatedAt: remote.updatedAt,
        };
      });
      return;
    }

    const remoteMeasureHash = JSON.stringify(remote.measureData ?? []);
    const measureChanged = remoteMeasureHash !== lastRemoteMeasureHashRef.current;

    if (!measureChanged) {
      setSelectedTask((prev) => {
        if (!prev || prev.id !== remote.id) return remote;
        const sameStatus = prev.status === remote.status;
        const sameBultos = prev.currentBultos === remote.currentBultos;
        const sameExpected = prev.expectedBultos === remote.expectedBultos;
        const sameWeight = prev.capturedWeight === remote.capturedWeight;
        if (sameStatus && sameBultos && sameExpected && sameWeight) return prev;
        return {
          ...prev,
          status: remote.status,
          currentBultos: remote.currentBultos,
          expectedBultos: remote.expectedBultos,
          capturedWeight: remote.capturedWeight,
          completeRowCount: remote.completeRowCount,
          rowCount: remote.rowCount,
          updatedAt: remote.updatedAt,
        };
      });
      return;
    }

    if (isSavingRef.current) {
      // Eco de BD / otro save mientras autosaveamos: encolar sin banner.
      // (Borrados en ráfaga mantienen isSaving=true casi continuo.)
      pendingRemoteTaskRef.current = remote;
      return;
    }

    // Persistido en BD: fusionar con lo local (no last-write-wins).
    applyRemote(remote, false);
  }, [
    tasks,
    selectedId,
    applyRemote,
    isSavingRef,
    onTaskRemoved,
    setSelectedTask,
  ]);

  useEffect(() => {
    if (!selectedId) return;
    const tabId = getSharedWorkPresenceTabId();
    return subscribeLiveUpdates((update) => {
      if (update.type !== "task" || update.taskId !== selectedId) return;
      if (!isForeignLiveUpdate(update, tabId)) return;
      applyLiveUpdate(update);
    });
  }, [selectedId, userKey, applyLiveUpdate]);

  const prevLiveStructureKeyRef = useRef("");
  const prevLiveMeasuresKeyRef = useRef("");

  useEffect(() => {
    prevLiveStructureKeyRef.current = "";
    prevLiveMeasuresKeyRef.current = "";
  }, [selectedId]);

  useEffect(() => {
    const key = (userKey ?? "").trim();
    if (!selectedId || !key) return;
    const structureKey = measureRows
      .map((r) => String((r as { id?: string }).id ?? ""))
      .join("\0");
    const measuresKey = measureRows
      .map((r) => {
        const row = r as {
          id?: string;
          l?: unknown;
          w?: unknown;
          h?: unknown;
          weight?: unknown;
          palletWeight?: unknown;
          bultos?: unknown;
        };
        return [
          row.id,
          row.l,
          row.w,
          row.h,
          row.weight,
          row.palletWeight,
          row.bultos,
        ].join(":");
      })
      .join("|");
    const hash = buildHash(measureRows);
    if (hash === lastSavedHashRef.current) {
      // Ancla IDs al estado guardado para detectar el próximo alta/baja.
      prevLiveStructureKeyRef.current = structureKey;
      prevLiveMeasuresKeyRef.current = measuresKey;
      return;
    }
    if (hash === lastLivePublishedHashRef.current) return;
    const meta = getLiveTaskMeta(measureRows);
    lastLivePublishedHashRef.current = hash;
    const structureChanged = structureKey !== prevLiveStructureKeyRef.current;
    const measuresChanged = measuresKey !== prevLiveMeasuresKeyRef.current;
    prevLiveStructureKeyRef.current = structureKey;
    prevLiveMeasuresKeyRef.current = measuresKey;
    const payload = {
      taskId: selectedId,
      userKey: key,
      measureData: measureRows as unknown[],
      currentBultos: meta.currentBultos,
      status: meta.status,
      capturedWeight: meta.capturedWeight,
      rowCount: meta.rowCount,
      completeRowCount: meta.completeRowCount,
      referenceMode: liveReferenceMode,
    };
    // Alta/baja o medida nueva: publicar al instante para colaboración.
    if (structureChanged || measuresChanged) flushTaskLivePublish(payload);
    else scheduleTaskLivePublish(payload);
  }, [
    measureRows,
    selectedId,
    userKey,
    buildHash,
    getLiveTaskMeta,
    lastSavedHashRef,
    liveReferenceMode,
  ]);

  return {
    remoteUpdatePending,
    applyPendingRemoteUpdate,
    onLocalSaveCompleted,
  };
}

/** true mientras un input/textarea/select del panel tiene foco */
export function useEditingFocusRef(): React.MutableRefObject<boolean> {
  const isEditingRef = useRef(false);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target;
      if (el instanceof HTMLElement && el.matches("input, textarea, select")) {
        isEditingRef.current = true;
      }
    };
    const onFocusOut = () => {
      window.setTimeout(() => {
        const active = document.activeElement;
        isEditingRef.current =
          active instanceof HTMLElement &&
          active.matches("input, textarea, select");
      }, 40);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return isEditingRef;
}
