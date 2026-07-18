import { createBrowserClient } from "@supabase/ssr";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import {
  isTaskPayload,
  parseTaskRealtimeChange,
  type DbPayloadRow,
  type TaskRealtimeChange,
} from "@/lib/realtimePatch";
import type { Task } from "@/lib/types/task";
import { toListTask } from "@/lib/taskListSlim";

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

export type FetchTasksOptions = {
  /**
   * true: payload completo (Despacho / Reportes).
   * false/omitido: sin measureData (lista del panel; detalle vía fetchTaskById).
   */
  includeMeasureData?: boolean;
};

/**
 * Lista de tasks. Por defecto sin `measureData` (estado del panel más barato).
 * Abrir un RA usa `fetchTaskById`; Despacho/Reportes piden `includeMeasureData`.
 */
export async function fetchTasks(
  options?: FetchTasksOptions,
): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, payload, updated_at")
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as { payload: unknown }[];
  const tasks = rows.map((r) => r.payload).filter(isTaskPayload);
  return options?.includeMeasureData ? tasks : tasks.map(toListTask);
}

/** Carga el payload completo de un RA (incluye measureData). */
export async function fetchTaskById(id: string): Promise<Task | null> {
  const row = await fetchTaskRow(id);
  return row?.task ?? null;
}

export type TaskRowMeta = {
  task: Task;
  /** Columna `updated_at` de la fila (versión para CAS). */
  updatedAt: string | null;
};

/** Payload + versión de fila (para merge concurrente con compare-and-swap). */
export async function fetchTaskRow(id: string): Promise<TaskRowMeta | null> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, payload, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data?.payload || !isTaskPayload(data.payload)) return null;
  const updatedAt =
    typeof data.updated_at === "string" && data.updated_at
      ? data.updated_at
      : typeof data.payload.updatedAt === "string"
        ? data.payload.updatedAt
        : null;
  return { task: data.payload, updatedAt };
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
 * Actualiza solo si `updated_at` sigue siendo el esperado.
 * Evita que un inventariador pise el guardado concurrente de otro (last-write-wins).
 */
export async function updateTaskIfMatch(
  task: Task,
  expectedUpdatedAt: string | null,
): Promise<"ok" | "conflict"> {
  const nextUpdatedAt = new Date().toISOString();
  const payload: Task = { ...task, updatedAt: nextUpdatedAt };
  let query = supabase
    .from("tasks")
    .update({
      payload,
      updated_at: nextUpdatedAt,
    })
    .eq("id", task.id);

  if (expectedUpdatedAt) {
    query = query.eq("updated_at", expectedUpdatedAt);
  }

  const { data, error } = await query.select("id").maybeSingle();
  if (error) throw error;
  if (!data?.id) return "conflict";
  return "ok";
}

/**
 * Elimina una tarea por id.
 */
export async function deleteTaskById(id: string): Promise<void> {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}

const REALTIME_DEBOUNCE_MS = 250;

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
          const canPatchLocally =
            change.eventType === "DELETE" || change.task != null;
          if (onChange && canPatchLocally) {
            return;
          }
          scheduleReload();
          return;
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
    });

  return () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    void supabase.removeChannel(channel);
  };
}
