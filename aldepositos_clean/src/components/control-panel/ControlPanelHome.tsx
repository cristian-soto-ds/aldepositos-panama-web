"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Users,
  Activity,
  Package,
  Truck,
  AlertCircle,
  Layers,
  BarChart3,
  Search,
  Clock3,
  Zap,
  Boxes,
  ClipboardList,
  TrendingUp,
} from "lucide-react";

import type { Task } from "@/lib/types/task";
import type { UserPreferences } from "@/lib/userPreferences";
import type { ReceptionTruck } from "@/lib/receptionLogistics/types";
import type { CollectionOrder } from "@/lib/types/collectionOrder";
import { useReceptionQueue } from "@/hooks/useReceptionQueue";
import { fetchCollectionOrders } from "@/lib/collectionOrders";
import { countOrdersForCollectionListTab } from "@/lib/collectionOrderListTabs";
import { RECEPTION_STATUS } from "@/lib/receptionLogistics/config";
import {
  clearWorkPresence,
  getSharedWorkPresenceTabId,
  publishWorkPresence,
  subscribeWorkPresence,
  type WorkPresenceEntry,
} from "@/lib/panelPresence";
import {
  avatarInitialsFromName,
  peerPresenceVisibleName,
} from "@/lib/viewerIdentity";

type ControlPanelHomeProps = {
  tasks: Task[];
  onImport: (tasks: Task[]) => void;
  openManualModal: () => void;
  userDisplayName: string | null;
  /** Nombre legible en `perfiles.nombre_completo` (Supabase); si existe, es el que usa el saludo. */
  profileFullName?: string | null;
  userEmail?: string | null;
  /** Avatar (URL pública o data URL); prioridad sobre preferences.avatarDataUrl en el saludo. */
  userAvatarSrc?: string | null;
  preferences?: UserPreferences;
};

function formatNumber(n: number): string {
  return new Intl.NumberFormat("es-PA").format(Math.round(n));
}

function moduleLabel(t: Task["type"]): string {
  if (t === "quick") return "Ingreso rápido";
  if (t === "detailed") return "Ingreso detallado";
  if (t === "airway") return "Ingreso rápido";
  return "Sin módulo";
}

function statusLabel(status: string): string {
  if (status === "completed") return "Completado";
  if (status === "in_progress") return "En proceso";
  if (status === "partial") return "En proceso";
  if (status === "pending") return "Pendiente";
  return status || "—";
}

