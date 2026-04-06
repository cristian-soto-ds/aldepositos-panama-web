import { supabase } from "@/lib/supabase";
import { updatePerfilByUserId } from "@/lib/perfiles";

/** Debe coincidir con el bucket en Supabase (migración 004). */
const BUCKET = "avatars";

/** Objeto por usuario: primera carpeta del path = auth.uid() (RLS en storage.objects). */
const AVATAR_OBJECT_KEY = "avatar";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const AVATAR_DEBUG = process.env.NODE_ENV === "development";

function logAvatarDebug(step: string, payload: Record<string, unknown>) {
  if (!AVATAR_DEBUG) return;
  console.info("[avatar-debug]", step, payload);
}

/**
 * Ruta en Storage: `{userId}/avatar` (sin subcarpetas; primer segmento = UUID de sesión).
 */
export function avatarStoragePath(userId: string): string {
  return `${userId}/${AVATAR_OBJECT_KEY}`;
}

export type AvatarUploadResult =
  | { ok: true; publicUrl: string }
  | { ok: false; message: string };

function classifyStorageError(raw: string): string {
  const m = raw.toLowerCase();
  if (
    m.includes("bucket not found") ||
    (m.includes("not found") && m.includes("bucket"))
  ) {
    return "Falta crear el bucket «avatars» en Supabase (migración 004).";
  }
  if (
    m.includes("row-level security") ||
    m.includes("rls") ||
    m.includes("policy") ||
    m.includes("permission denied") ||
    m.includes("403")
  ) {
    return (
      "Permiso denegado en Storage (RLS): la ruta debe ser «tu_uuid/avatar» y el usuario autenticado debe ser ese UUID. Revisa políticas del bucket avatars."
    );
  }
  if (
    m.includes("jwt") ||
    m.includes("invalid token") ||
    m.includes("not authenticated") ||
    m.includes("unauthorized")
  ) {
    return "Sesión inválida o expirada. Cierra sesión y vuelve a entrar.";
  }
  return `No se pudo subir la imagen: ${raw}`;
}

function classifyDbError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("row-level security") || m.includes("rls") || m.includes("policy")) {
    return (
      "La imagen se subió bien (el JPG está OK); la base rechazó guardar avatar_url por RLS. " +
      "En Supabase → SQL Editor ejecuta la migración 006_perfiles_update_avatar_rls_fix.sql " +
      "(o permite UPDATE en tu fila de perfiles para el usuario autenticado)."
    );
  }
  return raw;
}

/**
 * Sube con la anon key del cliente (sin service_role) y guarda la URL en perfiles o profiles.
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

  const idTrim = String(userId ?? "").trim();
  if (!UUID_RE.test(idTrim)) {
    return {
      ok: false,
      message:
        "Identificador de usuario inválido para Storage (se espera el UUID de Supabase Auth).",
    };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    logAvatarDebug("auth", { error: "no_session" });
    return {
      ok: false,
      message: "No hay sesión activa. Inicia sesión e inténtalo de nuevo.",
    };
  }
  if (session.user.id !== idTrim) {
    logAvatarDebug("auth", {
      error: "user_mismatch",
      sessionId: session.user.id,
      passedId: idTrim,
    });
    return {
      ok: false,
      message:
        "El usuario de la sesión no coincide con el perfil. Recarga el panel e inténtalo de nuevo.",
    };
  }

  const path = avatarStoragePath(idTrim);
  logAvatarDebug("upload_start", {
    userId: idTrim,
    bucket: BUCKET,
    path,
    fileSize: file.size,
    fileType: file.type,
  });

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      upsert: true,
      cacheControl: "3600",
      contentType: file.type || "image/jpeg",
    });

  if (upErr) {
    logAvatarDebug("upload_error", { message: upErr.message, path });
    console.warn("[avatar] upload:", upErr.message);
    return { ok: false, message: classifyStorageError(upErr.message) };
  }

  logAvatarDebug("upload_ok", { path });

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = pub.publicUrl;
  const busted = `${publicUrl}?t=${Date.now()}`;

  logAvatarDebug("public_url", { publicUrl, busted });

  const dbRes = await updatePerfilByUserId(idTrim, { avatar_url: busted });
  if (!dbRes.ok) {
    logAvatarDebug("db_update_fail", { message: dbRes.message });
    console.warn("[avatar] profile update:", dbRes.message);
    return {
      ok: false,
      message: classifyDbError(dbRes.message),
    };
  }

  logAvatarDebug("db_update_ok", { table: dbRes.table, avatar_url: busted });

  return { ok: true, publicUrl: busted };
}

export async function removeUserAvatar(
  userId: string,
): Promise<AvatarUploadResult> {
  const idTrim = String(userId ?? "").trim();
  if (!UUID_RE.test(idTrim)) {
    return {
      ok: false,
      message: "Identificador de usuario inválido.",
    };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id || session.user.id !== idTrim) {
    return {
      ok: false,
      message: "Sesión inválida o usuario no coincide con el perfil.",
    };
  }

  const path = avatarStoragePath(idTrim);
  logAvatarDebug("remove", { path });

  const { error: rmErr } = await supabase.storage.from(BUCKET).remove([path]);
  if (rmErr) {
    console.warn("[avatar] remove:", rmErr.message);
  }

  const dbRes = await updatePerfilByUserId(idTrim, { avatar_url: null });
  if (!dbRes.ok) {
    return {
      ok: false,
      message: dbRes.message || "No se pudo quitar la foto del perfil.",
    };
  }

  logAvatarDebug("remove_db_ok", { table: dbRes.table });
  return { ok: true, publicUrl: "" };
}

export function isPublicAvatarUrl(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  const t = value.trim();
  return t.startsWith("http://") || t.startsWith("https://");
}
