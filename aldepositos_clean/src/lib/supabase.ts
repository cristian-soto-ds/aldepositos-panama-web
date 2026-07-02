import { createBrowserClient } from "@supabase/ssr";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import {
  isTaskPayload,
  parseTaskRealtimeChange,
  type DbPayloadRow,
  type TaskRealtimeChange,
} from "@/lib/realtimePatch";
import type { Task } from "@/lib/types/task";

export type { TaskRealtimeChange };

/**
 * Valores por defecto tipo Supabase local: evitan que `createBrowserClient` reciba
 * `undefined` al importar el módulo (p. ej. build sin .env), que puede tumbar el servidor.
 * En runtime real debes definir NEXT_PUBLIC_SUPABASE_* en `.env.local`.
 */
const BROWSER_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const BROWSER_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

/** Cliente navegador con sesión en cookies (compatible con middleware SSR). */
export const supabase = createBrowserClient(
  BROWSER_SUPABASE_URL,
  BROWSER_SUPABASE_ANON_KEY,
);

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
  return rows.map((r) => r.payload).filter(isTaskPayload);
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

const REALTIME_DEBOUNCE_MS = 50;

type TasksRealtimeHandlers = {
  /** Parche inmediato con el payload del evento (sin esperar refetch). */
  onChange?: (change: TaskRealtimeChange) => void;
  /** Recarga completa debounced como respaldo. */
  onReload?: () => void;
};

/**
 * Suscripción a cambios en `public.tasks` (INSERT, UPDATE, DELETE).
 * Emite parche inmediato y, opcionalmente, recarga completa debounced.
 */
export function subscribeTasksRealtime(
  handlers: TasksRealtimeHandlers | (() => void),
): () => void {
  const { onChange, onReload } =
    typeof handlers === "function"
      ? { onChange: undefined, onReload: handlers }
      : handlers;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReload = () => {
    if (!onReload) return;
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
      (payload: RealtimePostgresChangesPayload<DbPayloadRow>) => {
        const change = parseTaskRealtimeChange(payload);
        if (change) {
          onChange?.(change);
          if (!change.task && change.eventType !== "DELETE") {
            scheduleReload();
            return;
          }
        }
        scheduleReload();
      },
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR") {
        console.warn(
          "[Supabase Realtime] Error en el canal de `tasks`. ¿Está la tabla en la publicación y RLS permite leer?",
        );
        scheduleReload();
      }
      if (status === "SUBSCRIBED") {
        scheduleReload();
      }
    });

  return () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    void supabase.removeChannel(channel);
  };
}
