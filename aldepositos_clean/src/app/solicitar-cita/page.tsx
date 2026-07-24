"use client";

import React, { useState } from "react";
import Link from "next/link";
import { CalendarPlus, CheckCircle2, Loader2, Paperclip } from "lucide-react";
import { BrandLogoMark } from "@/components/brand/BrandLogoMark";
import { supabase } from "@/lib/supabase";

type SuccessState = {
  codigo: string;
};

export default function SolicitarCitaPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);
  const [files, setFiles] = useState<FileList | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (files) {
      for (const f of Array.from(files)) {
        fd.append("adjuntos", f);
      }
    }
    try {
      const headers: HeadersInit = {};
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (token) headers.Authorization = `Bearer ${token}`;
      } catch {
        /* público sin sesión */
      }
      const res = await fetch("/api/citas", { method: "POST", body: fd, headers });
      const json = (await res.json()) as {
        error?: string;
        codigo_seguimiento?: string;
      };
      if (!res.ok) throw new Error(json.error || "No se pudo enviar la solicitud.");
      setSuccess({ codigo: json.codigo_seguimiento || "" });
      form.reset();
      setFiles(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al enviar.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="safe-area-insets relative min-h-dvh min-h-screen overflow-x-hidden bg-[var(--panel-bg)] font-sans">
      <div className="pointer-events-none absolute left-[-10%] top-[-10%] h-[min(520px,80vw)] w-[min(520px,80vw)] rounded-full bg-blue-200/20 blur-3xl dark:bg-blue-500/10" />
      <div className="pointer-events-none absolute bottom-[-8%] right-[-8%] h-[min(480px,75vw)] w-[min(480px,75vw)] rounded-full bg-slate-300/25 blur-3xl dark:bg-slate-700/20" />

      <div className="relative z-10 mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandLogoMark variant="loginHero" priority />
          <h1 className="mt-4 text-2xl font-black tracking-tight text-[#16263F] dark:text-slate-100 sm:text-3xl">
            Solicitar cita de entrega
          </h1>
          <p className="mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
            Completa el formulario. AlDepósitos confirmará fecha y hora. No
            necesitas cuenta de inventarios.
          </p>
        </div>

        {success ? (
          <div className="panel-card rounded-2xl p-6 text-center sm:p-10">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
            <h2 className="mt-4 text-xl font-bold text-[#16263F] dark:text-slate-100">
              Solicitud enviada
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Guarda tu código de seguimiento:
            </p>
            <p className="mt-4 rounded-xl bg-[#16263F] px-4 py-3 font-mono text-lg font-bold tracking-wide text-white">
              {success.codigo}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={() => setSuccess(null)}
                className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-[#16263F] dark:border-slate-600 dark:text-slate-100"
              >
                Enviar otra solicitud
              </button>
              <Link
                href="/login"
                className="rounded-xl bg-[#16263F] px-4 py-3 text-sm font-semibold text-white"
              >
                Ir al inicio de sesión
              </Link>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="panel-card space-y-5 rounded-2xl p-5 sm:p-8"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Empresa *" name="empresa" required />
              <Field label="Nombre de contacto *" name="contacto_nombre" required />
              <Field label="Correo *" name="email" type="email" required />
              <Field label="Teléfono *" name="telefono" required />
              <Field
                label="Fecha preferida *"
                name="fecha_preferida"
                type="date"
                required
              />
              <Field label="Hora preferida (opcional)" name="hora_preferida" type="time" />
              <Field
                label="Bultos estimados"
                name="bultos_estimados"
                type="number"
                min="0"
              />
              <Field
                label="Peso estimado (kg)"
                name="peso_kg_estimado"
                type="number"
                min="0"
                step="0.01"
              />
              <Field
                label="CBM estimado"
                name="cbm_estimado"
                type="number"
                min="0"
                step="0.01"
              />
            </div>

            <div className="space-y-2 text-left">
              <label className="ml-1 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Observaciones
              </label>
              <textarea
                name="observaciones"
                rows={3}
                className="panel-input w-full rounded-xl px-4 py-3 text-sm"
                placeholder="Referencias, tipo de carga, restricciones…"
              />
            </div>

            <div className="space-y-2 text-left">
              <label className="ml-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                <Paperclip className="h-3.5 w-3.5" />
                Adjuntos (PDF, imagen, Excel/CSV · máx 15 MB c/u)
              </label>
              <input
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv,application/pdf,image/png,image/jpeg"
                onChange={(e) => setFiles(e.target.files)}
                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-[#16263F] file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
              />
            </div>

            {error && (
              <p className="text-center text-sm text-red-600" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full touch-target items-center justify-center gap-2 rounded-xl bg-[#16263F] py-3.5 text-[11px] font-bold uppercase tracking-widest text-white disabled:opacity-70"
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <CalendarPlus className="h-4 w-4" />
                  Enviar solicitud
                </>
              )}
            </button>

            <p className="text-center text-xs text-slate-400">
              <Link href="/login" className="underline hover:text-[#16263F]">
                Volver al login
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  min,
  step,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  min?: string;
  step?: string;
}) {
  return (
    <div className="space-y-2 text-left">
      <label className="ml-1 block text-[10px] font-bold uppercase tracking-widest text-slate-500">
        {label}
      </label>
      <input
        name={name}
        type={type}
        required={required}
        min={min}
        step={step}
        className="panel-input w-full rounded-xl px-4 py-3 text-sm"
      />
    </div>
  );
}
