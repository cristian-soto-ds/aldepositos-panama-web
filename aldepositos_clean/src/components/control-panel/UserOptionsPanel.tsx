"use client";

import React, { useRef, useState } from "react";
import { Clock3, Loader2, Moon, Sun, Upload, UserRound, X } from "lucide-react";
import type { UserPreferences } from "@/lib/userPreferences";
import { removeUserAvatar, uploadUserAvatar } from "@/lib/profileAvatar";

type UserOptionsPanelProps = {
  userId: string | null;
  /** `nombre_completo` (sin correo). */
  userDisplayName: string | null;
  /** URL para previsualizar (servidor + preferencias). */
  avatarPreviewSrc: string | null;
  preferences: UserPreferences;
  onChangePreferences: (next: UserPreferences) => void;
  /** Tras subir/quitar foto en Supabase, actualiza la URL en el panel padre. */
  onServerAvatarChange: (url: string | null) => void;
};

function themeOptionClass(active: boolean) {
  return active
    ? "border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-500/25 dark:border-blue-400/70 dark:bg-blue-950/50 dark:ring-blue-400/20"
    : "border-slate-200 bg-[var(--panel-surface)] hover:bg-slate-50 dark:border-slate-600/80 dark:bg-[var(--panel-surface-muted)] dark:hover:bg-slate-800/80";
}

