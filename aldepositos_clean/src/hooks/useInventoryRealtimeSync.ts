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
  getLiveTaskMeta,
  userKey,
  onTaskRemoved,
  liveReferenceMode,
  onRemoteReferenceMode,
  preferRemoteUpdates = false,
}: InventoryRealtimeSyncOptions<TRow>) {
  const [remoteUpdatePending, setRemoteUpdatePending] = useState(false);
  const lastRemoteMeasureHashRef = useRef("");
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
    pendingRemoteTaskRef.current = null;
    setRemoteUpdatePending(false);
  }, [selectedId, tasks]);

  const applyRemote = useCallback(
    (remote: Task, fromLive = false) => {
      const newRows = prepareRowsFromRemote(remote);

      // Si el contenido no cambió (caso típico tras un autosave propio), no
      // reemplazamos las filas: así evitamos repintar toda la tabla y perder la
      // memoización de filas. Solo refrescamos los metadatos de la tarea.
      if (buildHash(newRows) === buildHash(latestRowsRef.current)) {
        setSelectedTask(remote);
        latestTaskRef.current = remote;
        if (!fromLive) {
          lastSavedHashRef.current = buildHash(newRows);
        }
        lastRemoteMeasureHashRef.current = JSON.stringify(remote.measureData ?? []);
        pendingRemoteTaskRef.current = null;
        setRemoteUpdatePending(false);
        return;
      }

      setMeasureRows(newRows);
      setSelectedTask(remote);
      latestRowsRef.current = newRows;
      latestTaskRef.current = remote;
      if (!fromLive) {
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

      const localHash = buildHash(latestRowsRef.current);
      const isDirty = localHash !== lastSavedHashRef.current;

      // Inventariador con cambios locales: no pisar. Monitor: siempre aplicar.
      if (isDirty && !preferRemoteUpdates) {
        pendingRemoteTaskRef.current = remote;
        setRemoteUpdatePending(true);
        lastRemoteMeasureHashRef.current = liveHash;
        return;
      }

      // Sincroniza el modo de captura (con/sin refs o paletizado) ANTES de aplicar
      // las filas, para que la transformación remota use el modo correcto.
      if (
        typeof update.referenceMode === "string" &&
        update.referenceMode &&
        onRemoteReferenceMode
      ) {
        onRemoteReferenceMode(update.referenceMode);
      }

      applyRemote(remote, true);
    },
    [
      applyRemote,
      buildHash,
      isSavingRef,
      lastSavedHashRef,
      latestRowsRef,
      latestTaskRef,
      onRemoteReferenceMode,
      preferRemoteUpdates,
      selectedTask,
    ],
  );

  const applyPendingRemoteUpdate = useCallback(() => {
    const remote = pendingRemoteTaskRef.current;
    if (remote) applyRemote(remote, true);
  }, [applyRemote]);

  const onLocalSaveCompleted = useCallback(() => {
    // Tras guardar, el estado local es la autoridad recién persistida. Descartamos
    // cualquier actualización remota pendiente (que puede ser un eco de un guardado
    // anterior con menos filas) para no revertir lo recién capturado. Un cambio
    // remoto real se re-aplicará en el siguiente refetch cuando no haya pendientes.
    pendingRemoteTaskRef.current = null;
    setRemoteUpdatePending(false);
  }, []);

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

    setSelectedTask((prev) => {
      if (!prev || prev.id !== remote.id) return remote;
      const sameMeasure =
        JSON.stringify(prev.measureData ?? []) === remoteMeasureHash;
      const sameStatus = prev.status === remote.status;
      const sameBultos = prev.currentBultos === remote.currentBultos;
      const sameExpected = prev.expectedBultos === remote.expectedBultos;
      const sameWeight = prev.capturedWeight === remote.capturedWeight;
      if (sameMeasure && sameStatus && sameBultos && sameExpected && sameWeight)
        return prev;
      return { ...prev, ...remote };
    });

    if (!measureChanged) return;

    if (isSavingRef.current) {
      pendingRemoteTaskRef.current = remote;
      setRemoteUpdatePending(true);
      return;
    }

    const localHash = buildHash(latestRowsRef.current);
    const isDirty = localHash !== lastSavedHashRef.current;

    // Nunca pisar cambios locales del inventariador; monitores sí reciben remoto.
    if (isDirty && !preferRemoteUpdates) {
      pendingRemoteTaskRef.current = remote;
      setRemoteUpdatePending(true);
      return;
    }

    applyRemote(remote);
  }, [
    tasks,
    selectedId,
    applyRemote,
    buildHash,
    isSavingRef,
    lastSavedHashRef,
    latestRowsRef,
    onTaskRemoved,
    preferRemoteUpdates,
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
    const meta = getLiveTaskMeta(measureRows);
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
