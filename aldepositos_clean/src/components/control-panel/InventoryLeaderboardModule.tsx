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
} from "lucide-react";

import type { Task } from "@/lib/types/task";
import {
  computeInventoryLeaderboard,
  isCurrentUserInventariador,
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
  for (let i = 0; i < key.length; i++) h = (h + key.charCodeAt(i) * (i + 1)) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[h]!;
}

const PERIOD_OPTIONS: { id: LeaderboardPeriod; label: string }[] = [
  { id: "day", label: "Hoy" },
  { id: "week", label: "Semana" },
  { id: "month", label: "Mes" },
];

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

function StatRow({
  stat,
  maxInventarios,
  maxFilas,
  maxBultos,
  isCurrentUser,
}: {
  stat: InventariadorStats;
  maxInventarios: number;
  maxFilas: number;
  maxBultos: number;
  isCurrentUser: boolean;
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
          </div>
          {stat.lastActivityAt && (
            <p className="mt-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              Última actividad:{" "}
              {new Intl.DateTimeFormat("es-PA", {
                dateStyle: "short",
                timeStyle: "short",
              }).format(new Date(stat.lastActivityAt))}
            </p>
          )}
        </div>
        <p className="text-xl font-black tabular-nums text-[#16263F] dark:text-white">
          {formatNumber(stat.inventarios)}
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1">
              <ClipboardCheck className="h-3 w-3" aria-hidden />
              Inventarios
            </span>
            <span>{formatNumber(stat.inventarios)}</span>
          </div>
          <ProgressBar value={stat.inventarios} max={maxInventarios} tone="blue" />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1">
              <Layers className="h-3 w-3" aria-hidden />
              Filas
            </span>
            <span>{formatNumber(stat.filas)}</span>
          </div>
          <ProgressBar value={stat.filas} max={maxFilas} tone="amber" />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1">
              <Package className="h-3 w-3" aria-hidden />
              Bultos
            </span>
            <span>{formatNumber(stat.bultos)}</span>
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
    return PODIUM_ORDER.map((idx) => sorted[idx]).filter(Boolean) as InventariadorStats[];
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
          </div>

          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <div
              className="inline-flex rounded-full border border-slate-200 bg-slate-100/80 p-1 dark:border-slate-700 dark:bg-slate-900/70"
              role="group"
              aria-label="Período del ranking"
            >
              {PERIOD_OPTIONS.map((opt) => {
                const active = period === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setPeriod(opt.id)}
                    aria-pressed={active}
                    className={`rounded-full px-4 py-1.5 text-[10px] font-black uppercase tracking-wider transition ${
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

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Total inventarios
            </p>
            <p className="mt-1 text-2xl font-black tabular-nums text-[#16263F] dark:text-white">
              {formatNumber(result.teamTotals.inventarios)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Total filas
            </p>
            <p className="mt-1 text-2xl font-black tabular-nums text-[#16263F] dark:text-white">
              {formatNumber(result.teamTotals.filas)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Líder del período
            </p>
            <p className="mt-1 flex items-center gap-2 text-lg font-black text-[#16263F] dark:text-white">
              {leader && (leader.inventarios > 0 || leader.filas > 0) ? (
                <>
                  <Medal className="h-5 w-5 shrink-0 text-amber-500" aria-hidden />
                  {leader.name}
                </>
              ) : (
                <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                  Sin actividad aún
                </span>
              )}
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
            />
          ))}
        </section>

        <p className="mt-8 text-center text-[11px] font-semibold leading-relaxed text-slate-500 dark:text-slate-400">
          Solo cuentan RAs donde el operador aparece como colaborador. Datos anteriores
          al ingreso detallado pueden estar incompletos. En colaboración, todos los
          participantes suman el crédito completo.
        </p>
      </div>
    </div>
  );
}
