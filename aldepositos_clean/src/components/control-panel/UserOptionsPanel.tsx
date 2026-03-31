"use client";

import React, { useRef, useState } from "react";
import { Clock3, Moon, Sun, Upload, UserRound, X } from "lucide-react";
import type { UserPreferences } from "@/lib/userPreferences";

type UserOptionsPanelProps = {
  userDisplayName: string | null;
  userEmail: string | null;
  preferences: UserPreferences;
  onChangePreferences: (next: UserPreferences) => void;
};

export function UserOptionsPanel({
  userDisplayName,
  userEmail,
  preferences,
  onChangePreferences,
}: UserOptionsPanelProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleTheme = (theme: UserPreferences["theme"]) => {
    onChangePreferences({ ...preferences, theme });
  };

  const onPickImage: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadError("Selecciona una imagen válida.");
      return;
    }
    if (file.size > 2_500_000) {
      setUploadError("La imagen debe pesar menos de 2.5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      if (!result) {
        setUploadError("No se pudo leer la imagen.");
        return;
      }
      setUploadError(null);
      onChangePreferences({
        ...preferences,
        avatarDataUrl: result,
      });
    };
    reader.onerror = () => setUploadError("Error leyendo archivo.");
    reader.readAsDataURL(file);
  };

  return (
    <div className="max-w-4xl mx-auto w-full space-y-5 md:space-y-6 animate-fade pb-10">
      <div className="bg-white rounded-[2rem] border border-slate-200 p-6 md:p-8 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
          Opciones de usuario
        </p>
        <h2 className="text-2xl md:text-3xl font-black text-[#16263F] mt-1">
          Personalización
        </h2>
        <p className="text-sm text-slate-500 font-semibold mt-2">
          Estos ajustes solo te afectan a ti. No cambian el panel de otros usuarios.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        <div className="bg-white rounded-[2rem] border border-slate-200 p-5 md:p-6 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-widest text-[#16263F] mb-4">
            Tema
          </h3>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => handleTheme("light")}
              className={`w-full flex items-center justify-between rounded-2xl border px-4 py-3 transition ${
                preferences.theme === "light"
                  ? "border-blue-500 bg-blue-50"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-bold text-[#16263F]">
                <Sun className="w-4 h-4 text-amber-500" /> Claro
              </span>
              {preferences.theme === "light" && (
                <span className="text-[10px] font-black uppercase text-blue-700">
                  Activo
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => handleTheme("dark")}
              className={`w-full flex items-center justify-between rounded-2xl border px-4 py-3 transition ${
                preferences.theme === "dark"
                  ? "border-blue-500 bg-blue-50"
                  : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-bold text-[#16263F]">
                <Moon className="w-4 h-4 text-indigo-600" /> Oscuro
              </span>
              {preferences.theme === "dark" && (
                <span className="text-[10px] font-black uppercase text-blue-700">
                  Activo
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-[2rem] border border-slate-200 p-5 md:p-6 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-widest text-[#16263F] mb-4">
            Perfil
          </h3>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center">
              {preferences.avatarDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preferences.avatarDataUrl}
                  alt="Avatar de usuario"
                  className="w-full h-full object-cover"
                />
              ) : (
                <UserRound className="w-7 h-7 text-slate-400" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-black text-[#16263F] truncate">
                {userDisplayName || "Operador"}
              </p>
              <p className="text-xs font-semibold text-slate-500 truncate">
                {userEmail || "Sin correo"}
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
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#16263F] text-white px-4 py-2.5 text-[10px] font-black uppercase tracking-widest hover:bg-[#0f1b2e] transition"
            >
              <Upload className="w-4 h-4" /> Subir foto
            </button>
            {preferences.avatarDataUrl && (
              <button
                type="button"
                onClick={() =>
                  onChangePreferences({ ...preferences, avatarDataUrl: null })
                }
                className="inline-flex items-center gap-2 rounded-xl border border-red-200 text-red-600 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest hover:bg-red-50 transition"
              >
                <X className="w-4 h-4" /> Quitar foto
              </button>
            )}
          </div>
          {uploadError && (
            <p className="mt-3 text-xs font-semibold text-red-600">{uploadError}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5">
        <div className="bg-white rounded-[2rem] border border-slate-200 p-5 md:p-6 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-widest text-[#16263F] mb-4">
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
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-[#16263F] outline-none focus:border-blue-500"
          >
            <option value="dashboard">Panel principal</option>
            <option value="quick-entry">Ingreso rápido</option>
            <option value="detailed-entry">Ingreso detallado</option>
            <option value="reports">Reportes</option>
            <option value="productivity">Productividad</option>
            <option value="monitor">Monitoreo live</option>
          </select>
          <p className="mt-2 text-xs text-slate-500 font-semibold">
            Define el módulo que abrirá por defecto en tu sesión.
          </p>
        </div>

        <div className="bg-white rounded-[2rem] border border-slate-200 p-5 md:p-6 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-widest text-[#16263F] mb-4 flex items-center gap-2">
            <Clock3 className="w-4 h-4 text-blue-600" /> Hora en panel
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
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600"
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
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600"
                }`}
              >
                12 horas
              </button>
            </div>
            <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
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
              <span className="text-sm font-semibold text-[#16263F]">
                Mostrar segundos
              </span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
