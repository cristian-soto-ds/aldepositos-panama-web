"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Users,
  Activity,
  Package,
  Truck,
  Search,
  Clock3,
  Boxes,
  ClipboardList,
  PackageCheck,
  Trophy,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";

import type { Task } from "@/lib/types/task";
import type { UserPreferences } from "@/lib/userPreferences";
import type { ReceptionTruck } from "@/lib/receptionLogistics/types";
import { useReceptionQueue } from "@/hooks/useReceptionQueue";
import {
  fetchCollectionOrderTabCounts,
  type CollectionOrderTabCounts,
} from "@/lib/collectionOrders";
import { RECEPTION_STATUS } from "@/lib/receptionLogistics/config";
import {
  isIsoInPanamaRange,
  panamaDayBounds,
} from "@/lib/receptionLogistics/receptionReportFilter";
import {
  subscribeWorkPresence,
  type WorkPresenceEntry,
} from "@/lib/panelPresence";
import {
  avatarInitialsFromName,
  peerPresenceVisibleName,
} from "@/lib/viewerIdentity";
import { isAllowedInventoryOperator } from "@/lib/inventoryOperatorsAllowlist";
import { LivePanelClock } from "@/components/ui/LivePanelClock";
import { publishShowTvRanking } from "@/lib/tvRankingBroadcast";

type ControlPanelHomeProps = {
  tasks: Task[];
  onImport: (tasks: Task[]) => void;
  openManualModal: () => void;
  userDisplayName: string | null;
  profileFullName?: string | null;
  userEmail?: string | null;
  userAvatarSrc?: string | null;
  preferences?: UserPreferences;
  /** Abre un módulo del menú (las tarjetas del flujo son accesos directos). */
  onNavigate?: (view: string) => void;
};

/** Filas visibles de actividad antes de «Mostrar más». */
const ACTIVITY_PREVIEW_COUNT = 6;
const ACTIVITY_MAX_COUNT = 50;
const CONNECTED_PREVIEW_COUNT = 5;

function formatNumber(n: number): string {
  return new Intl.NumberFormat("es-PA").format(Math.round(n));
}

function statusLabel(status: string): string {
  if (status === "completed") return "Completado";
  if (status === "in_progress") return "En proceso";
  if (status === "partial") return "En proceso";
  if (status === "paused") return "En pausa";
  if (status === "pending") return "Pendiente";
  return status || "—";
}

function statusPillClass(status: string): string {
  if (status === "in_progress" || status === "partial") {
    return "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-800";
  }
  if (status === "paused") {
    return "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800";
  }
  return "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700";
}

function moduleShort(t: WorkPresenceEntry["module"]): string {
  if (t === "quick") return "Inventarios";
  if (t === "detailed") return "Detallado";
  if (t === "airway") return "Inventarios";
  if (t === "none") return "Panel";
  return "—";
}

const AVATAR_PALETTES = [
  "bg-[#16263F] text-white",
  "bg-slate-700 text-white",
  "bg-slate-600 text-white",
  "bg-[#1a3558] text-white",
  "bg-slate-500 text-white",
  "bg-[#243b5c] text-white",
];

function paletteForKey(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h + key.charCodeAt(i) * (i + 1)) % AVATAR_PALETTES.length;
  return AVATAR_PALETTES[h]!;
}

function hasAnyRowData(row: Record<string, unknown>) {
  const keys = [
    "referencia",
    "bultos",
    "l",
    "w",
    "h",
    "descripcion",
    "unidadesPorBulto",
    "pesoPorBulto",
    "referenciaContenedora",
    "reempaque",
  ];
  return keys.some((key) => {
    const value = row[key];
    if (value == null) return false;
    if (typeof value === "boolean") return value;
    return String(value).trim() !== "";
  });
}

function getRowRequiredChecks(row: Record<string, unknown>, moduleType: Task["type"]): boolean[] {
  const isReempaque = row.reempaque === true;
  const hasReferencia = String(row.referencia ?? "").trim().length > 0;
  const hasBultos = (parseFloat(String(row.bultos ?? 0)) || 0) > 0;
  const hasL = (parseFloat(String(row.l ?? 0)) || 0) > 0;
  const hasW = (parseFloat(String(row.w ?? 0)) || 0) > 0;
  const hasH = (parseFloat(String(row.h ?? 0)) || 0) > 0;
  const hasRefCont = String(row.referenciaContenedora ?? "").trim().length > 0;

  if (moduleType === "quick" || moduleType === "airway" || moduleType === "detailed") {
    if (isReempaque) return [hasReferencia, hasRefCont];
    return [hasReferencia, hasBultos, hasL, hasW, hasH];
  }

  return [hasReferencia, hasBultos, hasL, hasW, hasH];
}

