"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Trophy,
  Medal,
  Layers,
  Package,
  ClipboardCheck,
  Clock3,
  Crown,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Zap,
  BarChart3,
} from "lucide-react";

import type { Task } from "@/lib/types/task";
import {
  computeInventoryLeaderboard,
  isCurrentUserInventariador,
  LEADERBOARD_PERIOD_OPTIONS,
  type LeaderboardPeriod,
  type InventariadorStats,
} from "@/lib/inventoryLeaderboard";
import { avatarInitialsFromName } from "@/lib/viewerIdentity";

type InventoryLeaderboardModuleProps = {
  tasks: Task[];
  userDisplayName?: string | null;
  userEmail?: string | null;
};

function formatNumber(n: number): string {
  return new Intl.NumberFormat("es-PA").format(Math.round(n));
}

function formatDelta(n: number): string {
  if (n > 0) return `+${formatNumber(n)}`;
  if (n < 0) return formatNumber(n);
  return "0";
}

const AVATAR_PALETTES = [
  "bg-[#16263F] text-white",
  "bg-blue-600 text-white",
  "bg-emerald-600 text-white",
  "bg-violet-600 text-white",
  "bg-amber-500 text-white",
  "bg-rose-500 text-white",
];

function paletteForKey(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++)
    h = (h + key.charCodeAt(i) * (i + 1)) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[h]!;
}

const PODIUM_ORDER = [1, 0, 2] as const;
const PODIUM_HEIGHTS = ["h-28 sm:h-32", "h-36 sm:h-44", "h-24 sm:h-28"] as const;
const PODIUM_MEDALS = ["🥈", "🥇", "🥉"] as const;