export function UserOptionsPanel({
  userId,
  userDisplayName,
  avatarPreviewSrc,
  preferences,
  onChangePreferences,
  onServerAvatarChange,
}: UserOptionsPanelProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const handleTheme = (theme: UserPreferences["theme"]) => {
    onChangePreferences({ ...preferences, theme });
  };

  const onPickImage: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!userId) {
      setUploadError("Sesión no lista. Vuelve a entrar al panel.");
      return;
    }
    setUploadError(null);
    setAvatarBusy(true);
    const result = await uploadUserAvatar(userId, file);
    setAvatarBusy(false);
    if (!result.ok) {
      setUploadError(result.message);
      return;
    }
    onChangePreferences({
      ...preferences,
      avatarDataUrl: result.publicUrl,
    });
    onServerAvatarChange(result.publicUrl);
  };

  const onRemoveAvatar = async () => {
    if (!userId) return;
    setUploadError(null);
    setAvatarBusy(true);
    const result = await removeUserAvatar(userId);
    setAvatarBusy(false);
    if (!result.ok) {
      setUploadError(result.message);
      return;
    }
    onChangePreferences({ ...preferences, avatarDataUrl: null });
    onServerAvatarChange(null);
  };

  const showAvatar =
    (avatarPreviewSrc && avatarPreviewSrc.trim()) ||
    (preferences.avatarDataUrl && preferences.avatarDataUrl.trim()) ||
    null;
  const canRemove = Boolean(showAvatar?.trim());

  return (
    <div className="animate-fade mx-auto w-full max-w-4xl space-y-5 pb-10 md:space-y-6">
      <div className="panel-card rounded-[2rem] p-6 shadow-sm md:p-8">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          Opciones de usuario
        </p>
        <h2 className="mt-1 text-2xl font-black text-[#16263F] dark:text-slate-100 md:text-3xl">
          Personalización
        </h2>
        <p className="mt-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
          Tema y hora son solo en tu dispositivo. La foto de perfil se guarda en la nube y
          la ven otros operadores en presencia en vivo.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
        <div className="panel-card rounded-[2rem] p-5 md:p-6">
          <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-[#16263F] dark:text-slate-100">
            Tema
          </h3>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => handleTheme("light")}
              className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 transition ${themeOptionClass(preferences.theme === "light")}`}
            >
              <span className="flex items-center gap-2 text-sm font-bold text-[#16263F] dark:text-slate-100">
                <Sun className="h-4 w-4 text-amber-500" /> Claro
              </span>
              {preferences.theme === "light" && (
                <span className="text-[10px] font-black uppercase text-blue-700 dark:text-blue-300">
                  Activo
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => handleTheme("dark")}
              className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 transition ${themeOptionClass(preferences.theme === "dark")}`}
            >
              <span className="flex items-center gap-2 text-sm font-bold text-[#16263F] dark:text-slate-100">
                <Moon className="h-4 w-4 text-indigo-400" /> Oscuro
              </span>
              {preferences.theme === "dark" && (
                <span className="text-[10px] font-black uppercase text-blue-700 dark:text-blue-300">
                  Activo
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="panel-card rounded-[2rem] p-5 md:p-6">
          <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-[#16263F] dark:text-slate-100">
            Foto de perfil
          </h3>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-800/80">
              {showAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={showAvatar}
                  alt="Avatar de usuario"
                  className="h-full w-full object-cover"
                />
              ) : (
                <UserRound className="h-7 w-7 text-slate-400 dark:text-slate-500" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-[#16263F] dark:text-slate-100">
                {userDisplayName || "Operador"}
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onPickImage}
              className="hidden"
              disabled={avatarBusy}
            />
            <button
              type="button"
              disabled={avatarBusy || !userId}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#16263F] px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-[#0f1b2e] disabled:opacity-50 dark:shadow-md dark:shadow-black/30"
            >
              {avatarBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {canRemove ? "Actualizar foto" : "Subir foto"}
            </button>
            {canRemove && (
              <button
                type="button"
                disabled={avatarBusy || !userId}
                onClick={() => void onRemoveAvatar()}
                className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <X className="h-4 w-4" /> Quitar foto
              </button>
            )}
          </div>
          {uploadError && (
            <p className="mt-3 text-xs font-semibold text-red-600 dark:text-red-400">{uploadError}</p>
          )}
          <p className="mt-3 text-[11px] font-medium leading-relaxed text-slate-500 dark:text-slate-400">
            Se guarda en tu perfil (Supabase). Puedes cambiarla cuando quieras. Máx. 2,5 MB.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
        <div className="panel-card rounded-[2rem] p-5 md:p-6">
          <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-[#16263F] dark:text-slate-100">
            Vista inicial
          </h3>
          <select
            value={preferences.startView}
            onChange={(e) =>
              onChangePreferences({
                ...preferences,
                startView: e.target.value as UserPreferences["startView"],
              })
            }
            className="panel-input w-full rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-blue-500"
          >
            <option value="dashboard">Panel principal</option>
            <option value="quick-entry">Ingreso rápido</option>
            <option value="reports">Reportes</option>
            <option value="options">Opciones de usuario</option>
          </select>
          <p className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
            Define el módulo que abrirá por defecto en tu sesión.
          </p>
        </div>

        <div className="panel-card rounded-[2rem] p-5 md:p-6">
          <h3 className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-[#16263F] dark:text-slate-100">
            <Clock3 className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Hora en panel
          </h3>
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  onChangePreferences({ ...preferences, timeFormat: "24h" })
                }
                className={`flex-1 rounded-xl border px-3 py-2 text-xs font-black uppercase tracking-widest ${
                  preferences.timeFormat === "24h"
                    ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400/70 dark:bg-blue-950/50 dark:text-blue-300"
                    : "border-slate-200 text-slate-600 dark:border-slate-600/80 dark:text-slate-300"
                }`}
              >
                24 horas
              </button>
              <button
                type="button"
                onClick={() =>
                  onChangePreferences({ ...preferences, timeFormat: "12h" })
                }
                className={`flex-1 rounded-xl border px-3 py-2 text-xs font-black uppercase tracking-widest ${
                  preferences.timeFormat === "12h"
                    ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400/70 dark:bg-blue-950/50 dark:text-blue-300"
                    : "border-slate-200 text-slate-600 dark:border-slate-600/80 dark:text-slate-300"
                }`}
              >
                12 horas
              </button>
            </div>
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-600/80 dark:bg-[var(--panel-surface-muted)]">
              <input
                type="checkbox"
                checked={preferences.showSeconds}
                onChange={(e) =>
                  onChangePreferences({
                    ...preferences,
                    showSeconds: e.target.checked,
                  })
                }
                className="h-4 w-4 accent-blue-600"
              />
              <span className="text-sm font-semibold text-[#16263F] dark:text-slate-100">
                Mostrar segundos
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
