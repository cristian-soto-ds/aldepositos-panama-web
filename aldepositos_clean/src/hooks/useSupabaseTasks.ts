"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSharedWorkPresenceTabId } from "@/lib/panelPresence";
import {
  isForeignLiveUpdate,
  subscribeLiveUpdates,
} from "@/lib/liveCollaboration";
import {
  fetchTasks,
  subscribeTasksRealtime,
  type TaskRealtimeChange,
} from "@/lib/supabase";
import { patchTasksList } from "@/lib/realtimePatch";
import {
  measureDataLooksEmpty,
  mergeSlimTasksPreservingDetail,
  tasksListFingerprint,
  toListTask,
} from "@/lib/taskListSlim";
import type { Task } from "@/lib/types/task";

type UseSupabaseTasksOptions = {
  /** Si es false no se cargan datos ni se escucha Realtime (p. ej. sin sesión). */
  enabled: boolean;
  /** Email del usuario actual (para ignorar sus propios broadcasts). */
  userKey?: string | null;
};

/**
 * Estado de tareas sincronizado con `public.tasks`:
 * - lista slim (sin measureData) + detalle hidratado al abrir RA
 * - parche inmediato vía Supabase Realtime
 * - live collab solo actualiza meta de lista (filas completa solo en el editor abierto)
 * - recarga completa debounced como respaldo
 */
export function useSupabaseTasks({ enabled, userKey }: UseSupabaseTasksOptions) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  /** Reportes/despacho necesitan filas; no volver a slim en focus/realtime. */
  const includeMeasureDataRef = useRef(false);

  const reloadTasks = useCallback(
    async (options?: { includeMeasureData?: boolean }) => {
      if (options?.includeMeasureData !== undefined) {
        includeMeasureDataRef.current = options.includeMeasureData;
      }
      const include = includeMeasureDataRef.current;
      try {
        const list = await fetchTasks({ includeMeasureData: include });
        setTasks((prev) => {
          if (include) {
            // Fingerprint no mira measureData: hay que aplicar el payload completo siempre.
            return list;
          }
          const merged = mergeSlimTasksPreservingDetail(prev, list);
          return tasksListFingerprint(prev) === tasksListFingerprint(merged)
            ? prev
            : merged;
        });
      } catch (e) {
        console.error(e);
        // No alertar en cada fallo: con rate-limit / cuota de Realtime o red
        // intermitente el alert bloquea la captura multi-usuario.
        setTasksLoading(false);
      } finally {
        setTasksLoading(false);
      }
    },
    [],
  );

  const applyRealtimeChange = useCallback((change: TaskRealtimeChange) => {
    setTasks((prev) => {
      let nextChange = change;
      if (change.task) {
        const existing = prev.find((t) => t.id === change.id);
        const incoming = change.task;
        const keepFull = includeMeasureDataRef.current;

        if (
          existing &&
          !measureDataLooksEmpty(existing.measureData) &&
          measureDataLooksEmpty(incoming.measureData)
        ) {
          nextChange = {
            ...change,
            task: { ...toListTask(incoming), measureData: existing.measureData },
          };
        } else if (keepFull || !measureDataLooksEmpty(incoming.measureData)) {
          // Módulo que necesita filas, o el UPDATE ya trae measureData.
          nextChange = { ...change, task: incoming };
        } else {
          nextChange = { ...change, task: toListTask(incoming) };
        }
      }
      const patched = patchTasksList(prev, nextChange);
      return patched ?? prev;
    });
  }, []);

  /** Meta de lista: no inyecta measureData completo en el array global. */
  const applyLiveTaskMeta = useCallback(
    (update: {
      taskId: string;
      currentBultos: number;
      status: string;
      capturedWeight?: number;
      rowCount?: number;
      completeRowCount?: number;
    }) => {
      setTasks((prev) => {
        let changed = false;
        const next = prev.map((t) => {
          if (t.id !== update.taskId) return t;
          const nextWeight =
            typeof update.capturedWeight === "number"
              ? update.capturedWeight
              : t.capturedWeight;
          const nextRowCount =
            typeof update.rowCount === "number" ? update.rowCount : t.rowCount;
          const nextComplete =
            typeof update.completeRowCount === "number"
              ? update.completeRowCount
              : t.completeRowCount;
          if (
            t.currentBultos === update.currentBultos &&
            t.status === update.status &&
            t.capturedWeight === nextWeight &&
            t.rowCount === nextRowCount &&
            t.completeRowCount === nextComplete
          ) {
            return t;
          }
          changed = true;
          return {
            ...t,
            currentBultos: update.currentBultos,
            status: update.status,
            capturedWeight: nextWeight,
            rowCount: nextRowCount,
            completeRowCount: nextComplete,
            updatedAt: new Date().toISOString(),
          };
        });
        return changed ? next : prev;
      });
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    void reloadTasks();
  }, [enabled, reloadTasks]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeTasksRealtime({
      onChange: applyRealtimeChange,
      onReload: () => {
        void reloadTasks();
      },
    });
  }, [enabled, reloadTasks, applyRealtimeChange]);

  useEffect(() => {
    if (!enabled) return;
    const tabId = getSharedWorkPresenceTabId();
    return subscribeLiveUpdates((update) => {
      if (update.type !== "task") return;
      if (!isForeignLiveUpdate(update, tabId)) return;
      applyLiveTaskMeta(update);
    });
  }, [enabled, userKey, applyLiveTaskMeta]);

  useEffect(() => {
    if (!enabled) return;
    const lastFocusReloadRef = { current: 0 };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastFocusReloadRef.current < 30_000) return;
      lastFocusReloadRef.current = now;
      void reloadTasks();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [enabled, reloadTasks]);

  return { tasks, setTasks, reloadTasks, tasksLoading };
}
