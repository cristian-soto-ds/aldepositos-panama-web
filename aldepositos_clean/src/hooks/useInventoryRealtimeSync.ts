"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Task } from "@/lib/types/task";

type InventoryRealtimeSyncOptions<TRow> = {
  tasks: Task[];
  selectedTask: Task | null;
  setSelectedTask: React.Dispatch<React.SetStateAction<Task | null>>;
  setMeasureRows: React.Dispatch<React.SetStateAction<TRow[]>>;
  isSavingRef: React.MutableRefObject<boolean>;
  lastSavedHashRef: React.MutableRefObject<string>;
  latestRowsRef: React.MutableRefObject<TRow[]>;
  latestTaskRef: React.MutableRefObject<Task | null>;
  buildHash: (rows: TRow[]) => string;
  prepareRowsFromRemote: (remote: Task) => TRow[];
  onTaskRemoved?: () => void;
};

/**
 * Sincroniza el editor de inventario con cambios remotos en `tasks`
 * (Realtime / refetch) sin pisar ediciones locales sin guardar.
 */
export function useInventoryRealtimeSync<TRow>({
  tasks,
  selectedTask,
  setSelectedTask,
  setMeasureRows,
  isSavingRef,
  lastSavedHashRef,
  latestRowsRef,
  latestTaskRef,
  buildHash,
  prepareRowsFromRemote,
  onTaskRemoved,
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
    (remote: Task) => {
      const newRows = prepareRowsFromRemote(remote);
      setMeasureRows(newRows);
      setSelectedTask(remote);
      latestRowsRef.current = newRows;
      latestTaskRef.current = remote;
      lastSavedHashRef.current = buildHash(newRows);
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

  const applyPendingRemoteUpdate = useCallback(() => {
    const remote = pendingRemoteTaskRef.current;
    if (remote) applyRemote(remote);
  }, [applyRemote]);

  const onLocalSaveCompleted = useCallback(() => {
    const remote = pendingRemoteTaskRef.current;
    if (!remote) return;
    const localHash = buildHash(latestRowsRef.current);
    if (localHash === lastSavedHashRef.current) {
      applyRemote(remote);
    } else {
      setRemoteUpdatePending(true);
    }
  }, [applyRemote, buildHash, lastSavedHashRef, latestRowsRef]);

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

    const remoteMeasureHash = JSON.stringify(remote.measureData ?? []);
    const measureChanged = remoteMeasureHash !== lastRemoteMeasureHashRef.current;

    setSelectedTask((prev) => {
      if (!prev || prev.id !== remote.id) return remote;
      const sameMeasure =
        JSON.stringify(prev.measureData ?? []) === remoteMeasureHash;
      const sameStatus = prev.status === remote.status;
      const sameBultos = prev.currentBultos === remote.currentBultos;
      const sameExpected = prev.expectedBultos === remote.expectedBultos;
      if (sameMeasure && sameStatus && sameBultos && sameExpected) return prev;
      return { ...prev, ...remote };
    });

    if (!measureChanged) return;

    if (isSavingRef.current) {
      pendingRemoteTaskRef.current = remote;
      return;
    }

    const localHash = buildHash(latestRowsRef.current);
    const isDirty = localHash !== lastSavedHashRef.current;

    if (isDirty) {
      pendingRemoteTaskRef.current = remote;
      setRemoteUpdatePending(true);
      lastRemoteMeasureHashRef.current = remoteMeasureHash;
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
    setSelectedTask,
  ]);

  return {
    remoteUpdatePending,
    applyPendingRemoteUpdate,
    onLocalSaveCompleted,
  };
}
