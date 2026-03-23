import { createClient } from "@supabase/supabase-js";
import type { Task } from "@/lib/types/task";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

function isTask(value: unknown): value is Task {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "ra" in value
  );
}

/**
 * Lee todas las filas de public.tasks y devuelve los Task del JSON payload.
 */
export async function fetchTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as { payload: unknown }[];
  return rows.map((r) => r.payload).filter(isTask);
}

/**
 * Crea una fila nueva (RA nuevo).
 */
export async function insertTask(task: Task): Promise<void> {
  const { error } = await supabase.from("tasks").insert({
    id: task.id,
    payload: task,
  });
  if (error) throw error;
}

/**
 * Inserta varias tareas en un solo request (importación Excel).
 */
export async function insertTasks(tasks: Task[]): Promise<void> {
  if (tasks.length === 0) return;
  const rows = tasks.map((task) => ({
    id: task.id,
    payload: task,
  }));
  const { error } = await supabase.from("tasks").insert(rows);
  if (error) throw error;
}

/**
 * Actualiza el payload de una tarea existente.
 */
export async function updateTask(task: Task): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({
      payload: task,
      updated_at: new Date().toISOString(),
    })
    .eq("id", task.id);
  if (error) throw error;
}

/**
 * Elimina una tarea por id.
 */
export async function deleteTaskById(id: string): Promise<void> {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}

const REALTIME_DEBOUNCE_MS = 200;

/**
 * Suscripción a cambios en `public.tasks` (INSERT, UPDATE, DELETE).
 * Debounce evita múltiples `fetchTasks` seguidos (p. ej. importación masiva).
 */
export function subscribeTasksRealtime(onReload: () => void): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReload = () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      onReload();
    }, REALTIME_DEBOUNCE_MS);
  };

  const channel = supabase
    .channel("public-tasks-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tasks" },
      () => {
        scheduleReload();
      },
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR") {
        console.warn(
          "[Supabase Realtime] Error en el canal de `tasks`. ¿Está la tabla en la publicación y RLS permite leer?",
        );
      }
    });

  return () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    void supabase.removeChannel(channel);
  };
}
