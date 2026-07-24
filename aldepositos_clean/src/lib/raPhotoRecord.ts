import type { Task } from "@/lib/types/task";
import type { RaPhoto, RaPhotoRecord } from "@/lib/types/raPhoto";
import { resolveInventariadorId } from "@/lib/inventariadoresRoster";

export function getTaskPhotos(task: Task | null | undefined): RaPhoto[] {
  return task?.photoRecord?.photos ?? [];
}

export function taskHasPhotos(task: Task | null | undefined): boolean {
  return getTaskPhotos(task).length > 0;
}

export function isPhotoRegistrationRequested(
  task: Task | null | undefined,
): boolean {
  return Boolean(task?.photoRecord?.requested);
}

export function setPhotoRegistrationRequested(
  task: Task,
  requested: boolean,
): Task {
  const photos = task.photoRecord?.photos ?? [];
  const photoRecord: RaPhotoRecord = {
    ...task.photoRecord,
    photos,
    requested,
    lastUpdatedAt: new Date().toISOString(),
  };
  return { ...task, photoRecord };
}

export function appendPhotoToTask(task: Task, photo: RaPhoto): Task {
  const existing = task.photoRecord?.photos ?? [];
  const at = photo.takenAt || new Date().toISOString();
  const lastTakenBy =
    photo.takenByEmail || photo.takenByName
      ? {
          email: String(photo.takenByEmail ?? "").trim().toLowerCase(),
          displayName: photo.takenByName?.trim() || undefined,
          at,
        }
      : task.photoRecord?.lastTakenBy;

  const photoRecord: RaPhotoRecord = {
    ...task.photoRecord,
    photos: [...existing, photo],
    lastUpdatedAt: at,
    // Mantener en cola hasta que PC lo quite (permite varios ángulos / visitas)
    requested: task.photoRecord?.requested ?? false,
    lastTakenBy,
  };
  return { ...task, photoRecord };
}

export function updatePhotoInTask(
  task: Task,
  photoId: string,
  patch: Partial<Pick<RaPhoto, "caption" | "category">>,
): Task {
  const photos = (task.photoRecord?.photos ?? []).map((p) =>
    p.id === photoId ? { ...p, ...patch } : p,
  );
  return {
    ...task,
    photoRecord: {
      ...task.photoRecord,
      photos,
      lastUpdatedAt: new Date().toISOString(),
    },
  };
}

export function removePhotoFromTask(task: Task, photoId: string): Task {
  const photos = (task.photoRecord?.photos ?? []).filter((p) => p.id !== photoId);
  const last = [...photos].reverse().find((p) => p.takenByEmail || p.takenByName);
  const lastTakenBy = last
    ? {
        email: String(last.takenByEmail ?? "").trim().toLowerCase(),
        displayName: last.takenByName?.trim() || undefined,
        at: last.takenAt,
      }
    : undefined;

  return {
    ...task,
    photoRecord: {
      ...task.photoRecord,
      photos,
      lastUpdatedAt: new Date().toISOString(),
      lastTakenBy,
      requested:
        photos.length === 0 ? task.photoRecord?.requested : task.photoRecord?.requested,
    },
  };
}

export function buildPhotoRecordPdfFilename(ra: string): string {
  const safe = String(ra ?? "RA")
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-");
  const date = new Date().toISOString().slice(0, 10);
  return `RA-${safe}-fotos-${date}.pdf`;
}

/** Etiqueta de quién registró fotos (último o únicos fotógrafos). */
export function photoRecordTakenByLabel(task: Task): string {
  const last = task.photoRecord?.lastTakenBy;
  if (last?.displayName?.trim()) return last.displayName.trim();
  if (last?.email?.trim()) return last.email.trim();

  const names = new Set<string>();
  for (const p of getTaskPhotos(task)) {
    const label = (p.takenByName || p.takenByEmail || "").trim();
    if (label) names.add(label);
  }
  if (names.size === 0) return "Sin atribuir";
  return [...names].join(", ");
}

export function taskHasPhotoAttribution(task: Task): boolean {
  if (task.photoRecord?.lastTakenBy?.email || task.photoRecord?.lastTakenBy?.displayName) {
    return true;
  }
  return getTaskPhotos(task).some((p) => p.takenByEmail || p.takenByName);
}

export function taskMatchesPhotoEmployee(
  task: Task,
  employeeId: "Todos" | "sin-atribuir" | string,
): boolean {
  if (employeeId === "Todos") return true;
  if (employeeId === "sin-atribuir") return !taskHasPhotoAttribution(task);

  const lastId = resolveInventariadorId(
    task.photoRecord?.lastTakenBy?.displayName,
    task.photoRecord?.lastTakenBy?.email,
  );
  if (lastId === employeeId) return true;

  return getTaskPhotos(task).some(
    (p) => resolveInventariadorId(p.takenByName, p.takenByEmail) === employeeId,
  );
}

export function photoRecordActivityDate(task: Task): Date | null {
  const iso =
    task.photoRecord?.lastUpdatedAt ||
    task.photoRecord?.lastTakenBy?.at ||
    getTaskPhotos(task).at(-1)?.takenAt;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
