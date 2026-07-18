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
  isIsoInPanamaRange,
  panamaDayBounds,
} from "@/lib/receptionLogistics/receptionReportFilter";
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
  profileFullName?: string | null;
  userEmail?: string | null;
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
  if (status === "paused") return "En pausa";
  if (status === "pending") return "Pendiente";
  return status || "—";
}

function moduleShort(t: WorkPresenceEntry["module"]): string {
  if (t === "quick") return "Rápido";
  if (t === "detailed") return "Detallado";
  if (t === "airway") return "Rápido";
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

  const { trucks: receptionTrucks } = useReceptionQueue();
  const [collectionOrders, setCollectionOrders] = useState<CollectionOrder[]>([]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const list = await fetchCollectionOrders();
        if (alive) setCollectionOrders(list);
      } catch {
        /* Silencioso */
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
    const expectedBultos = tasks.reduce((a, t) => a + (t.expectedBultos || 0), 0);
    const currentBultos = tasks.reduce((a, t) => a + (t.currentBultos || 0), 0);

    const byType = {
      quick: tasks.filter(
        (t) => t.type === "quick" || t.type === "airway" || !t.type,
      ).length,
      detailed: tasks.filter((t) => t.type === "detailed").length,
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
      .slice(0, 10);

    return {
      total,
      pending,
      inProgress,
      completed,
      dispatched,
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
  const currentTime = now.toLocaleTimeString("es-PA", {
    hour: "2-digit",
    minute: "2-digit",
    second: preferences?.showSeconds ? "2-digit" : undefined,
    hour12: preferences?.timeFormat === "12h",
  });

  const greetingFromProfile = profileFullName?.trim() ?? "";
  const greetingName =
    greetingFromProfile ||
    String(userDisplayName ?? "").trim() ||
    "Operador";

  const isDark = preferences?.theme === "dark";
  const cardClass = isDark
    ? "border-slate-700/80 bg-slate-900/90"
    : "border-slate-200/90 bg-white shadow-sm shadow-slate-200/40";

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1400px] animate-fade overflow-x-hidden pb-8 sm:pb-10">
      {/* Encabezado profesional navy/slate */}
      <header className="mb-6 flex flex-col gap-5 sm:mb-8 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <div className="flex min-w-0 items-center gap-4 sm:gap-5">
          <div
            className={`relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-white md:h-24 md:w-24 md:rounded-[1.25rem] ${
              isDark
                ? "border border-white/10 bg-[#16263F] shadow-lg shadow-black/30"
                : "border-2 border-white bg-[#16263F] shadow-lg shadow-[#16263F]/20 ring-1 ring-slate-200/80"
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
                {avatarInitialsFromName(profileFullName, userDisplayName, userEmail)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold capitalize tracking-wide text-slate-500 dark:text-slate-400 sm:text-[13px]">
              {currentDate}
            </p>
            <h1 className="mt-1 text-2xl font-black leading-tight tracking-tight text-[#16263F] dark:text-slate-100 sm:text-3xl lg:text-4xl lg:leading-tight">
              <span className="block sm:inline">{getGreeting()},</span>{" "}
              <span className="block sm:inline">{greetingName}</span>
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold text-slate-500 dark:text-slate-400">
              <Clock3 className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <span className="tabular-nums">{currentTime}</span>
              <span className="text-slate-300 dark:text-slate-600" aria-hidden>
                ·
              </span>
              <span>Panel principal</span>
            </div>
          </div>
        </div>

        <div className="flex w-full min-w-0 flex-col gap-2.5 sm:max-w-md lg:w-auto lg:min-w-[340px] lg:shrink-0">
          <div
            className={`flex items-center gap-2.5 rounded-2xl border px-4 py-3 transition focus-within:ring-2 focus-within:ring-[#16263F]/20 ${
              isDark
                ? "border-slate-600/80 bg-slate-800/70"
                : "border-slate-200 bg-white shadow-sm"
            }`}
          >
            <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar RA, cliente o proveedor"
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#16263F] outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
          <div
            className={`grid grid-cols-3 gap-1 rounded-2xl p-1 ${
              isDark ? "border border-slate-700 bg-slate-900/70" : "border border-slate-200 bg-slate-100/90"
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
                  className={`rounded-xl px-2 py-2 text-[10px] font-black uppercase tracking-wider transition ${
                    active
                      ? "bg-[#16263F] text-white shadow-sm"
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

      {/* 4 KPIs navy/slate */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:mb-6 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          icon={<Package className="h-4 w-4" />}
          label="RAs activas"
          value={formatNumber(activeOrders)}
          hint={`${formatNumber(dashboard.total)} en sistema · ${completionPct}% cerradas`}
          isDark={isDark}
        />
        <KpiCard
          icon={<Boxes className="h-4 w-4" />}
          label="Bultos capturados"
          value={`${formatNumber(dashboard.currentBultos)}`}
          hint={`de ${formatNumber(dashboard.expectedBultos)} · ${bultosPct}%`}
          isDark={isDark}
          progress={bultosPct}
        />
        <KpiCard
          icon={<Truck className="h-4 w-4" />}
          label="Camiones activos"
          value={formatNumber(receptionStats.activos)}
          hint={`${formatNumber(receptionStats.enFila)} en fila · ${formatNumber(receptionStats.completadoHoy)} hoy`}
          isDark={isDark}
        />
        <KpiCard
          icon={<ClipboardList className="h-4 w-4" />}
          label="Órdenes recolección"
          value={formatNumber(collectionStats.total)}
          hint={`${formatNumber(collectionStats.enBodega)} en bodega · ${formatNumber(collectionStats.pendientes)} por llegar`}
          isDark={isDark}
        />
      </div>

      {/* Flujo operativo */}
      <section className="mb-5 sm:mb-6">
        <h2 className="mb-3 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
          Flujo operativo
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
          <FlowCard
            icon={<ClipboardList className="h-5 w-5" />}
            title="Órdenes de recolección"
            primary={formatNumber(collectionStats.total)}
            primaryLabel="registradas"
            rows={[
              { label: "En bodega", value: collectionStats.enBodega },
              { label: "Por llegar", value: collectionStats.pendientes },
            ]}
            cardClass={cardClass}
          />
          <FlowCard
            icon={<Truck className="h-5 w-5" />}
            title="Recepción de camiones"
            primary={formatNumber(receptionStats.activos)}
            primaryLabel="en proceso"
            rows={[
              { label: "En fila", value: receptionStats.enFila },
              { label: "En rampa", value: receptionStats.enRampa },
              { label: "Completados hoy", value: receptionStats.completadoHoy },
            ]}
            cardClass={cardClass}
          />
          <FlowCard
            icon={<Boxes className="h-5 w-5" />}
            title="Ingreso de inventario"
            primary={formatNumber(activeOrders)}
            primaryLabel="RAs activas"
            rows={[
              { label: "Rápido", value: dashboard.byType.quick },
              { label: "Detallado", value: dashboard.byType.detailed },
              { label: "Completadas", value: dashboard.completed },
            ]}
            cardClass={cardClass}
          />
          <FlowCard
            icon={<PackageCheck className="h-5 w-5" />}
            title="Salida y reportes"
            primary={formatNumber(dashboard.dispatched)}
            primaryLabel="despachados"
            rows={[
              { label: "Pendientes", value: dashboard.pending },
              { label: "En proceso", value: dashboard.inProgress },
              { label: "Completadas", value: dashboard.completed },
            ]}
            cardClass={cardClass}
          />
        </div>
      </section>

      {/* Actividad + conectados */}
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-12">
        <section
          className={`min-w-0 rounded-2xl border p-4 sm:rounded-3xl sm:p-5 xl:col-span-8 ${cardClass}`}
        >
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#16263F] text-white">
              <Activity className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h2 className="text-sm font-black text-[#16263F] dark:text-slate-100">
                Actividad en depósito
              </h2>
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                RAs activas y captura en vivo
              </p>
            </div>
          </div>

          {presenceGrouped.length > 0 && (
            <div className="mb-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-800/50">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
                En captura ahora
              </p>
              {presenceGrouped.map(({ raKey, entries, operatorCount }) => (
                <ActivityPresenceRow
                  key={raKey}
                  raKey={raKey}
                  entries={entries}
                  operatorCount={operatorCount}
                />
              ))}
            </div>
          )}

          {filteredHighlight.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-12 text-center dark:border-slate-700 dark:bg-slate-800/40">
              <Package className="mx-auto mb-2 h-8 w-8 text-slate-300 dark:text-slate-600" aria-hidden />
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                No hay órdenes que coincidan con el filtro.
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
                    className="flex flex-col gap-2.5 rounded-xl border border-slate-100 bg-slate-50/50 px-3.5 py-3 transition hover:bg-white dark:border-slate-800 dark:bg-slate-800/40 dark:hover:bg-slate-800/70 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-black text-[#16263F] dark:text-slate-100">
                          RA {t.ra}
                        </span>
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          {moduleLabel(t.type)}
                        </span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                            t.status === "pending"
                              ? "bg-slate-200/90 text-slate-700 dark:bg-slate-700 dark:text-slate-200"
                              : "bg-[#16263F]/10 text-[#16263F] dark:bg-slate-700 dark:text-slate-200"
                          }`}
                        >
                          {statusLabel(t.status)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs font-medium text-slate-500 dark:text-slate-400">
                        {t.mainClient || "Sin cliente"} · {t.provider || "—"}
                        {liveLabels.length > 0
                          ? ` · En vivo: ${liveLabels.join(", ")}`
                          : ""}
                      </p>
                      <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-slate-600 dark:text-slate-300">
                        {(t.currentBultos || 0) > 0 || (t.expectedBultos || 0) > 0
                          ? `${t.currentBultos || 0}/${t.expectedBultos || 0} bultos`
                          : "Sin bultos"}
                        {(t.capturedWeight || 0) > 0
                          ? ` · ${t.capturedWeight} kg`
                          : ""}
                        {(t.completeRowCount || 0) > 0
                          ? ` · ${t.completeRowCount}/${t.rowCount || t.completeRowCount} líneas`
                          : ""}
                      </p>
                    </div>
                    <div className="flex w-full items-center gap-2 sm:w-36 sm:shrink-0">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                        <div
                          className="h-full rounded-full bg-[#16263F] transition-all dark:bg-slate-300"
                          style={{ width: `${taskProgress}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-[10px] font-black tabular-nums text-slate-500">
                        {taskProgress}%
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside className="min-w-0 space-y-4 xl:col-span-4">
          <div className={`rounded-2xl border p-4 sm:rounded-3xl sm:p-5 ${cardClass}`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-[#16263F] dark:bg-slate-800 dark:text-slate-200">
                  <Users className="h-4 w-4" aria-hidden />
                </span>
                <h3 className="text-xs font-black uppercase tracking-wider text-[#16263F] dark:text-slate-100">
                  Conectados
                </h3>
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-[#16263F] dark:bg-slate-800 dark:text-slate-200">
                {connectedUsers.length}
              </span>
            </div>
            {connectedUsers.length === 0 ? (
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Nadie conectado en este momento.
              </p>
            ) : (
              <div className="space-y-2">
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
                      className="flex items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50/80 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800/80"
                    >
                      <div
                        className={`flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-white shadow-sm ${paletteForKey(
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
                        <p className="truncate text-xs font-bold text-[#16263F] dark:text-slate-100">
                          {u.userLabel}
                        </p>
                        <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                          Conectado
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className={`rounded-2xl border p-4 sm:rounded-3xl sm:p-5 ${cardClass}`}>
            <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-[#16263F] dark:text-slate-100">
              Inventario por módulo
            </h3>
            <div className="space-y-3">
              <SidebarBar
                label="Rápido"
                count={dashboard.byType.quick}
                total={dashboard.byType.quick + dashboard.byType.detailed}
                color="bg-[#16263F]"
              />
              <SidebarBar
                label="Detallado"
                count={dashboard.byType.detailed}
                total={dashboard.byType.quick + dashboard.byType.detailed}
                color="bg-slate-400"
              />
            </div>
            <p className="mt-3 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {formatNumber(dashboard.completed)} de {formatNumber(dashboard.total)} RAs
              completadas ({completionPct}%).
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  isDark,
  progress,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  isDark: boolean;
  progress?: number;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        isDark
          ? "border-slate-700/80 bg-slate-900/90"
          : "border-slate-200/90 bg-white shadow-sm shadow-slate-200/40"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-[#16263F] dark:bg-slate-800 dark:text-slate-200">
          {icon}
        </span>
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {label}
        </p>
      </div>
      <p className="mt-3 text-2xl font-black tabular-nums tracking-tight text-[#16263F] dark:text-slate-100 sm:text-3xl">
        {value}
      </p>
      <p className="mt-1 truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
        {hint}
      </p>
      {typeof progress === "number" ? (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            className="h-full rounded-full bg-[#16263F] transition-all dark:bg-slate-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function FlowCard({
  icon,
  title,
  primary,
  primaryLabel,
  rows,
  cardClass,
}: {
  icon: React.ReactNode;
  title: string;
  primary: string;
  primaryLabel: string;
  rows: { label: string; value: number }[];
  cardClass: string;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${cardClass}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[#16263F] dark:bg-slate-800 dark:text-slate-200">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {title}
          </p>
          <p className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-2xl font-black tabular-nums text-[#16263F] dark:text-slate-100">
              {primary}
            </span>
            <span className="text-[10px] font-semibold text-slate-400">{primaryLabel}</span>
          </p>
        </div>
      </div>
      <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-2 text-xs">
            <dt className="font-medium text-slate-500 dark:text-slate-400">{r.label}</dt>
            <dd className="font-black tabular-nums text-[#16263F] dark:text-slate-100">
              {formatNumber(r.value)}
            </dd>
          </div>
        ))}
      </dl>
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
    <div className="flex items-center gap-2.5 rounded-lg border border-slate-200/90 bg-white px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800/90">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-black text-[#16263F] dark:text-slate-100">RA {raKey}</p>
        <p className="truncate text-[10px] font-medium text-slate-500 dark:text-slate-400">
          {summary}
        </p>
      </div>
      <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase text-slate-600 dark:bg-slate-700 dark:text-slate-300">
        {operatorCount} op
      </span>
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
      <div className="mb-1 flex justify-between text-[10px] font-bold uppercase text-slate-600 dark:text-slate-300">
        <span>{label}</span>
        <span>
          {formatNumber(count)}{" "}
          <span className="font-medium text-slate-400">({pct}%)</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
