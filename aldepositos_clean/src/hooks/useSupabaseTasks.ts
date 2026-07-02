"use client";

import { useCallback, useEffect, useState } from "react";
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
};

/**
 * Estado de tareas sincronizado con `public.tasks`:
 * - carga inicial al habilitar
 * - parche inmediato vía Supabase Realtime
 * - recarga completa debounced como respaldo
 * - refetch al volver a la pestaña
 */
export function useSupabaseTasks({ enabled }: UseSupabaseTasksOptions) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);

  const reloadTasks = useCallback(async () => {
    try {
      const list = await fetchTasks();
      setTasks(list);
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
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void reloadTasks();
      }
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
