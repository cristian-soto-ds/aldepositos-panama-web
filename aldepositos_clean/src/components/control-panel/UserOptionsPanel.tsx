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
    <div className="max-w-4xl mx-auto w-full space-y-5 md:space-y-6 animate-fade pb-10">
      <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-slate-600 p-6 md:p-8 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          Opciones de usuario
        </p>
        <h2 className="text-2xl md:text-3xl font-black text-[#16263F] dark:text-slate-100 mt-1">
          Personalización
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 font-semibold mt-2">
          Tema y hora son solo en tu dispositivo. La foto de perfil se guarda en la nube y
          la ven otros operadores en presencia en vivo.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-slate-600 p-5 md:p-6 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-widest text-[#16263F] dark:text-slate-100 mb-4">
            Tema
          </h3>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => handleTheme("light")}
              className={`w-full flex items-center justify-between rounded-2xl border px-4 py-3 transition ${
                preferences.theme === "light"
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/45"
                  : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/80"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-bold text-[#16263F] dark:text-slate-100">
                <Sun className="w-4 h-4 text-amber-500" /> Claro
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
              className={`w-full flex items-center justify-between rounded-2xl border px-4 py-3 transition ${
                preferences.theme === "dark"
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-950/45"
                  : "border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/80"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-bold text-[#16263F] dark:text-slate-100">
                <Moon className="w-4 h-4 text-indigo-600" /> Oscuro
              </span>
              {preferences.theme === "dark" && (
                <span className="text-[10px] font-black uppercase text-blue-700 dark:text-blue-300">
                  Activo
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-slate-600 p-5 md:p-6 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-widest text-[#16263F] dark:text-slate-100 mb-4">
            Foto de perfil
          </h3>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/60 overflow-hidden flex items-center justify-center">
              {showAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={showAvatar}
                  alt="Avatar de usuario"
                  className="w-full h-full object-cover"
                />
              ) : (
                <UserRound className="w-7 h-7 text-slate-400 dark:text-slate-500" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-black text-[#16263F] dark:text-slate-100 truncate">
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
              className="inline-flex items-center gap-2 rounded-xl bg-[#16263F] text-white px-4 py-2.5 text-[10px] font-black uppercase tracking-widest hover:bg-[#0f1b2e] transition disabled:opacity-50"
            >
              {avatarBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {canRemove ? "Actualizar foto" : "Subir foto"}
            </button>
            {canRemove && (
              <button
                type="button"
                disabled={avatarBusy || !userId}
                onClick={() => void onRemoveAvatar()}
                className="inline-flex items-center gap-2 rounded-xl border border-red-200 text-red-600 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest hover:bg-red-50 transition disabled:opacity-50"
              >
                <X className="w-4 h-4" /> Quitar foto
              </button>
            )}
          </div>
          {uploadError && (
            <p className="mt-3 text-xs font-semibold text-red-600">{uploadError}</p>
          )}
          <p className="mt-3 text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-relaxed">
            Se guarda en tu perfil (Supabase). Puedes cambiarla cuando quieras. Máx. 2,5 MB.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-slate-600 p-5 md:p-6 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-widest text-[#16263F] dark:text-slate-100 mb-4">
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
            className="w-full rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm font-bold text-[#16263F] dark:text-slate-100 outline-none focus:border-blue-500"
          >
            <option value="dashboard">Panel principal</option>
            <option value="quick-entry">Ingreso rápido</option>
            <option value="detailed-entry">Ingreso detallado</option>
            <option value="reports">Reportes</option>
            <option value="productivity">Productividad</option>
            <option value="monitor">Monitoreo live</option>
            <option value="options">Opciones de usuario</option>
          </select>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 font-semibold">
            Define el módulo que abrirá por defecto en tu sesión.
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-[2rem] border border-slate-200 dark:border-slate-600 p-5 md:p-6 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-widest text-[#16263F] dark:text-slate-100 mb-4 flex items-center gap-2">
            <Clock3 className="w-4 h-4 text-blue-600 dark:text-blue-400" /> Hora en panel
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
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-950/45 text-blue-700 dark:text-blue-300"
                    : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
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
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-950/45 text-blue-700 dark:text-blue-300"
                    : "border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300"
                }`}
              >
                12 horas
              </button>
            </div>
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-600 p-3">
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
