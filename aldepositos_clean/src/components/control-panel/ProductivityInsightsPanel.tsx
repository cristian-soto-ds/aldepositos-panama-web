"use client";

import React, { useMemo } from "react";
import {
  CheckCircle2,
  ClipboardList,
  Clock3,
  Info,
  PackageCheck,
  Target,
  TrendingUp,
  UserCircle2,
} from "lucide-react";
import type { Task } from "@/lib/types/task";

type ProductivityInsightsPanelProps = {
  tasks: Task[];
  userDisplayName?: string | null;
};

type ModuleKey = "quick" | "detailed" | "airway" | "unknown";

const MODULE_LABELS: Record<ModuleKey, string> = {
  quick: "Ingreso Rapido",
  detailed: "Ingreso Detallado",
  airway: "Guia Aerea",
  unknown: "Sin modulo",
};

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(value)}%`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("es-PA").format(value || 0);
}

function toReadableStatus(status: string): string {
  if (status === "completed") return "Completado";
  if (status === "in_progress" || status === "partial") return "En proceso";
  if (status === "pending") return "Pendiente";
  return "Sin estado";
}

function getPerformanceLabel(percent: number): string {
  if (percent >= 85) return "Ritmo alto";
  if (percent >= 60) return "Ritmo estable";
  if (percent >= 30) return "Ritmo en desarrollo";
  return "Inicio de jornada";
}

function getPerformanceTone(percent: number): string {
  if (percent >= 85) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (percent >= 60) return "text-blue-700 bg-blue-50 border-blue-200";
  if (percent >= 30) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-slate-700 bg-slate-50 border-slate-200";
}

export function ProductivityInsightsPanel({
  tasks,
  userDisplayName,
}: ProductivityInsightsPanelProps) {
  const operatorName = userDisplayName || "Operador";

  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const inProgress = tasks.filter(
      (t) => t.status === "in_progress" || t.status === "partial",
    ).length;
    const pending = tasks.filter((t) => t.status === "pending").length;
    const dispatched = tasks.filter((t) => t.dispatched).length;
    const totalBultosDeclarados = tasks.reduce(
      (acc, task) => acc + (task.expectedBultos || 0),
      0,
    );
    const totalBultosProcesados = tasks.reduce(
      (acc, task) => acc + (task.currentBultos || 0),
      0,
    );

    const moduleBuckets: Record<ModuleKey, Task[]> = {
      quick: [],
      detailed: [],
      airway: [],
      unknown: [],
    };
    tasks.forEach((task) => {
      const moduleKey = (task.type || "unknown") as ModuleKey;
      if (!moduleBuckets[moduleKey]) {
        moduleBuckets.unknown.push(task);
        return;
      }
      moduleBuckets[moduleKey].push(task);
    });

    const byModule = (Object.keys(moduleBuckets) as ModuleKey[])
      .map((moduleKey) => {
        const bucket = moduleBuckets[moduleKey];
        const done = bucket.filter((task) => task.status === "completed").length;
        const completionRate = bucket.length ? (done / bucket.length) * 100 : 0;
        const processed = bucket.reduce(
          (acc, task) => acc + (task.currentBultos || 0),
          0,
        );
        const declared = bucket.reduce(
          (acc, task) => acc + (task.expectedBultos || 0),
          0,
        );
        return {
          moduleKey,
          label: MODULE_LABELS[moduleKey],
          total: bucket.length,
          done,
          completionRate,
          processed,
          declared,
        };
      })
      .sort((a, b) => b.total - a.total);

    const byClient = Object.entries(
      tasks.reduce<Record<string, number>>((acc, task) => {
        const key = task.mainClient?.trim() || "Sin Cliente";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    )
      .map(([client, amount]) => ({ client, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6);

    const recentActivity = [...tasks]
      .sort((a, b) => {
        const dateA = new Date(a.date || 0).getTime();
        const dateB = new Date(b.date || 0).getTime();
        return dateB - dateA;
      })
      .slice(0, 7);

    const globalCompletion = total > 0 ? (completed / total) * 100 : 0;
    const bultosProgress =
      totalBultosDeclarados > 0
        ? (totalBultosProcesados / totalBultosDeclarados) * 100
        : 0;

    const focusMessage =
      pending > inProgress + completed
        ? "Tienes alta carga pendiente. Prioriza cierres rapidos para liberar flujo."
        : completed >= pending
          ? "Buen avance. El volumen completado supera o iguala el pendiente."
          : "Operacion balanceada. Mantener enfoque en tareas en proceso.";

    return {
      total,
      completed,
      inProgress,
      pending,
      dispatched,
      totalBultosDeclarados,
      totalBultosProcesados,
      globalCompletion,
      bultosProgress,
      byModule,
      byClient,
      recentActivity,
      focusMessage,
    };
  }, [tasks]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 pb-10">
      <section className="relative overflow-hidden rounded-[2rem] border border-[#1e3a8a]/10 bg-gradient-to-br from-[#16263F] via-[#1D3A62] to-[#2563eb] p-6 text-white shadow-xl md:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-blue-200/20 blur-3xl" />
        <div className="relative z-10 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/25 bg-white/15 backdrop-blur">
              <UserCircle2 className="h-9 w-9" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-100">
                Panel de productividad
              </p>
              <h2 className="mt-1 text-3xl font-black tracking-tight md:text-4xl">
                {operatorName}
              </h2>
              <p className="mt-2 max-w-2xl text-sm font-semibold text-blue-100/95">
                Visualizacion clara de rendimiento, carga y avance del inventario
                en una sola pantalla.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <HeroStat label="Inventarios" value={formatNumber(stats.total)} />
            <HeroStat label="Completados" value={formatNumber(stats.completed)} />
            <HeroStat label="En Proceso" value={formatNumber(stats.inProgress)} />
            <HeroStat label="Despachados" value={formatNumber(stats.dispatched)} />
          </div>
        </div>
        <div className="relative z-10 mt-5 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider">
            {stats.focusMessage}
          </span>
          <span
            className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-wider ${getPerformanceTone(
              stats.globalCompletion,
            )}`}
          >
            {getPerformanceLabel(stats.globalCompletion)}
          </span>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Por completar"
          value={formatNumber(stats.pending)}
          helper="RAs aun sin captura"
          icon={<Clock3 className="h-4 w-4 text-amber-600" />}
          tone="amber"
        />
        <MetricCard
          title="Cumplimiento"
          value={formatPercent(stats.globalCompletion)}
          helper="Inventarios cerrados"
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
          tone="green"
        />
        <MetricCard
          title="Bultos capturados"
          value={formatPercent(stats.bultosProgress)}
          helper={`${formatNumber(stats.totalBultosProcesados)} / ${formatNumber(stats.totalBultosDeclarados)}`}
          icon={<Target className="h-4 w-4 text-blue-600" />}
          tone="blue"
        />
        <MetricCard
          title="RAs en curso"
          value={formatNumber(stats.inProgress)}
          helper="Captura iniciada"
          icon={<TrendingUp className="h-4 w-4 text-violet-600" />}
          tone="violet"
        />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className="text-xs font-black uppercase tracking-widest text-[#16263F]">
              Productividad por modulo
            </p>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-600">
              {formatNumber(stats.total)} RAs
            </span>
          </div>
          <div className="space-y-3">
            {stats.byModule
              .filter((row) => row.total > 0)
              .map((row) => (
                <div
                  key={row.moduleKey}
                  className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-black uppercase tracking-widest text-slate-700">
                      {row.label}
                    </p>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-600">
                      {formatNumber(row.done)}/{formatNumber(row.total)}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-semibold text-slate-500">
                    <p>Bultos procesados: {formatNumber(row.processed)}</p>
                    <p className="text-right">
                      Bultos declarados: {formatNumber(row.declared)}
                    </p>
                  </div>
                  <div className="mt-2 h-2.5 w-full rounded-full bg-slate-200">
                    <div
                      className="h-2.5 rounded-full bg-[#16263F] transition-all"
                      style={{ width: `${Math.min(row.completionRate, 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-right text-[10px] font-black uppercase tracking-wider text-slate-500">
                    {formatPercent(row.completionRate)} completado
                  </p>
                </div>
              ))}
            {stats.byModule.every((row) => row.total === 0) && (
              <p className="rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm font-semibold text-slate-500">
                Aun no hay inventarios para comparar entre modulos.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <p className="text-xs font-black uppercase tracking-widest text-[#16263F]">
              Clientes con mayor carga
            </p>
            <div className="mt-3 space-y-2">
              {stats.byClient.length === 0 ? (
                <p className="rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">
                  Todavia no hay actividad para mostrar.
                </p>
              ) : (
                stats.byClient.map((item, index) => (
                  <div
                    key={item.client}
                    className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5"
                  >
                    <p className="truncate pr-3 text-xs font-bold uppercase tracking-wide text-slate-700">
                      {index + 1}. {item.client}
                    </p>
                    <span className="rounded-full bg-[#16263F] px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white">
                      {formatNumber(item.amount)} RA
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            <p className="text-xs font-black uppercase tracking-widest text-[#16263F]">
              Actividad reciente
            </p>
            <div className="mt-3 space-y-2">
              {stats.recentActivity.length === 0 ? (
                <p className="rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">
                  Sin inventarios recientes registrados.
                </p>
              ) : (
                stats.recentActivity.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-xl border border-slate-100 bg-white px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-black uppercase tracking-widest text-slate-700">
                        RA {task.ra}
                      </p>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                        {MODULE_LABELS[(task.type || "unknown") as ModuleKey]}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] font-semibold text-slate-500">
                      {toReadableStatus(task.status)} · Bultos{" "}
                      {formatNumber(task.currentBultos || 0)}/
                      {formatNumber(task.expectedBultos || 0)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
        <p className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
          <Info className="h-4 w-4 text-blue-500" />
          Guia rapida del panel
        </p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <GuideCard
            title="Completado"
            text="RA con inventario cerrado y listo para continuidad operativa."
          />
          <GuideCard
            title="En proceso"
            text="RA con captura iniciada, aun pendiente de cierre final."
          />
          <GuideCard
            title="Pendiente"
            text="RA sin captura activa. Requiere atencion de inventario."
          />
        </div>
      </section>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/25 bg-white/10 px-3 py-2 text-white backdrop-blur">
      <p className="text-[10px] font-black uppercase tracking-widest text-blue-100">
        {label}
      </p>
      <p className="mt-1 text-xl font-black leading-none">{value}</p>
    </div>
  );
}

function MetricCard({
  title,
  value,
  helper,
  icon,
  tone,
}: {
  title: string;
  value: string;
  helper: string;
  icon: React.ReactNode;
  tone: "amber" | "green" | "blue" | "violet";
}) {
  const toneStyles: Record<typeof tone, string> = {
    amber: "border-amber-200 bg-amber-50/70",
    green: "border-emerald-200 bg-emerald-50/70",
    blue: "border-blue-200 bg-blue-50/70",
    violet: "border-violet-200 bg-violet-50/70",
  };

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${toneStyles[tone]}`}>
      <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-600">
        {icon}
        {title}
      </p>
      <p className="mt-1 text-3xl font-black leading-none text-[#16263F]">{value}</p>
      <p className="mt-2 text-[11px] font-semibold text-slate-500">{helper}</p>
    </div>
  );
}

function GuideCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
      <p className="text-xs font-black uppercase tracking-widest text-slate-700">
        {title}
      </p>
      <p className="mt-1 text-xs font-semibold text-slate-500">{text}</p>
    </div>
  );
}
