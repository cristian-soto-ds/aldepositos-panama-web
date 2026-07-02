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
  getLiveTaskMeta: (rows: TRow[]) => { currentBultos: number; status: string };
  userKey?: string | null;
  onTaskRemoved?: () => void;
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
  isEditingRef,
  lastSavedHashRef,
  latestRowsRef,
  latestTaskRef,
  buildHash,
  prepareRowsFromRemote,
  getLiveTaskMeta,
  userKey,
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
    (remote: Task, fromLive = false) => {
      const newRows = prepareRowsFromRemote(remote);
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
      };

      if (isSavingRef.current) {
        pendingRemoteTaskRef.current = remote;
        return;
      }

      const localHash = buildHash(latestRowsRef.current);
      const isDirty = localHash !== lastSavedHashRef.current;
      const isEditing = isEditingRef?.current === true;

      if (isDirty && isEditing) {
        pendingRemoteTaskRef.current = remote;
        setRemoteUpdatePending(true);
        lastRemoteMeasureHashRef.current = liveHash;
        return;
      }

      applyRemote(remote, true);
    },
    [
      applyRemote,
      buildHash,
      isEditingRef,
      isSavingRef,
      lastSavedHashRef,
      latestRowsRef,
      latestTaskRef,
      selectedTask,
    ],
  );

  const applyPendingRemoteUpdate = useCallback(() => {
    const remote = pendingRemoteTaskRef.current;
    if (remote) applyRemote(remote, true);
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
    const isEditing = isEditingRef?.current === true;

    if (isDirty && isEditing) {
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
    isEditingRef,
    isSavingRef,
    lastSavedHashRef,
    latestRowsRef,
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
    const meta = getLiveTaskMeta(measureRows);
    scheduleTaskLivePublish({
      taskId: selectedId,
      userKey: key,
      measureData: measureRows as unknown[],
      currentBultos: meta.currentBultos,
      status: meta.status,
    });
  }, [measureRows, selectedId, userKey, buildHash, getLiveTaskMeta, lastSavedHashRef]);

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
