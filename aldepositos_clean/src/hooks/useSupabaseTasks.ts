"use client";

import { useCallback, useEffect, useState } from "react";
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
import type { Task } from "@/lib/types/task";

type UseSupabaseTasksOptions = {
  /** Si es false no se cargan datos ni se escucha Realtime (p. ej. sin sesión). */
  enabled: boolean;
  /** Email del usuario actual (para ignorar sus propios broadcasts). */
  userKey?: string | null;
};

/**
 * Estado de tareas sincronizado con `public.tasks`:
 * - carga inicial al habilitar
 * - parche inmediato vía Supabase Realtime
 * - parche en vivo vía Broadcast (~80 ms) mientras otros escriben
 * - recarga completa debounced como respaldo
 */
export function useSupabaseTasks({ enabled, userKey }: UseSupabaseTasksOptions) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);

  const reloadTasks = useCallback(async () => {
    try {
      const list = await fetchTasks();
      setTasks((prev) => {
        const prevJson = JSON.stringify(prev);
        const nextJson = JSON.stringify(list);
        return prevJson === nextJson ? prev : list;
      });
    } catch (e) {
      console.error(e);
      // eslint-disable-next-line no-alert
      alert(
        "No se pudieron cargar las órdenes desde Supabase. Revisa la tabla `tasks` y las políticas RLS.",
      );
    } finally {
      setTasksLoading(false);
    }
  }, []);

  const applyRealtimeChange = useCallback((change: TaskRealtimeChange) => {
    setTasks((prev) => {
      const patched = patchTasksList(prev, change);
      return patched ?? prev;
    });
  }, []);

  const applyLiveTaskUpdate = useCallback(
    (update: {
      taskId: string;
      measureData: unknown[];
      currentBultos: number;
      status: string;
    }) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === update.taskId
            ? {
                ...t,
                measureData: update.measureData,
                currentBultos: update.currentBultos,
                status: update.status,
              }
            : t,
        ),
      );
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
      onReload: reloadTasks,
    });
  }, [enabled, reloadTasks, applyRealtimeChange]);

  useEffect(() => {
    if (!enabled) return;
    const tabId = getSharedWorkPresenceTabId();
    return subscribeLiveUpdates((update) => {
      if (update.type !== "task") return;
      if (!isForeignLiveUpdate(update, tabId)) return;
      applyLiveTaskUpdate(update);
    });
  }, [enabled, userKey, applyLiveTaskUpdate]);

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