function ProgressBar({
  value,
  max,
  tone = "blue",
}: {
  value: number;
  max: number;
  tone?: "blue" | "amber" | "emerald";
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const gradient =
    tone === "amber"
      ? "from-[#FFC400] to-amber-300"
      : tone === "emerald"
        ? "from-emerald-500 to-emerald-300"
        : "from-[#16263F] to-blue-500";
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div
        className={`h-full rounded-full bg-gradient-to-r ${gradient} transition-all duration-500`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function TrendBadge({
  delta,
  compact = false,
}: {
  delta: number;
  compact?: boolean;
}) {
  if (delta === 0) {
    return (
      <span
        className={`inline-flex items-center gap-0.5 rounded-full bg-slate-100 font-black text-slate-500 dark:bg-slate-800 dark:text-slate-400 ${
          compact ? "px-1.5 py-0.5 text-[8px]" : "px-2 py-0.5 text-[9px]"
        }`}
      >
        <Minus className="h-3 w-3" aria-hidden />
        Igual
      </span>
    );
  }
  const up = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full font-black ${
        up
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
      } ${compact ? "px-1.5 py-0.5 text-[8px]" : "px-2 py-0.5 text-[9px]"}`}
    >
      {up ? (
        <TrendingUp className="h-3 w-3" aria-hidden />
      ) : (
        <TrendingDown className="h-3 w-3" aria-hidden />
      )}
      {formatDelta(delta)}
    </span>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div
      className="flex h-8 items-end gap-0.5"
      title="Actividad en el período"
      aria-hidden
    >
      {values.map((v, i) => (
        <div
          key={i}
          className="w-1.5 rounded-t-sm bg-gradient-to-t from-blue-600/40 to-blue-500 dark:from-sky-700/50 dark:to-sky-400"
          style={{ height: `${Math.max(12, Math.round((v / max) * 100))}%` }}
        />
      ))}
    </div>
  );
}

function MixChip({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "slate" | "blue" | "violet" | "amber" | "emerald";
}) {
  if (count <= 0) return null;
  const tones = {
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
    violet:
      "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    amber:
      "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    emerald:
      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${tones[tone]}`}
    >
      {label} {count}
    </span>
  );
}

function PodiumCard({
  stat,
  slotIndex,
  isCurrentUser,
}: {
  stat: InventariadorStats;
  slotIndex: 0 | 1 | 2;
  isCurrentUser: boolean;
}) {
  const heightClass = PODIUM_HEIGHTS[slotIndex];
  const medal = PODIUM_MEDALS[slotIndex];
  const isFirst = stat.rank === 1;

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      <div
        className={`relative mb-2 flex flex-col items-center rounded-2xl border px-3 py-3 transition sm:px-4 sm:py-4 ${
          isFirst
            ? "border-amber-300/80 bg-gradient-to-b from-amber-50 to-white shadow-lg shadow-amber-200/40 dark:border-amber-500/40 dark:from-amber-950/40 dark:to-slate-900 dark:shadow-amber-900/20"
            : "border-slate-200/90 bg-white shadow-md dark:border-slate-700 dark:bg-slate-900"
        } ${isCurrentUser ? "ring-2 ring-blue-400/60 ring-offset-2 dark:ring-offset-slate-900" : ""}`}
      >
        {isFirst && (
          <Crown
            className="absolute -top-3 h-6 w-6 text-amber-500 drop-shadow-sm"
            aria-hidden
          />
        )}
        <span className="mb-1 text-xl sm:text-2xl" aria-hidden>
          {medal}
        </span>
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-full text-sm font-black sm:h-16 sm:w-16 sm:text-base ${paletteForKey(stat.id)}`}
        >
          {avatarInitialsFromName(stat.name, null, null)}
        </div>
        <p className="mt-2 max-w-[7rem] truncate text-center text-xs font-black text-[#16263F] dark:text-slate-100 sm:max-w-[9rem] sm:text-sm">
          {stat.name}
        </p>
        {isCurrentUser && (
          <span className="mt-1 rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-blue-700 dark:bg-blue-900/50 dark:text-blue-200">
            Tú
          </span>
        )}
        <p className="mt-2 text-2xl font-black tabular-nums text-[#16263F] dark:text-white sm:text-3xl">
          {formatNumber(stat.inventarios)}
        </p>
        <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          inventarios
        </p>
        <p className="mt-1 text-[10px] font-black tabular-nums text-amber-600 dark:text-amber-400">
          {formatNumber(stat.score)} pts
        </p>
        <div className="mt-1.5">
          <TrendBadge delta={stat.deltaInventarios} compact />
        </div>
        <div className="mt-2 flex gap-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
          <span>{formatNumber(stat.filas)} filas</span>
          <span>{formatNumber(stat.bultos)} bultos</span>
        </div>
      </div>
      <div
        className={`flex w-full items-end justify-center rounded-t-xl bg-gradient-to-t from-[#16263F] to-blue-700 ${heightClass}`}
      >
        <span className="pb-2 text-2xl font-black text-white/90 sm:text-3xl">
          #{stat.rank}
        </span>
      </div>
    </div>
  );
}

function CompareChart({
  stats,
  maxInventarios,
  maxFilas,
  maxBultos,
}: {
  stats: InventariadorStats[];
  maxInventarios: number;
  maxFilas: number;
  maxBultos: number;
}) {
  return (
    <section
      className="mb-8 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5"
      aria-label="Comparativa"
    >
      <div className="mb-4 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-blue-600 dark:text-blue-400" aria-hidden />
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          Comparativa del período
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.id} className="min-w-0">
            <p className="mb-2 truncate text-xs font-black text-[#16263F] dark:text-slate-100">
              {stat.name}
            </p>
            <div className="flex h-28 items-end justify-center gap-2">
              {(
                [
                  {
                    key: "inv",
                    value: stat.inventarios,
                    max: maxInventarios,
                    label: "Inv",
                    className: "from-[#16263F] to-blue-500",
                  },
                  {
                    key: "filas",
                    value: stat.filas,
                    max: maxFilas,
                    label: "Filas",
                    className: "from-amber-500 to-amber-300",
                  },
                  {
                    key: "bultos",
                    value: stat.bultos,
                    max: maxBultos,
                    label: "Bultos",
                    className: "from-emerald-600 to-emerald-400",
                  },
                ] as const
              ).map((bar) => {
                const pct =
                  bar.max > 0 ? Math.round((bar.value / bar.max) * 100) : 0;
                return (
                  <div
                    key={bar.key}
                    className="flex w-10 flex-col items-center gap-1"
                  >
                    <span className="text-[9px] font-black tabular-nums text-slate-500">
                      {formatNumber(bar.value)}
                    </span>
                    <div className="flex h-20 w-full items-end rounded-md bg-slate-100 dark:bg-slate-800">
                      <div
                        className={`w-full rounded-md bg-gradient-to-t ${bar.className} transition-all duration-500`}
                        style={{
                          height: `${Math.max(bar.value > 0 ? 8 : 0, pct)}%`,
                        }}
                      />
                    </div>
                    <span className="text-[8px] font-bold uppercase tracking-wider text-slate-400">
                      {bar.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-3 text-[9px] font-bold uppercase tracking-wider text-slate-400">
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-[#16263F]" /> Inventarios
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-amber-400" /> Filas
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-emerald-500" /> Bultos
        </span>
      </div>
    </section>
  );
}

function StatRow({
  stat,
  maxInventarios,
  maxFilas,
  maxBultos,
  isCurrentUser,
  prevPeriodLabel,
}: {
  stat: InventariadorStats;
  maxInventarios: number;
  maxFilas: number;
  maxBultos: number;
  isCurrentUser: boolean;
  prevPeriodLabel: string;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 sm:p-5 ${
        stat.isLeader
          ? "border-amber-200/80 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-950/20"
          : "border-slate-200/90 bg-white dark:border-slate-700 dark:bg-slate-900"
      } ${isCurrentUser ? "ring-2 ring-blue-400/50" : ""}`}
    >
      <div className="mb-4 flex items-center gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-black ${paletteForKey(stat.id)}`}
        >
          {avatarInitialsFromName(stat.name, null, null)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-black text-[#16263F] dark:text-slate-100">
              #{stat.rank} {stat.name}
            </p>
            {stat.isLeader && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                <Trophy className="h-3 w-3" aria-hidden />
                Líder
              </span>
            )}
            {isCurrentUser && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-blue-700 dark:bg-blue-900/50 dark:text-blue-200">
                Tú
              </span>
            )}
            <TrendBadge delta={stat.deltaInventarios} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
            {stat.lastActivityAt && (
              <span>
                Última actividad:{" "}
                {new Intl.DateTimeFormat("es-PA", {
                  dateStyle: "short",
                  timeStyle: "short",
                }).format(new Date(stat.lastActivityAt))}
              </span>
            )}
            <span className="tabular-nums text-amber-600 dark:text-amber-400">
              {formatNumber(stat.score)} pts
            </span>
            {stat.enProceso > 0 && (
              <span className="text-sky-600 dark:text-sky-400">
                {formatNumber(stat.enProceso)} en proceso
              </span>
            )}
          </div>
        </div>
        <div className="hidden shrink-0 sm:block">
          <Sparkline values={stat.activityByDay} />
        </div>
        <p className="text-xl font-black tabular-nums text-[#16263F] dark:text-white">
          {formatNumber(stat.inventarios)}
        </p>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <MixChip label="Rápido" count={stat.quickCount} tone="blue" />
        <MixChip label="Detallado" count={stat.detailedCount} tone="violet" />
        <MixChip label="Con refs" count={stat.modeWith} tone="emerald" />
        <MixChip label="Sin refs" count={stat.modeWithout} tone="amber" />
        <MixChip label="Paletizado" count={stat.modePalletized} tone="slate" />
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-slate-50 px-2.5 py-2 dark:bg-slate-800/60">
          <p className="text-[8px] font-black uppercase tracking-wider text-slate-400">
            Filas / RA
          </p>
          <p className="text-sm font-black tabular-nums text-[#16263F] dark:text-slate-100">
            {stat.avgFilasPorInventario}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 px-2.5 py-2 dark:bg-slate-800/60">
          <p className="text-[8px] font-black uppercase tracking-wider text-slate-400">
            Bultos / RA
          </p>
          <p className="text-sm font-black tabular-nums text-[#16263F] dark:text-slate-100">
            {stat.avgBultosPorInventario}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 px-2.5 py-2 dark:bg-slate-800/60">
          <p className="text-[8px] font-black uppercase tracking-wider text-slate-400">
            Tiempo activo prom.
          </p>
          <p className="text-sm font-black tabular-nums text-[#16263F] dark:text-slate-100">
            {stat.avgActiveMinutes != null
              ? `${stat.avgActiveMinutes} min`
              : "—"}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 px-2.5 py-2 dark:bg-slate-800/60">
          <p className="text-[8px] font-black uppercase tracking-wider text-slate-400">
            vs {prevPeriodLabel.split("·")[0]?.trim() || "anterior"}
          </p>
          <p className="text-sm font-black tabular-nums text-[#16263F] dark:text-slate-100">
            {formatDelta(stat.deltaInventarios)} inv
          </p>
        </div>
      </div>

      <div className="mb-3 flex justify-center sm:hidden">
        <Sparkline values={stat.activityByDay} />
      </div>

      <div className="space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1">
              <ClipboardCheck className="h-3 w-3" aria-hidden />
              Inventarios
            </span>
            <span>
              {formatNumber(stat.inventarios)} · {stat.shareInventarios}%
            </span>
          </div>
          <ProgressBar value={stat.inventarios} max={maxInventarios} tone="blue" />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1">
              <Layers className="h-3 w-3" aria-hidden />
              Filas
            </span>
            <span>
              {formatNumber(stat.filas)} · {stat.shareFilas}%
            </span>
          </div>
          <ProgressBar value={stat.filas} max={maxFilas} tone="amber" />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1">
              <Package className="h-3 w-3" aria-hidden />
              Bultos
            </span>
            <span>
              {formatNumber(stat.bultos)} · {stat.shareBultos}%
            </span>
          </div>
          <ProgressBar value={stat.bultos} max={maxBultos} tone="emerald" />
        </div>
      </div>
    </div>
  );
}

export function InventoryLeaderboardModule({
  tasks,
  userDisplayName,
  userEmail,
}: InventoryLeaderboardModuleProps) {
  const [period, setPeriod] = useState<LeaderboardPeriod>("day");
  const [currentTime, setCurrentTime] = useState("");
  const [currentDate, setCurrentDate] = useState("");

  const currentUserId = useMemo(
    () => isCurrentUserInventariador(userDisplayName, userEmail),
    [userDisplayName, userEmail],
  );

  const result = useMemo(
    () => computeInventoryLeaderboard(tasks, period),
    [tasks, period],
  );

  const maxInventarios = Math.max(1, ...result.stats.map((s) => s.inventarios));
  const maxFilas = Math.max(1, ...result.stats.map((s) => s.filas));
  const maxBultos = Math.max(1, ...result.stats.map((s) => s.bultos));

  const leader = result.stats.find((s) => s.isLeader);

  const podiumStats = useMemo(() => {
    const sorted = [...result.stats].sort((a, b) => a.rank - b.rank);
    return PODIUM_ORDER.map((idx) => sorted[idx]).filter(
      Boolean,
    ) as InventariadorStats[];
  }, [result.stats]);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setCurrentTime(
        new Intl.DateTimeFormat("es-PA", {
          timeZone: "America/Panama",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }).format(now),
      );
      setCurrentDate(
        new Intl.DateTimeFormat("es-PA", {
          timeZone: "America/Panama",
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }).format(now),
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto p-4 sm:p-6 md:p-8">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#16263F] to-amber-500 text-white shadow-lg">
                <Trophy className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  Competencia del equipo
                </p>
                <h1 className="text-xl font-black tracking-tight text-[#16263F] dark:text-slate-100 sm:text-2xl md:text-3xl">
                  Ranking Inventariadores
                </h1>
              </div>
            </div>
            <p className="mt-2 text-sm font-semibold capitalize text-slate-600 dark:text-slate-300">
              {result.periodLabel}
            </p>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
              Comparado con: {result.prevPeriodLabel}
            </p>
          </div>

          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <div
              className="inline-flex max-w-full flex-wrap justify-end gap-1 rounded-2xl border border-slate-200 bg-slate-100/80 p-1 dark:border-slate-700 dark:bg-slate-900/70"
              role="group"
              aria-label="Período del ranking"
            >
              {LEADERBOARD_PERIOD_OPTIONS.map((opt) => {
                const active = period === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setPeriod(opt.id)}
                    aria-pressed={active}
                    className={`rounded-full px-3 py-1.5 text-[9px] font-black uppercase tracking-wider transition sm:px-3.5 sm:text-[10px] ${
                      active
                        ? "bg-gradient-to-r from-[#16263F] to-blue-600 text-white shadow-sm"
                        : "text-slate-500 hover:text-[#16263F] dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <Clock3 className="h-4 w-4 text-slate-400" aria-hidden />
              <div className="leading-tight">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                  {currentDate}
                </p>
                <p className="text-xs font-black tabular-nums text-[#16263F] dark:text-slate-100">
                  {currentTime}
                </p>
              </div>
            </div>
          </div>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Inventarios
            </p>
            <p className="mt-1 text-xl font-black tabular-nums text-[#16263F] dark:text-white sm:text-2xl">
              {formatNumber(result.teamTotals.inventarios)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Filas
            </p>
            <p className="mt-1 text-xl font-black tabular-nums text-[#16263F] dark:text-white sm:text-2xl">
              {formatNumber(result.teamTotals.filas)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Bultos
            </p>
            <p className="mt-1 text-xl font-black tabular-nums text-[#16263F] dark:text-white sm:text-2xl">
              {formatNumber(result.teamTotals.bultos)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-4">
            <p className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              <Activity className="h-3 w-3" aria-hidden />
              En proceso
            </p>
            <p className="mt-1 text-xl font-black tabular-nums text-[#16263F] dark:text-white sm:text-2xl">
              {formatNumber(result.teamTotals.enProceso)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-4">
            <p className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              <Zap className="h-3 w-3" aria-hidden />
              Score líder
            </p>
            <p className="mt-1 text-xl font-black tabular-nums text-amber-600 dark:text-amber-400 sm:text-2xl">
              {leader ? formatNumber(leader.score) : "0"}
            </p>
            <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-400">
              {leader && (leader.inventarios > 0 || leader.filas > 0)
                ? leader.name
                : "Sin actividad"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-4">
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Variación equipo
            </p>
            <div className="mt-1.5">
              <TrendBadge delta={result.teamTotals.deltaInventarios} />
            </div>
            <p className="mt-1 text-[10px] font-semibold text-slate-400">
              Inv. vs período anterior
            </p>
          </div>
        </div>

        <section
          className="mb-8 rounded-[2rem] border border-slate-200/90 bg-gradient-to-b from-slate-50 to-white p-4 shadow-md dark:border-slate-700 dark:from-slate-900 dark:to-slate-950 sm:p-6"
          aria-label="Podio"
        >
          <p className="mb-4 text-center text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Podio del período
          </p>
          <div className="flex items-end justify-center gap-2 sm:gap-4">
            {podiumStats.map((stat, i) => (
              <PodiumCard
                key={stat.id}
                stat={stat}
                slotIndex={i as 0 | 1 | 2}
                isCurrentUser={stat.id === currentUserId}
              />
            ))}
          </div>
        </section>

        <CompareChart
          stats={result.stats}
          maxInventarios={maxInventarios}
          maxFilas={maxFilas}
          maxBultos={maxBultos}
        />

        <section className="space-y-4" aria-label="Detalle por inventariador">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Desglose detallado
          </p>
          {result.stats.map((stat) => (
            <StatRow
              key={stat.id}
              stat={stat}
              maxInventarios={maxInventarios}
              maxFilas={maxFilas}
              maxBultos={maxBultos}
              isCurrentUser={stat.id === currentUserId}
              prevPeriodLabel={result.prevPeriodLabel}
            />
          ))}
        </section>

        <p className="mt-8 text-center text-[11px] font-semibold leading-relaxed text-slate-500 dark:text-slate-400">
          Score = inventarios×100 + filas×2 + bultos. El podio sigue ordenado por
          inventarios (luego filas y bultos). La variación compara con{" "}
          {result.prevPeriodLabel}. Solo cuentan RAs donde el operador aparece como
          colaborador; en colaboración todos suman el crédito completo.
        </p>
      </div>
    </div>
  );
}
