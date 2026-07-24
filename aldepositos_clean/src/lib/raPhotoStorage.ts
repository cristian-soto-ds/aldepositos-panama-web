import { supabase } from "@/lib/supabase";
import type { RaPhoto, RaPhotoCategory } from "@/lib/types/raPhoto";

export const RA_PHOTOS_BUCKET = "ra-photos";

const MAX_SIDE_PX = 1920;
const JPEG_QUALITY = 0.85;

export type RaPhotoUploadMeta = {
  caption?: string;
  category?: RaPhotoCategory;
  takenByEmail?: string;
  takenByName?: string;
};

export type RaPhotoUploadResult =
  | { ok: true; photo: RaPhoto }
  | { ok: false; message: string };

function generatePhotoId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function raPhotoStoragePath(taskId: string, photoId: string): string {
  return `${taskId}/${photoId}.jpg`;
}

/** Reconstruye la ruta en Storage si falta en metadata (fotos antiguas). */
export function resolveRaPhotoStoragePath(
  photo: RaPhoto,
  taskId?: string,
): string {
  const direct = photo.storagePath?.trim();
  if (direct) return direct;

  const url = photo.url?.trim();
  if (url) {
    try {
      const parsed = new URL(url);
      const markers = [
        `/object/public/${RA_PHOTOS_BUCKET}/`,
        `/object/authenticated/${RA_PHOTOS_BUCKET}/`,
        `/object/sign/${RA_PHOTOS_BUCKET}/`,
      ];
      for (const marker of markers) {
        const idx = parsed.pathname.indexOf(marker);
        if (idx >= 0) {
          return decodeURIComponent(parsed.pathname.slice(idx + marker.length));
        }
      }
      const loose = parsed.pathname.match(
        new RegExp(`/${RA_PHOTOS_BUCKET}/(.+)$`),
      );
      if (loose?.[1]) return decodeURIComponent(loose[1]);
    } catch {
      /* ignore */
    }
  }

  if (taskId?.trim() && photo.id) {
    return raPhotoStoragePath(taskId.trim(), photo.id);
  }
  return "";
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(new Error("No se pudo leer el archivo"));
    r.readAsDataURL(file);
  });
}

/** Comprime imágenes grandes antes de subirlas a Storage. */
export async function compressImageForUpload(file: File): Promise<Blob> {
  const mime = (file.type || "image/jpeg").toLowerCase();
  if (!mime.startsWith("image/")) {
    throw new Error("El archivo debe ser una imagen.");
  }

  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return file;
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const w = bitmap.width;
    const h = bitmap.height;
    const longest = Math.max(w, h);
    if (longest <= MAX_SIDE_PX && file.size <= 2 * 1024 * 1024) {
      bitmap.close();
      return file;
    }

    const scale = longest > MAX_SIDE_PX ? MAX_SIDE_PX / longest : 1;
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, tw, th);
    bitmap.close();
    bitmap = null;

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY);
    });
    if (!blob) return file;
    return blob;
  } catch {
    if (bitmap) bitmap.close();
    return file;
  }
}

function classifyStorageError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("bucket not found") || (m.includes("not found") && m.includes("bucket"))) {
    return "Falta crear el bucket «ra-photos» en Supabase (migración 010).";
  }
  if (
    m.includes("row-level security") ||
    m.includes("rls") ||
    m.includes("policy") ||
    m.includes("permission denied")
  ) {
    return "Permiso denegado en Storage. Revisa las políticas del bucket ra-photos.";
  }
  return `No se pudo subir la imagen: ${raw}`;
}

export async function uploadRaPhoto(
  taskId: string,
  file: File,
  meta: RaPhotoUploadMeta = {},
): Promise<RaPhotoUploadResult> {
  if (!file.type.startsWith("image/")) {
    return { ok: false, message: "Solo se permiten archivos de imagen." };
  }

  const photoId = generatePhotoId();
  const path = raPhotoStoragePath(taskId, photoId);

  try {
    const blob = await compressImageForUpload(file);
    const { error: upErr } = await supabase.storage
      .from(RA_PHOTOS_BUCKET)
      .upload(path, blob, {
        upsert: true,
        contentType: "image/jpeg",
        cacheControl: "3600",
      });

    if (upErr) {
      return { ok: false, message: classifyStorageError(upErr.message) };
    }

    const { data: pub } = supabase.storage.from(RA_PHOTOS_BUCKET).getPublicUrl(path);
    const url = publicUrlFromStoragePath(path) || pub?.publicUrl?.trim();
    if (!url) {
      return { ok: false, message: "No se pudo obtener la URL pública de la foto." };
    }

    const photo: RaPhoto = {
      id: photoId,
      url,
      storagePath: path,
      caption: meta.caption?.trim() || undefined,
      category: meta.category,
      takenAt: new Date().toISOString(),
      takenByEmail: meta.takenByEmail,
      takenByName: meta.takenByName,
    };

    return { ok: true, photo };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido al subir.";
    return { ok: false, message: msg };
  }
}

