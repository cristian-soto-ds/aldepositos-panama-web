"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  Loader2,
  Paperclip,
  RefreshCw,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Cita, CitaAdjunto, CitaEstado } from "@/lib/citas/types";

type CitaWithUrls = Omit<Cita, "adjuntos"> & {
  adjuntos: Array<CitaAdjunto & { url?: string | null }>;
};

function estadoBadge(estado: CitaEstado): string {
  switch (estado) {
    case "pendiente":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
    case "confirmada":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
    case "rechazada":
      return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
    case "completada":
      return "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function CitasModule() {
  const [citas, setCitas] = useState<CitaWithUrls[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CitaWithUrls | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [fechaCita, setFechaCita] = useState("");
  const [horaCita, setHoraCita] = useState("");
  const [mensaje, setMensaje] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sin sesión.");
      const qs = filter ? `?estado=${encodeURIComponent(filter)}` : "";
      const res = await fetch(`/api/citas${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as { citas?: CitaWithUrls[]; error?: string };
      if (!res.ok) throw new Error(json.error || "No se pudieron cargar las citas.");
      setCitas(json.citas ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const kpis = useMemo(() => {
    const weekStart = startOfWeek(new Date());
    let pendientes = 0;
    let confirmadas = 0;
    let estaSemana = 0;
    for (const c of citas) {
      if (c.estado === "pendiente") pendientes += 1;
      if (c.estado === "confirmada") confirmadas += 1;
      const created = new Date(c.created_at);
      if (!Number.isNaN(created.getTime()) && created >= weekStart) {
        estaSemana += 1;
      }
    }
    return { pendientes, confirmadas, estaSemana, total: citas.length };
  }, [citas]);

  const openDetail = (c: CitaWithUrls) => {
    setSelected(c);
    setFechaCita(c.fecha_cita || c.fecha_preferida || "");
    setHoraCita(c.hora_cita || c.hora_preferida || "");
    setMensaje(c.respuesta_mensaje || "");
  };

  const respond = async (estado: "confirmada" | "rechazada" | "completada") => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sin sesión.");
      const res = await fetch(`/api/citas/${selected.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          estado,
          fecha_cita: fechaCita || null,
          hora_cita: horaCita || null,
          respuesta_mensaje: mensaje || null,
        }),
      });
      const json = (await res.json()) as { cita?: CitaWithUrls; error?: string };
      if (!res.ok) throw new Error(json.error || "No se pudo responder.");
      if (json.cita) {
        setCitas((prev) =>
          prev.map((c) => (c.id === json.cita!.id ? json.cita! : c)),
        );
        setSelected(json.cita);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al responder.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[#16263F] dark:text-slate-100">
            Citas de entrega
          </h2>
          <p className="text-sm text-slate-500">
            Solicitudes de proveedores · responder y confirmar
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold dark:border-slate-600"
        >
          <RefreshCw className="h-4 w-4" />
          Actualizar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Pendientes" value={kpis.pendientes} />
        <Kpi label="Confirmadas" value={kpis.confirmadas} />
        <Kpi label="Esta semana" value={kpis.estaSemana} />
        <Kpi label="Total listado" value={kpis.total} />
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { id: "", label: "Todas" },
          { id: "pendiente", label: "Pendientes" },
          { id: "confirmada", label: "Confirmadas" },
          { id: "rechazada", label: "Rechazadas" },
          { id: "completada", label: "Completadas" },
        ].map((f) => (
          <button
            key={f.id || "all"}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wide ${
              filter === f.id
                ? "bg-[#16263F] text-white"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800/80">
              <tr>
                <th className="px-3 py-3">Empresa</th>
                <th className="px-3 py-3">Preferida</th>
                <th className="px-3 py-3">Estado</th>
                <th className="px-3 py-3">Adjuntos</th>
                <th className="px-3 py-3">Código</th>
              </tr>
            </thead>
            <tbody>
              {citas.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-10 text-center text-slate-400"
                  >
                    No hay citas en este filtro.
                  </td>
                </tr>
              ) : (
                citas.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => openDetail(c)}
                    className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                  >
                    <td className="px-3 py-3">
                      <div className="font-semibold text-[#16263F] dark:text-slate-100">
                        {c.empresa}
                      </div>
                      <div className="text-xs text-slate-500">
                        {c.contacto_nombre} · {c.email}
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {c.fecha_preferida}
                      {c.hora_preferida ? ` ${c.hora_preferida}` : ""}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${estadoBadge(c.estado)}`}
                      >
                        {c.estado}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {c.adjuntos?.length ? (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <Paperclip className="h-3.5 w-3.5" />
                          {c.adjuntos.length}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs">
                      {c.codigo_seguimiento}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
          <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl dark:bg-[#0d1627] sm:rounded-2xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-[#16263F] dark:text-slate-100">
                  {selected.empresa}
                </h3>
                <p className="text-xs text-slate-500">
                  {selected.codigo_seguimiento}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-[10px] font-bold uppercase text-slate-400">
                  Contacto
                </dt>
                <dd>{selected.contacto_nombre}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase text-slate-400">
                  Teléfono
                </dt>
                <dd>{selected.telefono}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[10px] font-bold uppercase text-slate-400">
                  Email
                </dt>
                <dd>{selected.email}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase text-slate-400">
                  Preferida
                </dt>
                <dd>
                  {selected.fecha_preferida}
                  {selected.hora_preferida
                    ? ` ${selected.hora_preferida}`
                    : ""}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase text-slate-400">
                  Estimados
                </dt>
                <dd>
                  {selected.bultos_estimados ?? "—"} bultos ·{" "}
                  {selected.peso_kg_estimado ?? "—"} kg ·{" "}
                  {selected.cbm_estimado ?? "—"} CBM
                </dd>
              </div>
              {selected.observaciones && (
                <div className="col-span-2">
                  <dt className="text-[10px] font-bold uppercase text-slate-400">
                    Observaciones
                  </dt>
                  <dd className="whitespace-pre-wrap">{selected.observaciones}</dd>
                </div>
              )}
            </dl>

            {selected.adjuntos?.length > 0 && (
              <div className="mb-4 space-y-1">
                <p className="text-[10px] font-bold uppercase text-slate-400">
                  Adjuntos
                </p>
                {selected.adjuntos.map((a) => (
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

            <div className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-700">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <CalendarClock className="h-4 w-4" />
                Responder
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400">
                    Fecha cita
                  </label>
                  <input
                    type="date"
                    value={fechaCita}
                    onChange={(e) => setFechaCita(e.target.value)}
                    className="panel-input mt-1 w-full rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase text-slate-400">
                    Hora
                  </label>
                  <input
                    type="time"
                    value={horaCita}
                    onChange={(e) => setHoraCita(e.target.value)}
                    className="panel-input mt-1 w-full rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-400">
                  Mensaje
                </label>
                <textarea
                  value={mensaje}
                  onChange={(e) => setMensaje(e.target.value)}
                  rows={3}
                  className="panel-input mt-1 w-full rounded-lg px-3 py-2 text-sm"
                  placeholder="Instrucciones para el proveedor…"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void respond("confirmada")}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-bold uppercase text-white disabled:opacity-60"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  Confirmar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void respond("rechazada")}
                  className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-red-600 px-3 py-2.5 text-xs font-bold uppercase text-white disabled:opacity-60"
                >
                  Rechazar
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void respond("completada")}
                  className="inline-flex w-full items-center justify-center gap-1 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-bold uppercase dark:border-slate-600"
                >
                  Marcar completada
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/40">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-black text-[#16263F] dark:text-slate-100">
        {value}
      </p>
    </div>
  );
}
