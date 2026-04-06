import { supabase } from "@/lib/supabase";
import { updatePerfilByUserId } from "@/lib/perfiles";

const BUCKET = "avatars";

function objectPath(userId: string): string {
  return `${userId}/avatar`;
}

export type AvatarUploadResult =
  | { ok: true; publicUrl: string }
  | { ok: false; message: string };

/**
 * Sube imagen a Storage y guarda la URL pública en `perfiles.avatar_url`.
 */
export async function uploadUserAvatar(
  userId: string,
  file: File,
): Promise<AvatarUploadResult> {
  if (!file.type.startsWith("image/")) {
    return { ok: false, message: "Selecciona un archivo de imagen." };
  }
  if (file.size > 2_500_000) {
    return { ok: false, message: "La imagen debe pesar menos de 2.5 MB." };
  }

  const path = objectPath(userId);
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      upsert: true,
      cacheControl: "3600",
      contentType: file.type || "image/jpeg",
    });

  if (upErr) {
    console.warn("[avatar] upload:", upErr.message);
    return {
      ok: false,
      message:
        upErr.message.includes("Bucket not found") || upErr.message.includes("not found")
          ? "Falta crear el bucket «avatars» en Supabase (ver migración 004)."
          : "No se pudo subir la imagen. Revisa permisos de Storage.",
    };
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = pub.publicUrl;
  const busted = `${publicUrl}?t=${Date.now()}`;

  const dbRes = await updatePerfilByUserId(userId, { avatar_url: busted });
  if (!dbRes.ok) {
    console.warn("[avatar] profile update:", dbRes.message);
    return {
      ok: false,
      message:
        "Imagen subida pero no se guardó el perfil. Revisa RLS en public.perfiles y la columna avatar_url.",
    };
  }

  return { ok: true, publicUrl: busted };
}

export async function removeUserAvatar(
  userId: string,
): Promise<AvatarUploadResult> {
  const path = objectPath(userId);
  const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path]);
  if (rmErr) {
    console.warn("[avatar] remove:", rmErr.message);
  }

  const dbRes = await updatePerfilByUserId(userId, { avatar_url: null });
  if (!dbRes.ok) {
    return {
      ok: false,
      message: dbRes.message || "No se pudo quitar la foto del perfil.",
    };
  }
  return { ok: true, publicUrl: "" };
}

export function isPublicAvatarUrl(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  const t = value.trim();
  return t.startsWith("http://") || t.startsWith("https://");
}