export function publicUrlFromStoragePath(storagePath: string): string {
  const path = storagePath.trim();
  if (!path) return "";
  const { data } = supabase.storage.from(RA_PHOTOS_BUCKET).getPublicUrl(path);
  return data?.publicUrl?.trim() ?? "";
}

/** URL de visualización: reconstruye desde storagePath (URLs guardadas pueden quedar obsoletas). */
export function displayUrlForRaPhoto(photo: RaPhoto, taskId?: string): string {
  const path = resolveRaPhotoStoragePath(photo, taskId);
  if (path) {
    return publicUrlFromStoragePath(path);
  }
  return photo.url?.trim() ?? "";
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(blob);
  });
}

/** Descarga la foto con la sesión del panel (funciona aunque el bucket no sea público). */
export async function downloadRaPhotoBlob(
  photo: RaPhoto,
  taskId?: string,
): Promise<Blob | null> {
  const path = resolveRaPhotoStoragePath(photo, taskId);
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(RA_PHOTOS_BUCKET)
    .download(path);
  if (error || !data) return null;
  return data;
}

/** Blob URL para mostrar en `<img>` (revocar con URL.revokeObjectURL al desmontar). */
export async function createRaPhotoObjectUrl(
  photo: RaPhoto,
  taskId?: string,
): Promise<string> {
  const blob = await downloadRaPhotoBlob(photo, taskId);
  if (blob) return URL.createObjectURL(blob);
  return displayUrlForRaPhoto(photo);
}

/** Data URL para html2canvas (sin depender de CORS del bucket público). */
export async function fetchRaPhotoDataUrl(
  photo: RaPhoto,
  taskId?: string,
): Promise<string> {
  const blob = await downloadRaPhotoBlob(photo, taskId);
  if (blob) return blobToDataUrl(blob);
  const fallback = displayUrlForRaPhoto(photo);
  if (!fallback) throw new Error("No se pudo cargar la imagen de la foto.");
  const res = await fetch(fallback);
  if (!res.ok) throw new Error("No se pudo cargar la imagen de la foto.");
  return blobToDataUrl(await res.blob());
}

export type RaPhotoPdfAsset = {
  src: string;
  width: number;
  height: number;
};

function measureDataUrl(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (typeof Image === "undefined") {
      resolve({ width: 1200, height: 900 });
      return;
    }
    const img = new Image();
    img.onload = () =>
      resolve({
        width: img.naturalWidth || 1,
        height: img.naturalHeight || 1,
      });
    img.onerror = () => reject(new Error("No se pudo medir la imagen"));
    img.src = src;
  });
}

export async function preloadRaPhotoDataUrls(
  photos: RaPhoto[],
  taskId?: string,
): Promise<Record<string, string>> {
  const assets = await preloadRaPhotoPdfAssets(photos, taskId);
  return Object.fromEntries(
    Object.entries(assets).map(([id, asset]) => [id, asset.src]),
  );
}

/** Precarga data URLs y dimensiones naturales para el PDF. */
export async function preloadRaPhotoPdfAssets(
  photos: RaPhoto[],
  taskId?: string,
): Promise<Record<string, RaPhotoPdfAsset>> {
  const out: Record<string, RaPhotoPdfAsset> = {};
  await Promise.all(
    photos.map(async (p) => {
      let src = "";
      try {
        src = await fetchRaPhotoDataUrl(p, taskId);
      } catch {
        src = displayUrlForRaPhoto(p, taskId);
      }
      try {
        const { width, height } = await measureDataUrl(src);
        out[p.id] = { src, width, height };
      } catch {
        out[p.id] = { src, width: 4, height: 3 };
      }
    }),
  );
  return out;
}

export async function deleteRaPhotoFromStorage(
  storagePath: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.storage.from(RA_PHOTOS_BUCKET).remove([storagePath]);
  if (error) {
    return { ok: false, message: classifyStorageError(error.message) };
  }
  return { ok: true };
}

/** Convierte un data URL de captura de cámara en File para reutilizar uploadRaPhoto. */
export async function dataUrlToJpegFile(dataUrl: string, filename: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || "image/jpeg" });
}

export async function fileToPreviewDataUrl(file: File): Promise<string> {
  return readFileAsDataUrl(file);
}
