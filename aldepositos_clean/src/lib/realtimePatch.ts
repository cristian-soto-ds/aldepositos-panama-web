import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { Task } from "@/lib/types/task";

export type DbPayloadRow = {
  id: string;
  payload: unknown;
  updated_at?: string;
};

export function isTaskPayload(value: unknown): value is Task {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "ra" in value
  );
}

export function taskFromDbRow(row: DbPayloadRow | null | undefined): Task | null {
  if (!row?.id) return null;
  if (!isTaskPayload(row.payload)) return null;
  if (row.payload.id !== row.id) {
    return { ...row.payload, id: row.id };
  }
  return row.payload;
}

export type TaskRealtimeChange = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  task: Task | null;
};

export function parseTaskRealtimeChange(
  payload: RealtimePostgresChangesPayload<DbPayloadRow>,
): TaskRealtimeChange | null {
  const eventType = payload.eventType;
  if (eventType === "DELETE") {
    const id = payload.old?.id;
    if (!id) return null;
    return { eventType, id, task: null };
  }
  const row = payload.new;
  if (!row?.id) return null;
  return {
    eventType,
    id: row.id,
    task: taskFromDbRow(row),
  };
}

export function patchTasksList(
  prev: Task[],
  change: TaskRealtimeChange,
): Task[] | null {
  if (change.eventType === "DELETE") {
    return prev.filter((t) => t.id !== change.id);
  }
  if (!change.task) return null;
  const exists = prev.some((t) => t.id === change.id);
  if (change.eventType === "INSERT" && !exists) {
    return [change.task, ...prev];
  }
  if (exists) {
    return prev.map((t) => (t.id === change.id ? change.task! : t));
  }
  return [change.task, ...prev];
}
