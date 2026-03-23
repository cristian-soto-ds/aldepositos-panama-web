"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchTasks, subscribeTasksRealtime } from "@/lib/supabase";
import type { Task } from "@/lib/types/task";

type UseSupabaseTasksOptions = {
  /** Si es false no se cargan datos ni se escucha Realtime (p. ej. sin sesión). */
  enabled: boolean;
};

/**
 * Estado de tareas sincronizado con `public.tasks`:
 * - carga inicial al habilitar
 * - recarga automática vía Supabase Realtime (INSERT / UPDATE / DELETE)
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

  useEffect(() => {
    if (!enabled) return;
    void reloadTasks();
  }, [enabled, reloadTasks]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeTasksRealtime(() => {
      void reloadTasks();
    });
  }, [enabled, reloadTasks]);

  return { tasks, setTasks, reloadTasks, tasksLoading };
}