function moduleShort(t: WorkPresenceEntry["module"]): string {
  if (t === "quick") return "Rápido";
  if (t === "detailed") return "Detallado";
  if (t === "airway") return "Rápido";
  if (t === "none") return "Panel / sin RA";
  return "—";
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

export function ControlPanelHome({
  tasks,
  userDisplayName,
  profileFullName = null,
  userEmail = null,
  userAvatarSrc = null,
  preferences,
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
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    return subscribeWorkPresence(setPresenceList);
  }, []);

  useEffect(() => {
    const userKey = String(userEmail ?? "").trim().toLowerCase();
    if (!userKey) return;
    const tabId = getSharedWorkPresenceTabId();
    const label = peerPresenceVisibleName(userDisplayName || userKey, userKey);
    const pulse = () => {
      publishWorkPresence({
        tabId,
        userKey,
        userLabel: label,
        avatarUrl: userAvatarSrc || null,
        ra: "",
        module: "none",
      });
    };
    let intervalId: number | undefined;
    const start = () => {
      pulse();
      if (intervalId != null) window.clearInterval(intervalId);
      intervalId = window.setInterval(pulse, 12_000);
    };
    const stop = () => {
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
      void clearWorkPresence(tabId);
    };
  }, [userEmail, userDisplayName, userAvatarSrc]);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const ms = preferences?.showSeconds ? 1_000 : 60_000;
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
  }, [preferences?.showSeconds]);

  // Datos de los nuevos módulos para el resumen del panel.
  const { trucks: receptionTrucks } = useReceptionQueue();
  const [collectionOrders, setCollectionOrders] = useState<CollectionOrder[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const list = await fetchCollectionOrders();
        if (alive) setCollectionOrders(list);
      } catch {
        /* Silencioso: el panel sigue funcionando sin órdenes de recolección. */
      }
    };
    void load();
    const intervalId = window.setInterval(() => void load(), 30_000);
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
    const completado = count(RECEPTION_STATUS.COMPLETADO);
    return {
      total: receptionTrucks.length,
      enFila,
      enRampa,
      carretillado,
      completado,
      activos: enFila + enRampa + carretillado,
    };
  }, [receptionTrucks]);

  const collectionStats = useMemo(() => {
    const total = collectionOrders.length;
    const enBodega = countOrdersForCollectionListTab(collectionOrders, "warehouse");
    const pendientes = countOrdersForCollectionListTab(collectionOrders, "general");
    return { total, enBodega, pendientes };
  }, [collectionOrders]);

  const dashboard = useMemo(() => {
    const total = tasks.length;
    const pending = tasks.filter((t) => t.status === "pending").length;
    const inProgress = tasks.filter(
      (t) => t.status === "in_progress" || t.status === "partial",
    ).length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const dispatched = tasks.filter((t) => t.dispatched === true).length;
    const priority = tasks.filter(
      (t) =>
        t.status === "pending" &&
        (t.containerDraft === true || t.dispatched === true),
    ).length;
    const expectedBultos = tasks.reduce((a, t) => a + (t.expectedBultos || 0), 0);
    const currentBultos = tasks.reduce((a, t) => a + (t.currentBultos || 0), 0);

    const byType = {
      quick: tasks.filter(
        (t) => t.type === "quick" || t.type === "airway" || !t.type,
      ).length,
      detailed: tasks.filter((t) => t.type === "detailed").length,
      other: tasks.filter(
        (t) =>
          t.type &&
          t.type !== "quick" &&
          t.type !== "detailed" &&
          t.type !== "airway",
      ).length,
    };

    const sortedHighlight = [...tasks]
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
      })
      .slice(0, 12);

    return {
      total,
      pending,
      inProgress,
      completed,
      dispatched,
      priority,
      expectedBultos,
      currentBultos,
      byType,
      sortedHighlight,
    };
  }, [tasks]);

  const presenceGrouped = useMemo(() => {
    const map = new Map<
      string,
      { entries: WorkPresenceEntry[]; uniqueUsers: Set<string> }
    >();
    for (const e of presenceList) {
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
      connected: true,
    }));
  }, [presenceList, now]);

  const filteredHighlight = useMemo(() => {
    let list = dashboard.sortedHighlight;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (t) =>
          String(t.ra).toLowerCase().includes(q) ||
          String(t.mainClient || "").toLowerCase().includes(q) ||
          String(t.provider || "").toLowerCase().includes(q),
      );
    }
    if (filterStatus === "in_progress") {
      list = list.filter((t) => t.status === "in_progress" || t.status === "partial");
    }
    if (filterStatus === "pending") {
      list = list.filter((t) => t.status === "pending");
    }
    return list;
  }, [dashboard.sortedHighlight, searchQuery, filterStatus]);

  const activeOrders = dashboard.pending + dashboard.inProgress;
  const sharePending =
    dashboard.total > 0 ? Math.round((dashboard.pending / dashboard.total) * 100) : 0;
  const shareProgress =
    dashboard.total > 0 ? Math.round((dashboard.inProgress / dashboard.total) * 100) : 0;
  const shareDone =
    dashboard.total > 0 ? Math.round((dashboard.completed / dashboard.total) * 100) : 0;

  const sparkHeights = useMemo(() => {
    const t = dashboard.total || 1;
    const raw = [
      dashboard.pending,
      dashboard.inProgress,
      dashboard.completed,
      dashboard.dispatched,
      Math.max(0, t - dashboard.pending - dashboard.inProgress - dashboard.completed),
      dashboard.byType.quick,
      dashboard.byType.detailed,
    ];
    const max = Math.max(...raw, 1);
    return raw.map((n) => Math.round((n / max) * 100));
  }, [dashboard]);

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
  const currentTime = now.toLocaleTimeString("es-PA", {
    hour: "2-digit",
    minute: "2-digit",
    second: preferences?.showSeconds ? "2-digit" : undefined,
    hour12: preferences?.timeFormat === "12h",
  });

  const completionDonutPct =
    dashboard.total > 0
      ? Math.round((dashboard.completed / dashboard.total) * 100)
      : 0;
  const bultosPct =
    dashboard.expectedBultos > 0
      ? Math.min(100, Math.round((dashboard.currentBultos / dashboard.expectedBultos) * 100))
      : 0;
  const visibleModuleTotal =
    dashboard.byType.quick + dashboard.byType.detailed;
  const overallProgressPct =
    tasks.length > 0
      ? Math.round(
          tasks.reduce((acc, task) => acc + getTaskProgressPercent(task), 0) /
            tasks.length,
        )
      : 0;

  const greetingFromProfile = profileFullName?.trim() ?? "";
  const greetingName =
    greetingFromProfile ||
    String(userDisplayName ?? "").trim() ||
    "Operador";

  const isDark = preferences?.theme === "dark";

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1600px] animate-fade overflow-x-hidden pb-8 sm:pb-10">
      <div
        className={`relative min-w-0 overflow-hidden rounded-xl border p-3 shadow-md sm:rounded-2xl sm:p-4 md:rounded-[2rem] md:p-7 ${
          isDark
            ? "border-slate-700/70 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 shadow-[inset_6px_0_0_0_rgba(245,158,11,0.85)]"
            : "border-slate-200/80 bg-gradient-to-br from-white via-slate-50/95 to-slate-100/70 shadow-[inset_6px_0_0_0_#e8b84a]"
        }`}
      >
        <div
          className={`pointer-events-none absolute inset-0 opacity-[0.35] ${
            isDark
              ? "bg-[radial-gradient(ellipse_120%_80%_at_0%_-20%,rgba(59,130,246,0.14),transparent_50%),radial-gradient(ellipse_80%_60%_at_100%_0%,rgba(16,185,129,0.06),transparent_45%)]"
              : "bg-[radial-gradient(ellipse_100%_70%_at_0%_-10%,rgba(37,99,235,0.08),transparent_50%),radial-gradient(ellipse_70%_50%_at_100%_0%,rgba(22,38,63,0.05),transparent_40%)]"
          }`}
          aria-hidden
        />
        <div className="relative z-10 min-w-0">
        {/* Franja de operaciones */}
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-white/15 bg-gradient-to-r from-[#16263F] via-[#1a3558] to-blue-600/95 p-3 text-white shadow-md sm:mb-6 sm:gap-4 sm:rounded-2xl sm:p-4 md:flex-row md:items-center md:justify-between md:gap-6 md:p-5">
          <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFC400] text-[#16263F] shadow-md sm:h-11 sm:w-11 sm:rounded-2xl">
              <Zap className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#FFC400] sm:tracking-[0.24em]">
                Centro de operaciones
              </p>
              <p className="mt-0.5 text-pretty text-sm font-bold leading-snug text-blue-100 sm:text-base">
                Resumen en vivo de RAs, bultos y quién está capturando ahora.
              </p>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <span className="flex-1 rounded-full bg-white/12 px-3 py-1.5 text-center text-[10px] font-black uppercase tracking-wider text-white/95 backdrop-blur-sm sm:flex-none">
              {formatNumber(dashboard.total)} RAs en sistema
            </span>
            <span className="flex-1 rounded-full bg-emerald-400/20 px-3 py-1.5 text-center text-[10px] font-black uppercase tracking-wider text-emerald-50 sm:flex-none">
              {formatNumber(activeOrders)} activas
            </span>
          </div>
        </div>

        {/* Barra superior: título + búsqueda / filtro + acciones */}
        <header className="mb-5 flex min-w-0 flex-col gap-4 sm:mb-6 sm:gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:gap-4 md:gap-5">
            <div
              className={`relative mx-auto flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-white shadow-xl sm:mx-0 sm:h-20 sm:w-20 md:h-[112px] md:w-[112px] md:rounded-[1.35rem] lg:h-[120px] lg:w-[120px] lg:rounded-[1.5rem] ${
                isDark
                  ? "border border-white/10 bg-gradient-to-br from-slate-800 to-[#16263F] shadow-black/40 ring-2 ring-blue-500/25"
                  : "border-2 border-white bg-[#16263F] shadow-[0_12px_40px_rgba(22,38,63,0.22)] ring-2 ring-slate-200/80"
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
                <span className="text-lg font-black tracking-wide md:text-xl" aria-hidden>
                  {avatarInitialsFromName(
                    profileFullName,
                    userDisplayName,
                    userEmail,
                  )}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1 text-center sm:pt-0.5 sm:text-left">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] ${
                    isDark
                      ? "border border-slate-600/80 bg-slate-800/80 text-slate-300"
                      : "border border-slate-200 bg-white/90 text-slate-500 shadow-sm"
                  }`}
                >
                  Vista general
                </span>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 sm:tracking-[0.2em]">
                  {currentDate}
                </p>
              </div>
              <h1 className="mt-1.5 bg-gradient-to-r from-[#16263F] via-blue-700 to-blue-500 bg-clip-text text-xl font-black leading-tight tracking-tight text-transparent dark:from-white dark:via-sky-200 dark:to-blue-300 sm:text-2xl md:text-3xl md:leading-tight">
                Panel principal
              </h1>
              <p className="mt-1 text-pretty text-sm font-semibold leading-snug text-slate-600 dark:text-slate-300">
                {getGreeting()},{" "}
                <span className="text-[#16263F] dark:text-sky-300">{greetingName}</span>
              </p>
              <div
                className={`mt-3 inline-flex items-center gap-2 rounded-xl px-2.5 py-1.5 ${
                  isDark
                    ? "border border-slate-600/70 bg-slate-800/60 shadow-inner shadow-black/20"
                    : "border border-slate-200/90 bg-white shadow-sm"
                }`}
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#16263F] to-blue-700 text-white shadow-md shadow-blue-900/20">
                  <Clock3 className="h-3.5 w-3.5" />
                </span>
                <div className="leading-tight text-left">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                    Hora en vivo
                  </p>
                  <p className="text-xs font-black tabular-nums text-[#16263F] dark:text-slate-100">
                    {currentTime}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex w-full min-w-0 flex-col gap-2.5 sm:gap-3 lg:max-w-xl lg:flex-shrink-0">
            <div
              className={`flex w-full min-w-0 items-center gap-2 rounded-xl px-3 py-2.5 backdrop-blur-sm transition-shadow focus-within:ring-2 sm:rounded-2xl sm:px-4 md:rounded-full ${
                isDark
                  ? "border border-slate-600/80 bg-slate-800/70 focus-within:border-blue-500/50 focus-within:ring-blue-500/25"
                  : "border border-slate-200/90 bg-white/95 shadow-sm focus-within:border-blue-300/80 focus-within:ring-blue-500/20"
              }`}
            >
              <Search className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar RA, cliente o proveedor"
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#16263F] outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>
            <div
              className={`grid grid-cols-3 gap-1 rounded-full p-1 ${
                isDark ? "border border-slate-700 bg-slate-900/70" : "border border-slate-200 bg-slate-100/80"
              }`}
              role="group"
              aria-label="Filtrar por estado"
            >
              {([
                { id: "all", label: "Todos" },
                { id: "in_progress", label: "En proceso" },
                { id: "pending", label: "Pendiente" },
              ] as const).map((opt) => {
                const active = filterStatus === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setFilterStatus(opt.id)}
                    aria-pressed={active}
                    className={`rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition ${
                      active
                        ? "bg-gradient-to-r from-[#16263F] to-blue-600 text-white shadow-sm"
                        : isDark
                          ? "text-slate-400 hover:text-slate-200"
                          : "text-slate-500 hover:text-[#16263F]"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        {/* Hero resumen operativo + cierre de inventario */}
        <div className="mb-4 grid min-w-0 grid-cols-1 gap-3 sm:mb-5 sm:gap-4 lg:grid-cols-12 lg:gap-5">
          <div className="relative min-w-0 overflow-hidden rounded-xl border border-white/12 bg-gradient-to-br from-[#16263F] via-[#1a3a66] to-[#2563eb] p-4 text-white shadow-lg shadow-[#16263F]/15 sm:rounded-2xl sm:p-6 md:rounded-[2rem] md:p-8 lg:col-span-7">
            <div
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(105deg,transparent_40%,rgba(255,255,255,0.06)_50%,transparent_60%)]"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute -right-8 -top-8 h-52 w-52 rounded-full bg-white/12 blur-3xl"
              aria-hidden
            />
            <div className="pointer-events-none absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-emerald-400/10 blur-3xl" aria-hidden />
            <div className="relative z-10 flex min-w-0 flex-col gap-4 sm:gap-6 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-blue-200/90 sm:tracking-[0.25em]">
                  Resumen operativo
                </p>
                <p className="mt-2 text-3xl font-black tabular-nums tracking-tight sm:text-4xl md:text-5xl">
                  {formatNumber(activeOrders)}
                </p>
                <p className="mt-1 text-pretty text-sm font-semibold leading-snug text-blue-100/95">
                  órdenes activas (pendientes + en proceso) de {formatNumber(dashboard.total)} RAs
                </p>
              </div>
              <div className="flex min-w-0 flex-col items-stretch gap-2 sm:gap-3 md:items-end">
                <SparklineBars heights={sparkHeights} />
                <p className="text-[10px] font-bold uppercase tracking-wider text-blue-200/70 md:text-right">
                  Actividad relativa · reciente
                </p>
              </div>
            </div>

            {/* Progreso de bultos (Ingreso Rápido) */}
            <div className="relative z-10 mt-5 rounded-2xl border border-white/15 bg-white/10 p-3.5 backdrop-blur-sm sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-blue-100/90">
                  <Boxes className="h-4 w-4 text-[#FFC400]" aria-hidden /> Bultos capturados
                </span>
                <span className="text-sm font-black tabular-nums text-white">
                  {formatNumber(dashboard.currentBultos)}
                  <span className="text-blue-200/80"> / {formatNumber(dashboard.expectedBultos)}</span>
                </span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#FFC400] to-emerald-300 transition-all"
                  style={{ width: `${bultosPct}%` }}
                />
              </div>
            </div>

            <div className="relative z-10 mt-4 flex flex-wrap gap-2">
              <HeroChip label="Pendiente" value={`${sharePending}%`} />
              <HeroChip label="En proceso" value={`${shareProgress}%`} />
              <HeroChip label="Completado" value={`${shareDone}%`} />
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:col-span-5 lg:grid-cols-1">
            <div className="flex min-w-0 flex-row items-center gap-4 rounded-xl border border-slate-200/80 bg-white p-4 shadow-md shadow-slate-200/30 sm:gap-5 sm:rounded-2xl sm:p-5 md:rounded-[2rem] dark:border-slate-600/70 dark:bg-slate-900 dark:shadow-black/30">
              <DonutRing percent={completionDonutPct} />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  Cierre de inventario
                </p>
                <p className="mt-1 text-2xl font-black text-[#16263F] dark:text-slate-100">
                  {formatNumber(dashboard.completed)}
                  <span className="text-slate-400 dark:text-slate-500 text-lg font-bold"> / {formatNumber(dashboard.total)}</span>
                </p>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-1">
                  RAs completados en el sistema
                </p>
              </div>
            </div>
            <div className="grid min-w-0 grid-cols-2 gap-2 rounded-xl border border-slate-200/80 bg-white p-3 shadow-md shadow-slate-200/30 sm:gap-3 sm:rounded-2xl sm:p-4 md:rounded-[2rem] dark:border-slate-600/70 dark:bg-slate-900 dark:shadow-black/30">
              <MiniStat icon={<Truck className="h-3.5 w-3.5" />} label="Despachados" value={dashboard.dispatched} />
              <MiniStat icon={<AlertCircle className="h-3.5 w-3.5 text-red-500" />} label="Prioridad" value={dashboard.priority} />
              <MiniStat icon={<TrendingUp className="h-3.5 w-3.5" />} label="Progreso real" value={`${overallProgressPct}%`} />
              <MiniStat icon={<Users className="h-3.5 w-3.5" />} label="En vivo" value={presenceGrouped.length} />
            </div>
          </div>
        </div>

        {/* Flujo del depósito: módulos conectados */}
        <div className="mb-5 sm:mb-6">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-4 w-1 rounded-full bg-[#FFC400]" aria-hidden />
            <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-[#16263F] dark:text-slate-200">
              Flujo del depósito
            </h2>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:gap-4 md:grid-cols-3">
            <ModuleFlowCard
              icon={<ClipboardList className="h-5 w-5" aria-hidden />}
              accent="from-amber-400 to-amber-500"
              tint="bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
              title="Órdenes de recolección"
              headline={formatNumber(collectionStats.total)}
              headlineLabel="órdenes registradas"
              chips={[
                { label: "En bodega", value: collectionStats.enBodega, tone: "emerald" },
                { label: "Por llegar", value: collectionStats.pendientes, tone: "slate" },
              ]}
            />
            <ModuleFlowCard
              icon={<Truck className="h-5 w-5" aria-hidden />}
              accent="from-sky-500 to-blue-600"
              tint="bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
              title="Recepción de camiones"
              headline={formatNumber(receptionStats.activos)}
              headlineLabel="camiones en proceso"
              chips={[
                { label: "En fila", value: receptionStats.enFila, tone: "amber" },
                { label: "En rampa", value: receptionStats.enRampa, tone: "sky" },
                { label: "Completados", value: receptionStats.completado, tone: "emerald" },
              ]}
            />
            <ModuleFlowCard
              icon={<Boxes className="h-5 w-5" aria-hidden />}
              accent="from-emerald-500 to-teal-500"
              tint="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
              title="Ingreso de inventario"
              headline={formatNumber(activeOrders)}
              headlineLabel="RAs activas por capturar"
              chips={[
                { label: "Rápido", value: dashboard.byType.quick, tone: "sky" },
                { label: "Detallado", value: dashboard.byType.detailed, tone: "violet" },
              ]}
            />
          </div>
        </div>

        {/* Contenido principal: lista + lateral */}
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-12">
          <section className="min-w-0 rounded-xl border border-slate-200/80 bg-white p-4 shadow-md shadow-slate-200/25 sm:rounded-2xl sm:p-5 md:rounded-[2rem] md:p-6 xl:col-span-8 dark:border-slate-600/70 dark:bg-slate-900 dark:shadow-black/25">
            <div className="mb-5 flex flex-col gap-3 border-b border-slate-100 pb-4 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[#16263F] to-blue-700 text-white shadow-md shadow-blue-900/25">
                  <Activity className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h2 className="text-sm font-black uppercase tracking-widest text-[#16263F] dark:text-slate-100">
                    Actividad en depósito
                  </h2>
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Quién trabaja qué · mismo RA
                  </p>
                </div>
              </div>
            </div>

            {presenceGrouped.length > 0 && (
              <div className="mb-5 rounded-2xl border border-blue-200/80 bg-gradient-to-br from-blue-50 to-white p-3.5 dark:border-blue-900/50 dark:from-blue-950/60 dark:to-slate-900/80">
                <p className="text-[10px] font-black uppercase tracking-wider text-blue-800 mb-2">
                  En captura ahora (esta sesión)
                </p>
                <div className="space-y-2">
                  {presenceGrouped.map(({ raKey, entries, operatorCount }) => (
                    <ActivityPresenceRow
                      key={raKey}
                      raKey={raKey}
                      entries={entries}
                      operatorCount={operatorCount}
                    />
                  ))}
                </div>
              </div>
            )}

            {filteredHighlight.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/90 px-4 py-14 text-center dark:border-slate-600 dark:bg-slate-800/60">
                <Package className="mx-auto mb-3 h-10 w-10 text-slate-300 dark:text-slate-600" aria-hidden />
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                  No hay órdenes que coincidan con el filtro o la búsqueda.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {filteredHighlight.map((t) => {
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
                  return (
                    <li
                      key={t.id}
                      className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50/40 px-4 py-4 transition-colors hover:border-slate-200 hover:bg-white dark:border-slate-800 dark:bg-slate-800/30 dark:hover:border-slate-600 dark:hover:bg-slate-800/60 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-black text-[#16263F] dark:text-slate-100">RA {t.ra}</span>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-600 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
                              {moduleLabel(t.type)}
                            </span>
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                t.status === "pending"
                                  ? "border border-amber-200/80 bg-amber-100 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-100"
                                  : "border border-sky-200/80 bg-sky-100 text-sky-950 dark:border-sky-800/60 dark:bg-sky-950/45 dark:text-sky-100"
                              }`}
                            >
                              {statusLabel(t.status)}
                            </span>
                            {pres && pres.operatorCount > 1 ? (
                              <span className="rounded-full bg-amber-500/15 text-amber-900 border border-amber-200 px-2 py-0.5 text-[9px] font-black uppercase">
                                Varios operadores
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400 truncate">
                            {t.mainClient || "Sin cliente"} · {t.provider || "—"}
                          </p>
                          <p className="mt-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">
                            {liveLabels.length > 0
                              ? `En vivo: ${liveLabels.join(" · ")}`
                              : "En vivo: sin captura activa"}
                          </p>
                      </div>
                      <div className="flex w-full items-center gap-3 sm:w-auto md:min-w-[200px]">
                        <div className="flex-1 md:flex-none md:w-36">
                          <div className="flex justify-between text-[9px] font-black uppercase text-slate-400 dark:text-slate-500 mb-1">
                            <span>Progreso</span>
                            <span>{taskProgress}%</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all"
                              style={{ width: `${taskProgress}%` }}
                            />
                          </div>
                        </div>
                        <div className="hidden sm:flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700 text-slate-400 dark:text-slate-500">
                          <Package className="h-5 w-5" aria-hidden />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-5 flex flex-wrap items-start gap-3 rounded-2xl border border-blue-200/70 bg-blue-50/90 p-3.5 dark:border-blue-900/45 dark:bg-blue-950/50 md:p-4">
              <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs font-semibold text-blue-900 leading-relaxed">
                <span className="font-black">Colaboración:</span> varias personas pueden
                intervenir el mismo RA. <strong>Conectados ahora</strong> y{" "}
                <strong>En captura ahora</strong> se sincronizan por Supabase Realtime
                entre equipos y navegadores.
              </p>
            </div>
          </section>

          <aside className="min-w-0 space-y-3 sm:space-y-4 xl:col-span-4">
            <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-md shadow-slate-200/30 sm:rounded-2xl sm:p-5 md:rounded-[2rem] dark:border-slate-600/70 dark:bg-slate-900 dark:shadow-black/25">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-950/80 dark:text-violet-300">
                  <BarChart3 className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="text-xs font-black uppercase tracking-widest text-[#16263F] dark:text-slate-100">
                  Por módulo
                </h3>
              </div>
              <div className="space-y-4">
                <SidebarBar
                  label="Rápido"
                  count={dashboard.byType.quick}
                  total={visibleModuleTotal}
                  color="bg-blue-500"
                />
                <SidebarBar
                  label="Detallado"
                  count={dashboard.byType.detailed}
                  total={visibleModuleTotal}
                  color="bg-purple-500"
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-md shadow-slate-200/30 sm:rounded-2xl sm:p-5 md:rounded-[2rem] dark:border-slate-600/70 dark:bg-slate-900 dark:shadow-black/25">
              <div className="mb-3 flex items-center gap-3 sm:mb-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-sky-800 dark:bg-sky-950/80 dark:text-sky-300">
                  <Layers className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="text-xs font-black uppercase tracking-widest text-[#16263F] dark:text-slate-100">
                  Progreso general
                </h3>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#16263F] via-blue-600 to-sky-400 transition-all shadow-sm"
                  style={{ width: `${overallProgressPct}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {overallProgressPct}% promedio según avance real por RA.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-md shadow-slate-200/30 sm:rounded-2xl sm:p-5 md:rounded-[2rem] dark:border-slate-600/70 dark:bg-slate-900 dark:shadow-black/25">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                    <Users className="h-5 w-5" aria-hidden />
                  </span>
                  <h3 className="text-xs font-black uppercase tracking-widest text-[#16263F] dark:text-slate-100">
                    Conectados ahora
                  </h3>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  {connectedUsers.length}
                </span>
              </div>
              {connectedUsers.length === 0 ? (
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  No hay usuarios activos en captura.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {connectedUsers.map((u) => {
                    const fallbackLocal =
                      userEmail &&
                      u.userKey.toLowerCase() === userEmail.toLowerCase()
                        ? preferences?.avatarDataUrl
                        : null;
                    const imgSrc =
                      u.avatarUrl ||
                      (fallbackLocal &&
                      (fallbackLocal.startsWith("http") ||
                        fallbackLocal.startsWith("data:"))
                        ? fallbackLocal
                        : null);
                    return (
                      <div
                        key={u.userKey}
                        className="flex items-center gap-2.5 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80 px-2.5 py-2"
                      >
                        <div
                          className={`h-9 w-9 rounded-full overflow-hidden border border-white shadow-sm flex items-center justify-center ${paletteForKey(
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
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-black text-[#16263F] dark:text-slate-100 truncate">
                            {u.userLabel}
                          </p>
                          <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                            {u.connected ? "Conectado" : "Desconectado"}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-md shadow-slate-200/30 sm:rounded-2xl sm:p-5 md:rounded-[2rem] dark:border-slate-600/70 dark:bg-slate-900 dark:shadow-black/25">
              <div className="mb-3 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300">
                  <ClipboardList className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="text-xs font-black uppercase tracking-widest text-[#16263F] dark:text-slate-100">
                  Resumen de flujo
                </h3>
              </div>
              <div className="space-y-2">
                <FlowSummaryRow
                  label="Órdenes de recolección"
                  value={collectionStats.total}
                  hint={`${formatNumber(collectionStats.enBodega)} en bodega`}
                />
                <FlowSummaryRow
                  label="Camiones en proceso"
                  value={receptionStats.activos}
                  hint={`${formatNumber(receptionStats.enRampa)} en rampa`}
                />
                <FlowSummaryRow
                  label="RAs por capturar"
                  value={activeOrders}
                  hint={`${formatNumber(dashboard.completed)} completadas`}
                />
              </div>
            </div>
          </aside>
        </div>
        </div>
      </div>
    </div>
  );
}

function HeroChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/12 px-3.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-white shadow-sm backdrop-blur-md">
      <span className="text-blue-100/90">{label}</span>
      <span className="tabular-nums text-white">{value}</span>
    </span>
  );
}

function SparklineBars({ heights }: { heights: number[] }) {
  return (
    <div className="flex h-12 w-full min-w-0 items-end justify-start gap-1 sm:h-14 sm:max-w-[220px] sm:justify-end md:max-w-[260px]">
      {heights.map((h, i) => (
        <div
          key={i}
          className="w-2 rounded-t-md bg-gradient-to-t from-white/25 to-white/55 shadow-[0_0_12px_rgba(255,255,255,0.12)] transition-all"
          style={{ height: `${Math.max(12, h)}%` }}
        />
      ))}
    </div>
  );
}

function DonutRing({ percent }: { percent: number }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const dash = (percent / 100) * c;
  return (
    <div className="relative h-[100px] w-[100px] shrink-0">
      <svg className="-rotate-90" width={100} height={100} viewBox="0 0 100 100" aria-hidden>
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="10"
          className="stroke-slate-200 dark:stroke-slate-600"
        />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          className="stroke-[#16263F] dark:stroke-sky-400"
        />
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <Package className="h-6 w-6 text-[#16263F] opacity-80 dark:text-slate-100" aria-hidden />
        <span className="text-sm font-black text-[#16263F] dark:text-slate-100">{percent}%</span>
      </div>
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-slate-100/90 bg-slate-50/95 p-2.5 dark:border-slate-700/90 dark:bg-slate-800/90">
      <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {icon}
        {label}
      </div>
      <p className="text-lg font-black tabular-nums leading-none text-[#16263F] dark:text-slate-100">{value}</p>
    </div>
  );
}

const CHIP_TONES: Record<string, string> = {
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900/60",
  sky: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-900/60",
  amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900/60",
  violet: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-900/60",
  slate: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/70 dark:text-slate-300 dark:border-slate-700",
};

function ModuleFlowCard({
  icon,
  accent,
  tint,
  title,
  headline,
  headlineLabel,
  chips,
}: {
  icon: React.ReactNode;
  accent: string;
  tint: string;
  title: string;
  headline: string;
  headlineLabel: string;
  chips: { label: string; value: number; tone: keyof typeof CHIP_TONES }[];
}) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border border-slate-200/80 bg-white p-4 shadow-md shadow-slate-200/25 sm:rounded-2xl sm:p-5 md:rounded-[2rem] dark:border-slate-600/70 dark:bg-slate-900 dark:shadow-black/25">
      <span
        className={`pointer-events-none absolute left-0 top-0 h-full w-1.5 bg-gradient-to-b ${accent}`}
        aria-hidden
      />
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 items-center justify-center rounded-2xl ${tint}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {title}
          </p>
          <p className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-black tabular-nums leading-none text-[#16263F] dark:text-slate-100">
              {headline}
            </span>
            <span className="truncate text-[10px] font-semibold text-slate-400 dark:text-slate-500">
              {headlineLabel}
            </span>
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span
            key={c.label}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${CHIP_TONES[c.tone]}`}
          >
            {c.label}
            <span className="tabular-nums">{formatNumber(c.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function FlowSummaryRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="min-w-0">
        <p className="truncate text-[11px] font-bold text-[#16263F] dark:text-slate-200">{label}</p>
        <p className="truncate text-[10px] font-semibold text-slate-400 dark:text-slate-500">{hint}</p>
      </div>
      <span className="shrink-0 text-lg font-black tabular-nums text-[#16263F] dark:text-slate-100">
        {formatNumber(value)}
      </span>
    </div>
  );
}

function ActivityPresenceRow({
  raKey,
  entries,
  operatorCount,
}: {
  raKey: string;
  entries: WorkPresenceEntry[];
  operatorCount: number;
}) {
  const summary = entries
    .map(
      (e) =>
        `${peerPresenceVisibleName(e.userLabel, e.userKey)} (${moduleShort(e.module)})`,
    )
    .join(" · ");
  return (
    <div className="flex items-center gap-3 rounded-xl border border-blue-100/90 bg-white/95 px-3 py-2.5 shadow-sm dark:border-blue-900/50 dark:bg-slate-800/95">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400">
        <Activity className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-black text-[#16263F] dark:text-slate-100">RA {raKey}</p>
        <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 truncate">{summary}</p>
      </div>
      {operatorCount > 1 ? (
        <span className="shrink-0 rounded-full border border-amber-200 bg-amber-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-amber-900">
          {operatorCount} ops
        </span>
      ) : (
        <span className="shrink-0 rounded-full border border-slate-200 dark:border-slate-600 bg-slate-100 px-2 py-1 text-[9px] font-black uppercase text-slate-600 dark:text-slate-300">
          1 op
        </span>
      )}
    </div>
  );
}

function SidebarBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px] font-black uppercase text-slate-600 dark:text-slate-300">
        <span>{label}</span>
        <span>
          {formatNumber(count)}{" "}
          <span className="font-bold text-slate-400 dark:text-slate-500">({pct}%)</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