function getRowProgressByModule(row: Record<string, unknown>, moduleType: Task["type"]) {
  const checks = getRowRequiredChecks(row, moduleType);
  if (checks.length === 0) return 0;
  const ok = checks.filter(Boolean).length;
  return Math.round((ok / checks.length) * 100);
}

function getTaskProgressPercent(task: Task): number {
  const expected = task.originalExpectedBultos ?? task.expectedBultos ?? 0;
  const current = task.currentBultos ?? 0;
  const bultosProgress =
    expected > 0 ? Math.min(100, Math.round((current / expected) * 100)) : 0;

  // Meta liviana (live/autosave) sin measureData completo.
  const rowCount = task.rowCount ?? 0;
  const completeRows = task.completeRowCount ?? 0;
  if (rowCount > 0 && (!Array.isArray(task.measureData) || task.measureData.length === 0)) {
    const rowProgress = Math.round((completeRows / rowCount) * 100);
    if (task.status === "completed") return 100;
    if (expected > 0) return Math.min(100, Math.min(rowProgress, bultosProgress) || bultosProgress);
    return Math.min(100, rowProgress);
  }

  const rows = Array.isArray(task.measureData)
    ? (task.measureData as Record<string, unknown>[])
    : [];
  const effectiveRows = rows.filter((row) => hasAnyRowData(row));
  const requiredDataProgress =
    effectiveRows.length > 0
      ? Math.round(
          effectiveRows.reduce(
            (acc, row) => acc + getRowProgressByModule(row, task.type),
            0,
          ) / effectiveRows.length,
        )
      : 0;

  if (effectiveRows.length === 0) return Math.min(100, bultosProgress);
  const strictProgress = Math.min(requiredDataProgress, bultosProgress);
  if (task.status === "completed") return 100;
  return Math.max(0, Math.min(100, strictProgress));
}

function completedAtIso(truck: ReceptionTruck): string | undefined {
  return truck.completedAt ?? truck.updatedAt;
}

function progressTone(pct: number): string {
  if (pct >= 90) return "text-emerald-500";
  if (pct >= 50) return "text-sky-500";
  if (pct > 0) return "text-amber-500";
  return "text-slate-300 dark:text-slate-600";
}

