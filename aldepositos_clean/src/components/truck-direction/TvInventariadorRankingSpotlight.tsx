"use client";

/**
 * Ranking de inventariadores en el header de la TV.
 * Solo se muestra al disparar «Mostrar ranking» desde el panel.
 * Diseño minimalista y legible a distancia.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trophy } from "lucide-react";
import { fetchTasks } from "@/lib/supabase";
import {
  computeInventoryLeaderboard,
  type InventariadorStats,
} from "@/lib/inventoryLeaderboard";
import { avatarInitialsFromName } from "@/lib/viewerIdentity";
import { subscribeShowTvRanking } from "@/lib/tvRankingBroadcast";

const VISIBLE_MS = 36_000;
const REFRESH_TASKS_MS = 3 * 60 * 1000;

const PLACE = [
  {
    rank: "1",
    rankBg: "bg-[#16263F] text-amber-300",
    ring: "ring-amber-400/70",
    accent: "border-l-amber-400",
  },
  {
    rank: "2",
    rankBg: "bg-slate-600 text-white",
    ring: "ring-slate-300/80",
    accent: "border-l-slate-400",
  },
  {
    rank: "3",
    rankBg: "bg-orange-700/90 text-orange-100",
    ring: "ring-orange-400/60",
    accent: "border-l-orange-400",
  },
] as const;

function formatNumber(n: number): string {
  return new Intl.NumberFormat("es-PA").format(Math.round(n));
}

function RankCard({
  stat,
  index,
  visible,
}: {
  stat: InventariadorStats;
  index: number;
  visible: boolean;
}) {
  const place = PLACE[index] ?? PLACE[2]!;
  const firstName = stat.name.split(/\s+/)[0] ?? stat.name;

  return (
    <div
      className={`flex min-w-[10.5rem] items-center gap-2.5 rounded-xl border border-slate-200/90 border-l-[3px] bg-white px-3 py-2.5 shadow-sm transition-all duration-500 ease-out ${place.accent} ${
        visible
          ? "translate-y-0 opacity-100"
          : "translate-y-3 opacity-0"
      }`}
      style={{ transitionDelay: visible ? `${80 + index * 100}ms` : "0ms" }}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-black tabular-nums ${place.rankBg}`}
        aria-label={`Puesto ${place.rank}`}
      >
        {place.rank}
      </div>

      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-black text-[#16263F] ring-2 ring-offset-1 ${place.ring}`}
      >
        {avatarInitialsFromName(stat.name, null, null)}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-black tracking-tight text-[#16263F]">
          {firstName}
        </p>
        <p className="mt-0.5 text-[11px] font-semibold text-slate-600">
          <span className="text-base font-black tabular-nums text-[#16263F]">
            {formatNumber(stat.inventarios)}
          </span>{" "}
          <span className="font-bold uppercase tracking-wide text-slate-500">
            {stat.inventarios === 1 ? "inventario" : "inventarios"}
          </span>
        </p>
      </div>
    </div>
  );
}

export function TvInventariadorRankingSpotlight({
  onVisibilityChange,
}: {
  onVisibilityChange?: (visible: boolean) => void;
} = {}) {
  const [stats, setStats] = useState<InventariadorStats[]>([]);
  const [periodLabel, setPeriodLabel] = useState("Hoy");
  const [phase, setPhase] = useState<"hidden" | "enter" | "show" | "exit">(
    "hidden",
  );
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleRef = useRef(false);

  const refresh = useCallback(async (): Promise<InventariadorStats[]> => {
    try {
      const tasks = await fetchTasks({ includeMeasureData: false });
      const result = computeInventoryLeaderboard(tasks, "day");
      const top = result.stats.slice(0, 3);
      setStats(top);
      setPeriodLabel(result.periodLabel);
      return top;
    } catch (e) {
      console.warn("[TV ranking]", e);
      return [];
    }
  }, []);

  const clearTimers = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    hideTimerRef.current = null;
    exitTimerRef.current = null;
  };

  const showSpotlight = useCallback(async () => {
    clearTimers();
    const top = await refresh();
    if (top.length === 0) return;
    visibleRef.current = true;
    setPhase("enter");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setPhase("show"));
    });
    hideTimerRef.current = setTimeout(() => {
      setPhase("exit");
      exitTimerRef.current = setTimeout(() => {
        setPhase("hidden");
        visibleRef.current = false;
      }, 450);
    }, VISIBLE_MS);
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const refreshId = window.setInterval(() => {
      void refresh();
    }, REFRESH_TASKS_MS);

    const unsub = subscribeShowTvRanking(() => {
      void showSpotlight();
    });

    return () => {
      window.clearInterval(refreshId);
      unsub();
      clearTimers();
      visibleRef.current = false;
    };
  }, [refresh, showSpotlight]);

  const visible = phase === "enter" || phase === "show" || phase === "exit";
  const open = phase === "show";

  useEffect(() => {
    onVisibilityChange?.(visible);
    return () => onVisibilityChange?.(false);
  }, [visible, onVisibilityChange]);

  const title = useMemo(
    () => (periodLabel ? periodLabel : "Hoy"),
    [periodLabel],
  );

  if (!visible) {
    return null;
  }

  return (
    <div
      className={`flex min-w-0 max-w-full shrink justify-start transition-opacity duration-400 ${
        open ? "opacity-100" : "opacity-0"
      }`}
      role="status"
      aria-live="polite"
      aria-label={`Ranking inventariadores · ${title}`}
    >
      <div
        className={`flex max-w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2.5 shadow-md shadow-slate-200/60 transition-all duration-500 ${
          open ? "translate-x-0" : "translate-x-4"
        }`}
      >
        <div className="hidden shrink-0 items-center gap-2.5 border-r border-slate-200 pr-3 xl:flex">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#16263F] text-amber-300">
            <Trophy className="h-5 w-5" aria-hidden />
          </span>
          <div className="leading-tight">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
              Ranking
            </p>
            <p className="text-sm font-black text-[#16263F]">Inventariadores</p>
            <p className="text-[11px] font-semibold capitalize text-slate-500">
              {title}
            </p>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          {stats.map((stat, index) => (
            <RankCard
              key={stat.id}
              stat={stat}
              index={index}
              visible={open}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
