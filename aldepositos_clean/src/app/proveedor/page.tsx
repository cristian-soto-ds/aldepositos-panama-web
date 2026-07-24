"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  Loader2,
  LogOut,
  Paperclip,
  RefreshCw,
} from "lucide-react";
import { BrandLogoMark } from "@/components/brand/BrandLogoMark";
import { supabase } from "@/lib/supabase";
import type { Cita, CitaAdjunto, CitaEstado } from "@/lib/citas/types";

type CitaWithUrls = Omit<Cita, "adjuntos"> & {
  adjuntos: Array<CitaAdjunto & { url?: string | null }>;
};

function estadoClass(estado: CitaEstado): string {
  switch (estado) {
    case "pendiente":
      return "bg-amber-100 text-amber-800";
    case "confirmada":
      return "bg-emerald-100 text-emerald-800";
    case "rechazada":
      return "bg-red-100 text-red-800";
    default:
      return "bg-slate-200 text-slate-700";
  }
}

export default function ProveedorPortalPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [citas, setCitas] = useState<CitaWithUrls[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.replace("/login");
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        router.replace("/login");
        return;
      }

      const roleRes = await fetch("/api/me/role", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const roleJson = (await roleRes.json()) as {
        rol?: string;
        fullName?: string | null;
        error?: string;
      };
      if (!roleRes.ok) throw new Error(roleJson.error || "Sesión inválida.");
      if (roleJson.rol !== "proveedor") {
        router.replace("/panel");
        return;
      }
      setDisplayName(roleJson.fullName || userData.user.email || "Proveedor");

      const res = await fetch("/api/citas", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as { citas?: CitaWithUrls[]; error?: string };
      if (!res.ok) throw new Error(json.error || "No se pudieron cargar citas.");
      setCitas(json.citas ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const kpis = useMemo(() => {
    let pendientes = 0;
    let confirmadas = 0;
    for (const c of citas) {
      if (c.estado === "pendiente") pendientes += 1;
      if (c.estado === "confirmada") confirmadas += 1;
    }
    return { total: citas.length, pendientes, confirmadas };
  }, [citas]);

  const logout = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[var(--panel-bg)]">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="safe-area-insets min-h-dvh bg-[var(--panel-bg)] font-sans">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-700 dark:bg-[#0d1627]/90">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <BrandLogoMark variant="sidebar" />
            <div>
              <p className="text-sm font-black text-[#16263F] dark:text-slate-100">
                Portal proveedor
              </p>
              <p className="text-xs text-slate-500">{displayName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/solicitar-cita"
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#16263F] px-3 py-2 text-xs font-bold uppercase tracking-wide text-white"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              Nueva cita
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-xl border border-slate-200 p-2 dark:border-slate-600"
              aria-label="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-black text-[#16263F] dark:text-slate-100">
            Mis citas
          </h1>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold dark:border-slate-600"
          >
            <RefreshCw className="h-4 w-4" />
            Actualizar
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Kpi label="Solicitadas" value={kpis.total} />
          <Kpi label="Pendientes" value={kpis.pendientes} />
          <Kpi label="Confirmadas" value={kpis.confirmadas} />
        </div>

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        <ul className="space-y-3">
          {citas.length === 0 ? (
            <li className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
              Aún no tienes citas.{" "}
              <Link href="/solicitar-cita" className="underline">
                Solicita la primera
              </Link>
              .
            </li>
          ) : (
            citas.map((c) => (
              <li
                key={c.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-[#16263F] dark:text-slate-100">
                      {c.empresa}
                    </p>
                    <p className="font-mono text-xs text-slate-500">
                      {c.codigo_seguimiento}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${estadoClass(c.estado)}`}
                  >
                    {c.estado}
                  </span>
                </div>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-[10px] font-bold uppercase text-slate-400">
                      Preferida
                    </dt>
                    <dd>
                      {c.fecha_preferida}
                      {c.hora_preferida ? ` ${c.hora_preferida}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase text-slate-400">
                      Cita confirmada
                    </dt>
                    <dd>
                      {c.fecha_cita
                        ? `${c.fecha_cita}${c.hora_cita ? ` ${c.hora_cita}` : ""}`
                        : "—"}
                    </dd>
                  </div>
                  {c.respuesta_mensaje && (
                    <div className="sm:col-span-2">
                      <dt className="text-[10px] font-bold uppercase text-slate-400">
                        Respuesta AlDepósitos
                      </dt>
                      <dd className="whitespace-pre-wrap">{c.respuesta_mensaje}</dd>
                    </div>
                  )}
                </dl>
                {c.adjuntos?.length > 0 && (
                  <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 dark:border-slate-700">
                    <p className="flex items-center gap-1 text-[10px] font-bold uppercase text-slate-400">
                      <Paperclip className="h-3 w-3" />
                      Adjuntos
                    </p>
                    {c.adjuntos.map((a) => (
                      <a
                        key={a.path}
                        href={a.url || undefined}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-sm text-blue-600 underline dark:text-blue-400"
                      >
                        {a.name}
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ))
          )}
        </ul>
      </main>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 text-center dark:border-slate-700 dark:bg-slate-900/40">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-black text-[#16263F] dark:text-slate-100">
        {value}
      </p>
    </div>
  );
}
