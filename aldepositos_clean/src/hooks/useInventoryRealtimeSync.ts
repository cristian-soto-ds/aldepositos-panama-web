"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSharedWorkPresenceTabId } from "@/lib/panelPresence";
import {
  isForeignLiveUpdate,
  scheduleTaskLivePublish,
  subscribeLiveUpdates,
  type TaskLiveUpdate,
} from "@/lib/liveCollaboration";
import type { Task } from "@/lib/types/task";
import { measureDataLooksEmpty } from "@/lib/taskListSlim";

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
  mergeRowsWithRemote?: (localRows: TRow[], remoteRows: TRow[]) => TRow[];
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
      // Solo el estado persistido avanza el baseline (no el broadcast efímero).
      if (!fromLive) {
        onServerSnapshot?.(remoteRows);
      }
      const localRows = latestRowsRef.current;
      const localHash = buildHash(localRows);
      const isDirty = localHash !== lastSavedHashRef.current;

      // Colaboración: si hay cambios locales (u otro usuario midiendo), fusionar
      // en vez de reemplazar — así no se pierde la medida de nadie.
      const shouldMerge =
        Boolean(mergeRowsWithRemote) &&
        (isDirty || fromLive || preferRemoteUpdates) &&
        localRows.length > 0;

      const newRows =
        shouldMerge && mergeRowsWithRemote
          ? mergeRowsWithRemote(localRows, remoteRows)
          : remoteRows;

      // Sin merge (legado): eco de BD con menos filas y altas locales → no pisar UI.
      // Con merge a 3 vías NO se corta: un borrado remoto (25→24) debe aplicarse
      // aunque el otro inventariador tenga ediciones locales / filas nuevas.
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
        pendingRemoteTaskRef.current = remote;
        setRemoteUpdatePending(true);
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
    // Tras guardar, si quedó un remoto pendiente (otro usuario midió durante el
    // save), fusionarlo en vez de descartarlo.
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
      pendingRemoteTaskRef.current = remote;
      setRemoteUpdatePending(true);
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

  useEffect(() => {
    const key = (userKey ?? "").trim();
    if (!selectedId || !key) return;
    const hash = buildHash(measureRows);
    if (hash === lastSavedHashRef.current) return;
    if (hash === lastLivePublishedHashRef.current) return;
    const meta = getLiveTaskMeta(measureRows);
    lastLivePublishedHashRef.current = hash;
    scheduleTaskLivePublish({
      taskId: selectedId,
      userKey: key,
      measureData: measureRows as unknown[],
      currentBultos: meta.currentBultos,
      status: meta.status,
      capturedWeight: meta.capturedWeight,
      rowCount: meta.rowCount,
      completeRowCount: meta.completeRowCount,
      referenceMode: liveReferenceMode,
    });
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