export function ControlPanelHome({
  tasks,
  userDisplayName,
  profileFullName = null,
  userEmail = null,
  userAvatarSrc = null,
  preferences,
  onNavigate,
}: ControlPanelHomeProps) {
  const headerAvatarSrc =
    (userAvatarSrc && userAvatarSrc.trim()) ||
    preferences?.avatarDataUrl ||
    null;
  const [presenceList, setPresenceList] = useState<WorkPresenceEntry[]>([]);
  const [filterStatus, setFilterStatus] = useState<"all" | "in_progress" | "pending">(
    "all",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [rankingFlash, setRankingFlash] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const showRankingOnTv = () => {
    publishShowTvRanking();
    setRankingFlash(true);
    window.setTimeout(() => setRankingFlash(false), 1800);
  };

  useEffect(() => {
    return subscribeWorkPresence(setPresenceList);
  }, []);

  // Presencia “en panel” la publica panel/page.tsx (evitar track duplicado → rate limit).

  // Tick lento solo para frescura de presencia (el reloj del header es hoja aislada).
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const ms = 30_000;
    let intervalId: number | undefined;
    const start = () => {
      if (intervalId != null) window.clearInterval(intervalId);
      intervalId = window.setInterval(tick, ms);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        tick();
        start();
      } else if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, []);

  const { trucks: receptionTrucks } = useReceptionQueue();
  const [collectionStats, setCollectionStats] = useState<CollectionOrderTabCounts>({
    total: 0,
    enBodega: 0,
    pendientes: 0,
  });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const counts = await fetchCollectionOrderTabCounts();
        if (alive) setCollectionStats(counts);
      } catch {
        /* Silencioso */
      }
    };
    void load();
    const intervalId = window.setInterval(() => void load(), 180_000);
    return () => {
      alive = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const receptionStats = useMemo(() => {
    const count = (status: string) =>
      receptionTrucks.filter((t: ReceptionTruck) => t.status === status).length;
    const enFila = count(RECEPTION_STATUS.EN_FILA);
    const enRampa =
      count(RECEPTION_STATUS.RAMPA_1) +
      count(RECEPTION_STATUS.RAMPA_2) +
      count(RECEPTION_STATUS.RAMPA_EXTRA);
    const carretillado = count(RECEPTION_STATUS.CARRETILLADO);
    const { start, endExclusive } = panamaDayBounds(new Date());
    const completadoHoy = receptionTrucks.filter(
      (t) =>
        t.status === RECEPTION_STATUS.COMPLETADO &&
        isIsoInPanamaRange(completedAtIso(t), start, endExclusive),
    ).length;
    return {
      enFila,
      enRampa,
      carretillado,
      completadoHoy,
      activos: enFila + enRampa + carretillado,
    };
  }, [receptionTrucks]);

  const dashboard = useMemo(() => {
    const total = tasks.length;
    const pending = tasks.filter((t) => t.status === "pending").length;
    const inProgress = tasks.filter(
      (t) => t.status === "in_progress" || t.status === "partial",
    ).length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const dispatched = tasks.filter((t) => t.dispatched === true).length;
    const readyToDispatch = tasks.filter(
      (t) => t.status === "completed" && t.dispatched !== true,
    ).length;
    const expectedBultos = tasks.reduce((a, t) => a + (t.expectedBultos || 0), 0);
    const currentBultos = tasks.reduce((a, t) => a + (t.currentBultos || 0), 0);

    const byType = {
      quick: tasks.filter(
        (t) => t.type === "quick" || t.type === "airway" || !t.type,
      ).length,
      detailed: tasks.filter((t) => t.type === "detailed").length,
    };

    const activeSorted = [...tasks]
      .filter((t) => !t.dispatched && t.status !== "completed")
      .sort((a, b) => {
        const score = (t: Task) => {
          if (t.status === "in_progress") return 0;
          if (t.status === "partial") return 1;
          if ((t.currentBultos || 0) > 0) return 2;
          return 3;
        };
        const ds = score(a) - score(b);
        if (ds !== 0) return ds;
        return String(b.ra).localeCompare(String(a.ra));
      });

    return {
      total,
      pending,
      inProgress,
      completed,
      dispatched,
      readyToDispatch,
      expectedBultos,
      currentBultos,
      byType,
      activeSorted,
    };
  }, [tasks]);

  const presenceGrouped = useMemo(() => {
    const map = new Map<
      string,
      { entries: WorkPresenceEntry[]; uniqueUsers: Set<string> }
    >();
    for (const e of presenceList) {
      // Solo inventariadores en «En captura ahora» (correctores no cuentan).
      if (!isAllowedInventoryOperator(e.userKey, e.userLabel)) continue;
      const raKey = String(e.ra || "").trim().toUpperCase();
      if (!raKey) continue;
      if (!map.has(raKey)) {
        map.set(raKey, { entries: [], uniqueUsers: new Set() });
      }
      const g = map.get(raKey)!;
      g.entries.push(e);
      g.uniqueUsers.add(e.userKey);
    }
    return Array.from(map.entries()).map(([raKey, g]) => ({
      raKey,
      entries: g.entries,
      operatorCount: g.uniqueUsers.size,
    }));
  }, [presenceList]);

  const presenceByRa = useMemo(() => {
    const m = new Map<
      string,
      { raKey: string; entries: WorkPresenceEntry[]; operatorCount: number }
    >();
    for (const g of presenceGrouped) {
      m.set(g.raKey, g);
    }
    return m;
  }, [presenceGrouped]);

  const connectedUsers = useMemo(() => {
    const nowTs = now.getTime();
    const fresh = presenceList.filter((p) => nowTs - p.updatedAt <= 45_000);
    const map = new Map<
      string,
      { userLabel: string; avatarUrl: string | null | undefined }
    >();
    for (const entry of fresh) {
      const prev = map.get(entry.userKey);
      const fromEntry = entry.avatarUrl?.trim();
      const av = fromEntry || prev?.avatarUrl;
      map.set(entry.userKey, {
        userLabel: entry.userLabel,
        avatarUrl: av,
      });
    }
    return Array.from(map.entries()).map(([userKey, v]) => ({
      userKey,
      userLabel: peerPresenceVisibleName(v.userLabel, userKey),
      avatarUrl: v.avatarUrl ?? null,
    }));
  }, [presenceList, now]);

  const searchedActive = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return dashboard.activeSorted;
    return dashboard.activeSorted.filter(
      (t) =>
        String(t.ra).toLowerCase().includes(q) ||
        String(t.mainClient || "").toLowerCase().includes(q) ||
        String(t.provider || "").toLowerCase().includes(q),
    );
  }, [dashboard.activeSorted, searchQuery]);

  const statusCounts = useMemo(
    () => ({
      all: searchedActive.length,
      in_progress: searchedActive.filter(
        (t) => t.status === "in_progress" || t.status === "partial",
      ).length,
      pending: searchedActive.filter((t) => t.status === "pending").length,
    }),
    [searchedActive],
  );

  const filteredActivity = useMemo(() => {
    if (filterStatus === "in_progress") {
      return searchedActive.filter(
        (t) => t.status === "in_progress" || t.status === "partial",
      );
    }
    if (filterStatus === "pending") {
      return searchedActive.filter((t) => t.status === "pending");
    }
    return searchedActive;
  }, [searchedActive, filterStatus]);

  const visibleActivity = filteredActivity.slice(
    0,
    showAllActivity ? ACTIVITY_MAX_COUNT : ACTIVITY_PREVIEW_COUNT,
  );
  const hiddenActivityCount =
    Math.min(filteredActivity.length, ACTIVITY_MAX_COUNT) - visibleActivity.length;

  const activeOrders = dashboard.pending + dashboard.inProgress;
  const bultosPct =
    dashboard.expectedBultos > 0
      ? Math.min(100, Math.round((dashboard.currentBultos / dashboard.expectedBultos) * 100))
      : 0;
  const completionPct =
    dashboard.total > 0
      ? Math.round((dashboard.completed / dashboard.total) * 100)
      : 0;

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Buenos días";
    if (hour < 18) return "Buenas tardes";
    return "Buenas noches";
  };

  const currentDate = new Date().toLocaleDateString("es-PA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const greetingFromProfile = profileFullName?.trim() ?? "";
  const greetingName =
    greetingFromProfile ||
    String(userDisplayName ?? "").trim() ||
    "Operador";

  const isDark = preferences?.theme === "dark";
  const cardClass = isDark
    ? "border-slate-700/80 bg-slate-900/90"
    : "border-slate-200/80 bg-white shadow-sm shadow-slate-200/50";

  const filterOptions = [
    { id: "all", label: "Todas", count: statusCounts.all },
    { id: "in_progress", label: "En proceso", count: statusCounts.in_progress },
    { id: "pending", label: "Pendientes", count: statusCounts.pending },
  ] as const;

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1400px] animate-fade overflow-x-hidden pb-8 sm:pb-10 dashfit:flex dashfit:h-full dashfit:min-h-0 dashfit:flex-col dashfit:overflow-hidden dashfit:pb-6">
      {/* Encabezado */}
      <header className="mb-6 flex shrink-0 flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between dashfit:mb-5">
        <div className="flex min-w-0 items-center gap-4 sm:gap-5">
          <div
            className={`relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-white sm:h-24 sm:w-24 sm:rounded-3xl lg:h-28 lg:w-28 ${
              isDark
                ? "border border-white/10 bg-[#16263F] shadow-lg shadow-black/30"
                : "border-2 border-white bg-[#16263F] shadow-md shadow-[#16263F]/15 ring-1 ring-slate-200/80"
            }`}
          >
            {headerAvatarSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={headerAvatarSrc}
                alt="Foto de perfil"
                className="h-full w-full object-cover object-center"
              />
            ) : (
              <span className="text-xl font-black tracking-wide sm:text-2xl lg:text-3xl" aria-hidden>
                {avatarInitialsFromName(profileFullName, userDisplayName, userEmail)}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-black leading-tight tracking-tight text-[#16263F] dark:text-slate-100 sm:text-3xl lg:text-4xl xl:text-[2.75rem]">
              {getGreeting()}, {greetingName}
            </h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm font-medium capitalize text-slate-500 dark:text-slate-400 sm:text-base">
              <span>{currentDate}</span>
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div
            className={`inline-flex h-11 items-center gap-2 rounded-xl border px-3.5 text-base font-semibold tabular-nums ${
              isDark
                ? "border-slate-700 bg-slate-900 text-slate-200"
                : "border-slate-200 bg-white text-[#16263F] shadow-sm"
            }`}
          >
            <Clock3 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <LivePanelClock
              showSeconds={preferences?.showSeconds === true}
              hour12={preferences?.timeFormat === "12h"}
              variant="inline"
            />
          </div>
          <button
            type="button"
            onClick={showRankingOnTv}
            title="Mostrar ranking de inventariadores en la pantalla TV"
            className={`inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${
              rankingFlash
                ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/25"
                : "bg-[#16263F] text-white shadow-md shadow-[#16263F]/20 hover:bg-[#1f3556]"
            }`}
          >
            <Trophy className="h-4 w-4 shrink-0" aria-hidden />
            <span className="hidden sm:inline">
              {rankingFlash ? "Enviado a TV" : "Ranking TV"}
            </span>
          </button>
        </div>
      </header>

      {/* Flujo operativo: una tarjeta por etapa (sin duplicar KPIs). */}
      <section className="mb-6 shrink-0 sm:mb-8 dashfit:mb-5" aria-label="Flujo operativo">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          <StageCard
            step={1}
            tone="violet"
            icon={<ClipboardList className="h-[18px] w-[18px]" />}
            title="Recolección"
            value={formatNumber(collectionStats.total)}
            valueLabel="órdenes registradas"
            stats={[
              { label: "Por llegar", value: collectionStats.pendientes },
              { label: "En bodega", value: collectionStats.enBodega },
            ]}
            cardClass={cardClass}
            onClick={onNavigate ? () => onNavigate("collection-orders") : undefined}
            showConnector
          />
          <StageCard
            step={2}
            tone="amber"
            icon={<Truck className="h-[18px] w-[18px]" />}
            title="Recepción"
            value={formatNumber(receptionStats.activos)}
            valueLabel={receptionStats.activos === 1 ? "camión en proceso" : "camiones en proceso"}
            stats={[
              { label: "En fila", value: receptionStats.enFila },
              { label: "En rampa", value: receptionStats.enRampa },
              { label: "Hoy", value: receptionStats.completadoHoy },
            ]}
            cardClass={cardClass}
            onClick={onNavigate ? () => onNavigate("receptionist") : undefined}
            showConnector
          />
          <StageCard
            step={3}
            tone="sky"
            icon={<Boxes className="h-[18px] w-[18px]" />}
            title="Inventario"
            value={formatNumber(activeOrders)}
            valueLabel="RAs activas"
            progress={{
              pct: bultosPct,
              label: `${formatNumber(dashboard.currentBultos)} / ${formatNumber(dashboard.expectedBultos)} bultos`,
            }}
            stats={[
              { label: "En proceso", value: dashboard.inProgress },
              { label: "Pendientes", value: dashboard.pending },
            ]}
            cardClass={cardClass}
            onClick={onNavigate ? () => onNavigate("quick-entry") : undefined}
            showConnector
          />
          <StageCard
            step={4}
            tone="emerald"
            icon={<PackageCheck className="h-[18px] w-[18px]" />}
            title="Salida"
            value={formatNumber(dashboard.dispatched)}
            valueLabel="RAs despachadas"
            stats={[
              { label: "Completadas", value: dashboard.completed },
              { label: "Por despachar", value: dashboard.readyToDispatch },
            ]}
            cardClass={cardClass}
            onClick={onNavigate ? () => onNavigate("reports") : undefined}
          />
        </div>
      </section>

      {/* Actividad + resumen */}
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-12 dashfit:min-h-0 dashfit:flex-1 dashfit:grid-rows-[minmax(0,1fr)]">
        <section
          className={`min-w-0 overflow-hidden rounded-2xl border xl:col-span-8 dashfit:flex dashfit:min-h-0 dashfit:flex-col ${cardClass}`}
        >
          <div className="flex shrink-0 flex-col gap-3 border-b border-slate-100 px-4 py-4 dark:border-slate-800 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#16263F] text-white shadow-sm">
                <Activity className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-[#16263F] dark:text-slate-100">
                  Actividad en depósito
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  RAs abiertas, de la más avanzada a la más nueva
                </p>
              </div>
            </div>
            <div
              className="inline-flex shrink-0 rounded-xl bg-slate-100 p-1 dark:bg-slate-800"
              role="group"
              aria-label="Filtrar por estado"
            >
              {filterOptions.map((opt) => {
                const active = filterStatus === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setFilterStatus(opt.id);
                      setShowAllActivity(false);
                    }}
                    aria-pressed={active}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? "bg-white text-[#16263F] shadow-sm dark:bg-slate-700 dark:text-white"
                        : "text-slate-500 hover:text-[#16263F] dark:text-slate-400 dark:hover:text-slate-200"
                    }`}
                  >
                    {opt.label}
                    <span
                      className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums leading-4 ${
                        active
                          ? "bg-[#16263F] text-white dark:bg-slate-500"
                          : "bg-slate-200/80 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                      }`}
                    >
                      {opt.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="shrink-0 space-y-3 px-4 pt-3 sm:px-5">
            <label className="flex h-10 items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50/60 px-3 transition focus-within:border-[#16263F]/40 focus-within:bg-white focus-within:ring-2 focus-within:ring-[#16263F]/10 dark:border-slate-700 dark:bg-slate-800/50 dark:focus-within:bg-slate-800">
              <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowAllActivity(false);
                }}
                placeholder="Buscar RA, cliente o proveedor"
                aria-label="Buscar RA, cliente o proveedor"
                className="min-w-0 flex-1 bg-transparent text-sm font-medium text-[#16263F] outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500 [&::-webkit-search-cancel-button]:hidden"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Limpiar búsqueda"
                  className="rounded-md p-0.5 text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </label>

            {presenceGrouped.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  <LiveDot />
                  En captura
                </span>
                {presenceGrouped.map(({ raKey, entries, operatorCount }) => (
                  <PresenceChip
                    key={raKey}
                    raKey={raKey}
                    entries={entries}
                    operatorCount={operatorCount}
                  />
                ))}
              </div>
            ) : null}
          </div>

          {visibleActivity.length === 0 ? (
            <div className="m-4 rounded-xl border border-dashed border-slate-200 px-4 py-12 text-center dark:border-slate-700 sm:m-5">
              <Package className="mx-auto mb-2 h-8 w-8 text-slate-300 dark:text-slate-600" aria-hidden />
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                {searchQuery.trim()
                  ? `Sin resultados para «${searchQuery.trim()}»`
                  : "No hay RAs en este filtro."}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 px-2 py-2 dark:divide-slate-800 sm:px-3 dashfit:min-h-0 dashfit:flex-1 dashfit:overflow-y-auto">

              {visibleActivity.map((t) => {
                const taskProgress = getTaskProgressPercent(t);
                const raK = String(t.ra || "").trim().toUpperCase();
                const pres = presenceByRa.get(raK);
                const liveLabels = pres
                  ? Array.from(
                      new Map(
                        pres.entries.map((e) => [
                          e.userKey,
                          peerPresenceVisibleName(e.userLabel, e.userKey),
                        ]),
                      ).values(),
                    )
                  : [];
                const hasBultos =
                  (t.currentBultos || 0) > 0 || (t.expectedBultos || 0) > 0;
                return (
                  <li
                    key={t.id}
                    className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/50 sm:gap-4"
                  >
                    <ProgressRing pct={taskProgress} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-bold text-[#16263F] dark:text-slate-100">
                          RA {t.ra}
                        </span>
                        <span
                          className={`rounded-full px-2 py-px text-[10px] font-semibold ring-1 ring-inset ${statusPillClass(t.status)}`}
                        >
                          {statusLabel(t.status)}
                        </span>
                        {t.type === "detailed" ? (
                          <span className="rounded-full bg-violet-50 px-2 py-px text-[10px] font-semibold text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-800">
                            Detallado
                          </span>
                        ) : null}
                        {liveLabels.length > 0 ? (
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-px text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800"
                            title={`En vivo: ${liveLabels.join(", ")}`}
                          >
                            <LiveDot />
                            <span className="max-w-[10rem] truncate">{liveLabels.join(", ")}</span>
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                        {t.mainClient || "Sin cliente"}
                        <span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span>
                        {t.provider || "—"}
                      </p>
                    </div>
                    <div className="hidden shrink-0 text-right sm:block">
                      <p className="text-sm font-bold tabular-nums text-[#16263F] dark:text-slate-100">
                        {hasBultos ? `${t.currentBultos || 0}/${t.expectedBultos || 0}` : "—"}
                      </p>
                      <p className="text-[11px] text-slate-400">bultos</p>
                    </div>
                    <div className="hidden w-24 shrink-0 text-right md:block">
                      <p className="text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300">
                        {(t.capturedWeight || 0) > 0 ? `${t.capturedWeight} kg` : "—"}
                      </p>
                      <p className="text-[11px] tabular-nums text-slate-400">
                        {(t.completeRowCount || 0) > 0
                          ? `${t.completeRowCount}/${t.rowCount || t.completeRowCount} líneas`
                          : "sin líneas"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {hiddenActivityCount > 0 || showAllActivity ? (
            <div className="shrink-0 border-t border-slate-100 px-4 py-2.5 dark:border-slate-800 sm:px-5">
              <button
                type="button"
                onClick={() => setShowAllActivity((v) => !v)}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-[#16263F] dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {showAllActivity
                  ? "Mostrar menos"
                  : `Mostrar ${formatNumber(hiddenActivityCount)} más`}
                <ChevronDown
                  className={`h-4 w-4 transition ${showAllActivity ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>
            </div>
          ) : null}
        </section>

        <aside className="hide-scrollbar min-w-0 space-y-4 sm:space-y-5 xl:col-span-4 dashfit:min-h-0 dashfit:overflow-y-auto">
          <ConnectedCard
            users={connectedUsers}
            userEmail={userEmail}
            localAvatar={preferences?.avatarDataUrl ?? null}
            cardClass={cardClass}
          />

          <div className={`rounded-2xl border p-4 sm:p-5 ${cardClass}`}>
            <h3 className="text-sm font-bold text-[#16263F] dark:text-slate-100">
              Estado de RAs
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {formatNumber(dashboard.total)} RAs en el sistema
            </p>
            <div className="mt-4 flex items-center gap-5">
              <ProgressRing
                pct={completionPct}
                size={88}
                stroke={9}
                toneClass="text-emerald-500"
                labelClass="text-lg"
                caption="cerradas"
              />
              <dl className="min-w-0 flex-1 space-y-2">
                <LegendRow
                  color="bg-emerald-500"
                  label="Completadas"
                  value={dashboard.completed}
                />
                <LegendRow
                  color="bg-sky-500"
                  label="En proceso"
                  value={dashboard.inProgress}
                />
                <LegendRow
                  color="bg-slate-300 dark:bg-slate-600"
                  label="Pendientes"
                  value={dashboard.pending}
                />
              </dl>
            </div>
            <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
              <ModuleSplitBar
                quick={dashboard.byType.quick}
                detailed={dashboard.byType.detailed}
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

type StageTone = "violet" | "amber" | "sky" | "emerald";

const STAGE_TONES: Record<
  StageTone,
  { icon: string; accent: string; bar: string; step: string }
> = {
  violet: {
    icon: "bg-violet-50 text-violet-600 ring-violet-100 dark:bg-violet-950/50 dark:text-violet-300 dark:ring-violet-900",
    accent: "from-violet-500 to-indigo-500",
    bar: "bg-violet-500",
    step: "text-violet-500",
  },
  amber: {
    icon: "bg-amber-50 text-amber-600 ring-amber-100 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900",
    accent: "from-amber-400 to-orange-500",
    bar: "bg-amber-500",
    step: "text-amber-500",
  },
  sky: {
    icon: "bg-sky-50 text-sky-600 ring-sky-100 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-900",
    accent: "from-sky-400 to-blue-500",
    bar: "bg-sky-500",
    step: "text-sky-500",
  },
  emerald: {
    icon: "bg-emerald-50 text-emerald-600 ring-emerald-100 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900",
    accent: "from-emerald-400 to-teal-500",
    bar: "bg-emerald-500",
    step: "text-emerald-500",
  },
};

function StageCard({
  step,
  tone,
  icon,
  title,
  value,
  valueLabel,
  stats,
  progress,
  cardClass,
  onClick,
  showConnector = false,
}: {
  step: number;
  tone: StageTone;
  icon: React.ReactNode;
  title: string;
  value: string;
  valueLabel: string;
  stats: { label: string; value: number }[];
  progress?: { pct: number; label: string };
  cardClass: string;
  onClick?: () => void;
  showConnector?: boolean;
}) {
  const t = STAGE_TONES[tone];
  const body = (
    <>
      <span
        className={`pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${t.accent}`}
        aria-hidden
      />
      <div className="flex items-center gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ${t.icon}`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-[10px] font-bold uppercase tracking-[0.14em] ${t.step}`}>
            Paso {step}
          </p>
          <p className="truncate text-sm font-bold text-[#16263F] dark:text-slate-100">{title}</p>
        </div>
        {onClick ? (
          <ArrowUpRight
            className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#16263F] dark:text-slate-600 dark:group-hover:text-slate-200"
            aria-hidden
          />
        ) : null}
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-3xl font-black tabular-nums tracking-tight text-[#16263F] dark:text-slate-100">
          {value}
        </span>
        <span className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">
          {valueLabel}
        </span>
      </div>

      {progress ? (
        <div className="mt-2.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className={`h-full rounded-full ${t.bar} transition-all`}
              style={{ width: `${progress.pct}%` }}
            />
          </div>
          <p className="mt-1 flex justify-between text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
            <span className="truncate">{progress.label}</span>
            <span className="font-semibold text-slate-700 dark:text-slate-200">{progress.pct}%</span>
          </p>
        </div>
      ) : null}

      <div className="flex-1" aria-hidden />
      <dl
        className={`grid w-full divide-x divide-slate-100 border-t border-slate-100 pt-3 dark:divide-slate-800 dark:border-slate-800 ${
          progress ? "mt-3" : "mt-4"
        } ${stats.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}
      >
        {stats.map((s) => (
          <div key={s.label} className="min-w-0 px-2 first:pl-0 last:pr-0">
            <dd className="text-base font-bold tabular-nums text-[#16263F] dark:text-slate-100">
              {formatNumber(s.value)}
            </dd>
            <dt className="truncate text-[11px] text-slate-500 dark:text-slate-400">{s.label}</dt>
          </div>
        ))}
      </dl>
    </>
  );

  const shell = `group relative flex h-full flex-col overflow-hidden rounded-2xl border p-4 pt-5 text-left transition ${cardClass}`;

  return (
    <div className="relative">
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          title={`Abrir ${title}`}
          className={`${shell} w-full hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#16263F]/30`}
        >
          {body}
        </button>
      ) : (
        <div className={shell}>{body}</div>
      )}
      {showConnector ? (
        <span
          className="pointer-events-none absolute -right-[22px] top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm dark:border-slate-700 dark:bg-slate-900 xl:flex"
          aria-hidden
        >
          <ChevronRight className="h-4 w-4" />
        </span>
      ) : null}
    </div>
  );
}

function ProgressRing({
  pct,
  size = 40,
  stroke = 4,
  toneClass,
  labelClass = "text-[10px]",
  caption,
}: {
  pct: number;
  size?: number;
  stroke?: number;
  toneClass?: string;
  labelClass?: string;
  caption?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${clamped}%`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-slate-100 dark:stroke-slate-800"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped / 100)}
          className={`stroke-current transition-[stroke-dashoffset] duration-500 ${toneClass ?? progressTone(clamped)}`}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className={`font-bold tabular-nums text-[#16263F] dark:text-slate-100 ${labelClass}`}>
          {clamped}%
        </span>
        {caption ? (
          <span className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">{caption}</span>
        ) : null}
      </span>
    </div>
  );
}

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  );
}

function PresenceChip({
  raKey,
  entries,
  operatorCount,
}: {
  raKey: string;
  entries: WorkPresenceEntry[];
  operatorCount: number;
}) {
  const summary = entries
    .map((e) => {
      const name = peerPresenceVisibleName(e.userLabel, e.userKey);
      const pallet =
        typeof e.activePallet === "number" && e.activePallet >= 1
          ? ` · P${Math.floor(e.activePallet)}`
          : "";
      return `${name}${pallet} (${moduleShort(e.module)})`;
    })
    .join(" · ");
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/70 py-0.5 pl-2.5 pr-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
      title={summary}
    >
      RA {raKey}
      <span className="rounded-full bg-white px-1.5 text-[10px] font-bold tabular-nums text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200">
        {operatorCount} op
      </span>
    </span>
  );
}

function ConnectedCard({
  users,
  userEmail,
  localAvatar,
  cardClass,
}: {
  users: { userKey: string; userLabel: string; avatarUrl: string | null }[];
  userEmail: string | null;
  localAvatar: string | null;
  cardClass: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? users : users.slice(0, CONNECTED_PREVIEW_COUNT);
  const hidden = users.length - shown.length;

  const avatarFor = (u: { userKey: string; avatarUrl: string | null }) => {
    if (u.avatarUrl) return u.avatarUrl;
    const isSelf = !!userEmail && u.userKey.toLowerCase() === userEmail.toLowerCase();
    if (
      isSelf &&
      localAvatar &&
      (localAvatar.startsWith("http") || localAvatar.startsWith("data:"))
    ) {
      return localAvatar;
    }
    return null;
  };

  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${cardClass}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-[#16263F] dark:bg-slate-800 dark:text-slate-200">
            <Users className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h3 className="text-sm font-bold text-[#16263F] dark:text-slate-100">Conectados</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">En línea ahora</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold tabular-nums text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {users.length > 0 ? <LiveDot /> : null}
          {users.length}
        </span>
      </div>

      {users.length === 0 ? (
        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
          Nadie conectado en este momento.
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {shown.map((u) => {
            const imgSrc = avatarFor(u);
            return (
              <li
                key={u.userKey}
                className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <span className="relative shrink-0">
                  <span
                    className={`flex h-8 w-8 items-center justify-center overflow-hidden rounded-full ring-2 ring-white dark:ring-slate-900 ${paletteForKey(
                      u.userKey,
                    )}`}
                  >
                    {imgSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imgSrc}
                        alt={`Avatar de ${u.userLabel}`}
                        className="h-full w-full object-cover object-center"
                      />
                    ) : (
                      <span className="text-[10px] font-black">
                        {avatarInitialsFromName(null, u.userLabel, null)}
                      </span>
                    )}
                  </span>
                  <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-500 dark:border-slate-900" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#16263F] dark:text-slate-100">
                  {u.userLabel}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {hidden > 0 || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 w-full rounded-lg py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-[#16263F] dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {expanded ? "Mostrar menos" : `Ver ${hidden} más`}
        </button>
      ) : null}
    </div>
  );
}

function LegendRow({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <dt className="flex min-w-0 items-center gap-2 text-slate-600 dark:text-slate-300">
        <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} aria-hidden />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="font-bold tabular-nums text-[#16263F] dark:text-slate-100">
        {formatNumber(value)}
      </dd>
    </div>
  );
}

function ModuleSplitBar({ quick, detailed }: { quick: number; detailed: number }) {
  const total = quick + detailed;
  const quickPct = total > 0 ? Math.round((quick / total) * 100) : 0;
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Por módulo
      </p>
      <div className="flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full bg-[#16263F] dark:bg-slate-300" style={{ width: `${quickPct}%` }} />
        <div
          className="h-full bg-violet-400"
          style={{ width: `${total > 0 ? 100 - quickPct : 0}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
        <span>
          Inventarios{" "}
          <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
            {formatNumber(quick)}
          </span>
        </span>
        <span>
          Detallado{" "}
          <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
            {formatNumber(detailed)}
          </span>
        </span>
      </div>
    </div>
  );
}
