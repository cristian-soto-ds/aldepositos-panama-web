import type { Task } from "@/lib/types/task";
import type { RaPhoto, RaPhotoRecord } from "@/lib/types/raPhoto";

export function getTaskPhotos(task: Task | null | undefined): RaPhoto[] {
  return task?.photoRecord?.photos ?? [];
}

export function appendPhotoToTask(task: Task, photo: RaPhoto): Task {
  const existing = task.photoRecord?.photos ?? [];
  const photoRecord: RaPhotoRecord = {
    photos: [...existing, photo],
    lastUpdatedAt: new Date().toISOString(),
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
      photos,
      lastUpdatedAt: new Date().toISOString(),
    },
  };
}

export function removePhotoFromTask(task: Task, photoId: string): Task {
  const photos = (task.photoRecord?.photos ?? []).filter((p) => p.id !== photoId);
  return {
    ...task,
    photoRecord: {
      photos,
      lastUpdatedAt: new Date().toISOString(),
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
