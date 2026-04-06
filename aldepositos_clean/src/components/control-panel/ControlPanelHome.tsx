"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  User,
  Plus,
  UploadCloud,
  Loader2,
  Users,
  FileSpreadsheet,
  Box,
  FileText,
  Plane,
  Activity,
  Package,
  Truck,
  AlertCircle,
  Layers,
  BarChart3,
  Search,
  Clock3,
} from "lucide-react";

import type { Task } from "@/lib/types/task";
import type { UserPreferences } from "@/lib/userPreferences";
import {
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

const generateId = () => Math.random().toString(36).substr(2, 9);

function formatNumber(n: number): string {
  return new Intl.NumberFormat("es-PA").format(Math.round(n));
}

function moduleLabel(t: Task["type"]): string {
  if (t === "quick") return "Ingreso rápido";
  if (t === "detailed") return "Ingreso detallado";
  if (t === "airway") return "Guía aérea";
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
  if (t === "airway") return "Aéreo";
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
  onImport,
  openManualModal,
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
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsedData, setParsedData] = useState<Task[]>([]);
  const [extractedClient, setExtractedClient] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined" && !(window as unknown as { XLSX?: unknown }).XLSX) {
      const script = document.createElement("script");
      script.src =
        "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

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
      quick: tasks.filter((t) => t.type === "quick").length,
      detailed: tasks.filter((t) => t.type === "detailed").length,
      airway: tasks.filter((t) => t.type === "airway").length,
      other: tasks.filter(
        (t) => t.type !== "quick" && t.type !== "detailed" && t.type !== "airway",
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

  const connectedUsers = useMemo(() => {
    const map = new Map<
      string,
      { userLabel: string; avatarUrl: string | null | undefined }
    >();
    for (const entry of presenceList) {
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
  }, [presenceList]);

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
      dashboard.byType.airway,
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

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const XLSX = (window as unknown as { XLSX?: unknown }).XLSX;
    if (!XLSX) {
      alert(
        "El procesador de archivos se está cargando. Inténtalo de nuevo en unos segundos.",
      );
      return;
    }

    setSelectedFile(file);
    setIsProcessing(true);
    setShowImportModal(true);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const X = (window as any).XLSX;
        const workbook = X.read(
          new Uint8Array(evt.target?.result as ArrayBuffer),
          { type: "array" },
        );
        const rows = X.utils.sheet_to_json(
          workbook.Sheets[workbook.SheetNames[0]],
          { header: 1 },
        );

        if (rows.length < 7) {
          alert("⚠️ Archivo inválido o sin formato correcto (Fila 6/7).");
          setShowImportModal(false);
          return;
        }

        let mainClient = "Desconocido";
        const row6 = rows[5] || [];
        for (const cell of row6) {
          if (cell && cell.toString().trim().length > 2) {
            mainClient = cell
              .toString()
              .replace(/\s*\(\d+\)\s*$/, "")
              .trim();
            break;
          }
        }

        const extracted: Task[] = [];
        for (let i = 6; i < rows.length; i++) {
          const r = rows[i] as unknown[];
          if (r && r[1]) {
            extracted.push({
              id: generateId(),
              ra: r[1].toString().trim(),
              mainClient,
              provider: String(r[3] ?? "N/A"),
              subClient: String(r[4] ?? "N/A"),
              brand: String(r[5] ?? "N/A"),
              expectedBultos: parseFloat(String(r[6])) || 0,
              originalExpectedBultos: parseFloat(String(r[6])) || 0,
              expectedCbm: parseFloat(String(r[7])) || 0,
              expectedWeight: parseFloat(String(r[8])) || 0,
              notes: String(r[9] ?? ""),
              currentBultos: 0,
              status: "pending",
              measureData: [],
              weightMode: "no_weight",
              manualTotalWeight: 0,
            });
          }
        }

        if (extracted.length > 0) {
          setExtractedClient(mainClient);
          setParsedData(extracted);
          setIsProcessing(false);
        } else {
          alert("No se encontraron RAs válidos.");
          setShowImportModal(false);
        }
      } catch (error) {
        console.error(error);
        alert("Error procesando el archivo Excel.");
        setShowImportModal(false);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const confirmImport = (type: Task["type"]) => {
    const finalTasks = parsedData.map((t) => ({ ...t, type }));
    onImport(finalTasks);
    setShowImportModal(false);
    setSelectedFile(null);
    setParsedData([]);
  };

  const bultosPct =
    dashboard.expectedBultos > 0
      ? Math.min(
          100,
          Math.round((dashboard.currentBultos / dashboard.expectedBultos) * 100),
        )
      : 0;

  const completionDonutPct =
    dashboard.total > 0
      ? Math.round((dashboard.completed / dashboard.total) * 100)
      : 0;
  const visibleModuleTotal =
    dashboard.byType.quick + dashboard.byType.detailed + dashboard.byType.airway;
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

  return (
    <div className="max-w-[1600px] mx-auto animate-fade pb-10 px-0">
      {/* Fondo suave tipo dashboard */}
      <div className="rounded-[2rem] bg-slate-100/70 border border-slate-200/80 p-4 md:p-6 shadow-sm">
        {/* Barra superior: título + búsqueda / filtro + acciones */}
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-6">
          <div className="flex items-start gap-4 min-w-0">
            <div className="relative flex h-[120px] w-[120px] shrink-0 items-center justify-center rounded-[1.6rem] bg-[#16263F] text-white overflow-hidden border-2 border-white/80 shadow-[0_10px_30px_rgba(15,23,42,0.18)]">
              {headerAvatarSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={headerAvatarSrc}
                  alt="Foto de perfil"
                  className="h-full w-full object-cover object-center"
                />
              ) : (
                <span className="text-base font-black tracking-wide" aria-hidden>
                  {avatarInitialsFromName(
                    profileFullName,
                    userDisplayName,
                    userEmail,
                  )}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                {currentDate}
              </p>
              <h1 className="text-2xl md:text-3xl font-black text-[#16263F] tracking-tight leading-tight">
                Panel principal
              </h1>
              <p className="text-sm font-semibold text-slate-600 mt-0.5 truncate">
                {getGreeting()},{" "}
                <span className="text-[#16263F]">{greetingName}</span>
              </p>
              <div className="mt-2 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-[#16263F] text-white">
                  <Clock3 className="w-3.5 h-3.5" />
                </span>
                <div className="leading-tight">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    Hora en vivo
                  </p>
                  <p className="text-xs font-black text-[#16263F] tabular-nums">{currentTime}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto lg:max-w-2xl">
            <div className="flex flex-1 min-w-0 items-center gap-2 rounded-full border border-slate-200/90 bg-white/90 backdrop-blur-sm px-4 py-2.5 shadow-sm">
              <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar RA, cliente o proveedor…"
                className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#16263F] placeholder:text-slate-400 outline-none"
              />
              <select
                value={filterStatus}
                onChange={(e) =>
                  setFilterStatus(e.target.value as "all" | "in_progress" | "pending")
                }
                className="shrink-0 rounded-full border border-slate-200 bg-slate-50 py-1.5 pl-3 pr-8 text-[10px] font-black uppercase tracking-wider text-[#16263F] outline-none cursor-pointer"
                aria-label="Filtrar por estado"
              >
                <option value="all">Todos</option>
                <option value="in_progress">En proceso</option>
                <option value="pending">Pendiente</option>
              </select>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={openManualModal}
                className="inline-flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-full bg-[#16263F] px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-white shadow-md shadow-[#16263F]/20 hover:bg-[#0f1b2e] transition active:scale-[0.98]"
              >
                <Plus className="h-4 w-4" /> Manual
              </button>
              <label className="inline-flex flex-1 sm:flex-none cursor-pointer items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-white shadow-md shadow-emerald-600/25 hover:bg-emerald-700 transition active:scale-[0.98]">
                <UploadCloud className="h-4 w-4" /> Excel
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={handleFileChange}
                  accept=".xlsx, .xls, .csv"
                />
              </label>
            </div>
          </div>
        </header>

        {/* Hero + donut + KPIs compactos */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5 mb-6">
          <div className="lg:col-span-7 relative overflow-hidden rounded-[2rem] border border-white/20 bg-gradient-to-br from-[#16263F] via-[#1a3a66] to-[#2563eb] p-6 md:p-8 text-white shadow-xl shadow-[#16263F]/15">
            <div
              className="pointer-events-none absolute -right-8 -top-8 h-48 w-48 rounded-full bg-white/10 blur-3xl"
              aria-hidden
            />
            <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-200/90">
                  Resumen operativo
                </p>
                <p className="mt-2 text-4xl md:text-5xl font-black tabular-nums tracking-tight">
                  {formatNumber(activeOrders)}
                </p>
                <p className="mt-1 text-sm font-semibold text-blue-100/95">
                  órdenes activas (pendientes + en proceso)
                </p>
                <p className="mt-3 text-xs text-blue-200/80">
                  Total en sistema:{" "}
                  <span className="font-bold text-white">{formatNumber(dashboard.total)}</span>{" "}
                  RAs · Bultos capturados{" "}
                  <span className="font-bold text-white">
                    {formatNumber(dashboard.currentBultos)} /{" "}
                    {formatNumber(dashboard.expectedBultos)}
                  </span>
                </p>
              </div>
              <div className="flex flex-col items-stretch md:items-end gap-3">
                <SparklineBars heights={sparkHeights} />
                <p className="text-[10px] font-bold uppercase tracking-wider text-blue-200/70 text-right">
                  Actividad relativa · reciente
                </p>
              </div>
            </div>
            <div className="relative z-10 mt-6 flex flex-wrap gap-2">
              <HeroChip label="Pendiente" value={`${sharePending}%`} />
              <HeroChip label="En proceso" value={`${shareProgress}%`} />
              <HeroChip label="Completado" value={`${shareDone}%`} />
            </div>
          </div>

          <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
            <div className="rounded-[2rem] border border-slate-200/90 bg-white p-5 shadow-md shadow-slate-200/50 flex flex-row items-center gap-5">
              <DonutRing percent={completionDonutPct} />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Cierre de inventario
                </p>
                <p className="mt-1 text-2xl font-black text-[#16263F]">
                  {formatNumber(dashboard.completed)}
                  <span className="text-slate-400 text-lg font-bold"> / {formatNumber(dashboard.total)}</span>
                </p>
                <p className="text-xs font-semibold text-slate-500 mt-1">
                  RAs completados en el sistema
                </p>
              </div>
            </div>
            <div className="rounded-[2rem] border border-slate-200/90 bg-white p-4 shadow-md shadow-slate-200/50 grid grid-cols-2 gap-3">
              <MiniStat icon={<Truck className="h-3.5 w-3.5" />} label="Despachados" value={dashboard.dispatched} />
              <MiniStat icon={<AlertCircle className="h-3.5 w-3.5 text-red-500" />} label="Prioridad" value={dashboard.priority} />
              <MiniStat icon={<Package className="h-3.5 w-3.5" />} label="Progreso real" value={`${overallProgressPct}%`} />
              <MiniStat icon={<Users className="h-3.5 w-3.5" />} label="En vivo" value={presenceGrouped.length} />
            </div>
          </div>
        </div>

        {/* Contenido principal: lista + lateral */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <section className="xl:col-span-8 rounded-[2rem] border border-slate-200/90 bg-white p-5 md:p-6 shadow-md shadow-slate-200/40">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-[#16263F]" />
                <h2 className="text-sm font-black uppercase tracking-widest text-[#16263F]">
                  Actividad en depósito
                </h2>
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Quién trabaja qué · colaboración en el mismo RA
              </p>
            </div>

            {presenceGrouped.length > 0 && (
              <div className="mb-5 rounded-2xl border border-blue-100 bg-blue-50/50 p-3">
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
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 py-12 text-center px-4">
                <p className="text-sm font-semibold text-slate-600">
                  No hay órdenes que coincidan con el filtro o la búsqueda.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {filteredHighlight.map((t) => {
                  const taskProgress = getTaskProgressPercent(t);
                  const raK = String(t.ra || "").trim().toUpperCase();
                  const pres = presenceGrouped.find((p) => p.raKey === raK);
                  const stackItems = pres
                    ? Array.from(
                        new Map(
                          pres.entries.map((e) => [
                            e.userKey,
                            {
                              label: peerPresenceVisibleName(e.userLabel, e.userKey),
                              avatarUrl: e.avatarUrl,
                            },
                          ]),
                        ).values(),
                      )
                    : [];
                  const liveLabels = stackItems.map((s) => s.label);
                  return (
                    <li
                      key={t.id}
                      className="flex flex-col gap-3 py-4 first:pt-0 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <AvatarStack
                          items={
                            stackItems.length > 0
                              ? stackItems
                              : [
                                  {
                                    label: userDisplayName || "Equipo",
                                    avatarUrl: headerAvatarSrc,
                                  },
                                ]
                          }
                          singleIsUnknown={stackItems.length === 0}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-black text-[#16263F]">RA {t.ra}</span>
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-600">
                              {moduleLabel(t.type)}
                            </span>
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                                t.status === "pending"
                                  ? "bg-amber-100 text-amber-900"
                                  : "bg-sky-100 text-sky-900"
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
                          <p className="mt-1 text-xs font-semibold text-slate-500 truncate">
                            {t.mainClient || "Sin cliente"} · {t.provider || "—"}
                          </p>
                          <p className="mt-1 text-[11px] font-semibold text-slate-500 truncate">
                            {liveLabels.length > 0
                              ? `En vivo: ${liveLabels.join(" · ")}`
                              : "En vivo: sin captura activa"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0 md:min-w-[200px]">
                        <div className="flex-1 md:flex-none md:w-36">
                          <div className="flex justify-between text-[9px] font-black uppercase text-slate-400 mb-1">
                            <span>Progreso</span>
                            <span>{taskProgress}%</span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-500 transition-all"
                              style={{ width: `${taskProgress}%` }}
                            />
                          </div>
                        </div>
                        <div className="hidden sm:flex h-10 w-10 items-center justify-center rounded-xl bg-slate-50 border border-slate-100 text-slate-400">
                          <Package className="h-5 w-5" aria-hidden />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-5 flex flex-wrap items-start gap-2 rounded-2xl border border-blue-100 bg-blue-50/60 p-3 md:p-4">
              <AlertCircle className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
              <p className="text-xs font-semibold text-blue-900 leading-relaxed">
                <span className="font-black">Colaboración:</span> varias personas pueden
                intervenir el mismo RA. <strong>Conectados ahora</strong> y{" "}
                <strong>En captura ahora</strong> se sincronizan por Supabase Realtime
                entre equipos y navegadores.
              </p>
            </div>
          </section>

          <aside className="xl:col-span-4 space-y-4">
            <div className="rounded-[2rem] border border-slate-200/90 bg-white p-5 shadow-md shadow-slate-200/40">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="h-5 w-5 text-[#16263F]" />
                <h3 className="text-xs font-black uppercase tracking-widest text-[#16263F]">
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
                <SidebarBar
                  label="Aéreo"
                  count={dashboard.byType.airway}
                  total={visibleModuleTotal}
                  color="bg-orange-500"
                />
              </div>
            </div>

            <div className="rounded-[2rem] border border-slate-200/90 bg-white p-5 shadow-md shadow-slate-200/40">
              <div className="flex items-center gap-2 mb-3">
                <Layers className="h-5 w-5 text-[#16263F]" />
                <h3 className="text-xs font-black uppercase tracking-widest text-[#16263F]">
                  Progreso general
                </h3>
              </div>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#16263F] to-blue-500 transition-all"
                  style={{ width: `${overallProgressPct}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] font-semibold text-slate-500">
                {overallProgressPct}% promedio según avance real por RA.
              </p>
            </div>

            <div className="rounded-[2rem] border border-slate-200/90 bg-white p-5 shadow-md shadow-slate-200/40">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h3 className="text-xs font-black uppercase tracking-widest text-[#16263F]">
                  Conectados ahora
                </h3>
                <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                  {connectedUsers.length}
                </span>
              </div>
              {connectedUsers.length === 0 ? (
                <p className="text-xs font-semibold text-slate-500">
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
                        className="flex items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50/80 px-2.5 py-2"
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
                          <p className="text-xs font-black text-[#16263F] truncate">
                            {u.userLabel}
                          </p>
                          <p className="text-[10px] font-semibold text-emerald-700">
                            {u.connected ? "Conectado" : "Desconectado"}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-[2rem] border border-dashed border-slate-300 bg-slate-50/80 p-4">
              <div className="flex items-center gap-2 text-[#16263F] mb-2">
                <User className="h-4 w-4" />
                <span className="text-[10px] font-black uppercase tracking-wider">
                  Tip
                </span>
              </div>
              <p className="text-xs font-semibold text-slate-600 leading-relaxed">
                Usa la búsqueda y el filtro para enfocar pendientes o lo que está en
                proceso. Los avatares apilados indican más de un operador con foco en
                el mismo RA.
              </p>
            </div>
          </aside>
        </div>
      </div>

      {showImportModal && (
        <div className="fixed inset-0 bg-[#16263F]/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-fade">
          <div className="bg-white w-full max-w-lg rounded-3xl md:rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-[#16263F] p-5 md:p-8 text-white shrink-0">
              <h3 className="text-lg md:text-2xl font-black tracking-tight flex items-center gap-2 md:gap-3">
                <FileSpreadsheet className="text-[#FFC400] w-5 h-5 md:w-6 md:h-6" />{" "}
                Relación de Carga
              </h3>
              <p className="text-blue-200 text-xs md:text-sm mt-1 truncate">
                {selectedFile?.name}
              </p>
            </div>
            <div className="p-5 md:p-8 space-y-5 md:space-y-6 overflow-y-auto">
              {isProcessing ? (
                <div className="text-center py-8">
                  <Loader2 className="w-12 h-12 mx-auto text-[#16263F] animate-spin mb-4" />
                  <h3 className="text-lg font-bold text-[#16263F]">
                    Procesando Excel...
                  </h3>
                </div>
              ) : (
                <>
                  <div className="bg-[#F8FAFC] border border-slate-200 p-4 md:p-6 rounded-2xl md:rounded-3xl flex items-start gap-4 md:gap-5 shadow-sm">
                    <div className="bg-blue-100 p-3 rounded-xl">
                      <Users className="text-blue-600 w-5 h-5 md:w-6 md:h-6" />
                    </div>
                    <div>
                      <p className="text-[#16263F] font-black text-sm md:text-lg uppercase tracking-tight">
                        {extractedClient}
                      </p>
                      <p className="text-slate-500 text-[10px] md:text-xs font-bold mt-1 uppercase tracking-widest">
                        Se detectaron{" "}
                        <span className="text-blue-600">
                          {parsedData.length} RA&apos;s
                        </span>{" "}
                        listos.
                      </p>
                    </div>
                  </div>

                  <p className="font-black text-[#16263F] text-center uppercase text-[10px] md:text-xs tracking-[0.2em]">
                    Asignar órdenes a módulo:
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                    <button
                      type="button"
                      onClick={() => confirmImport("quick")}
                      className="flex flex-row sm:flex-col items-center justify-center gap-3 sm:gap-0 p-4 md:p-6 border-2 border-slate-100 rounded-2xl md:rounded-[2rem] hover:border-blue-500 hover:bg-blue-50 transition-all group shadow-sm"
                    >
                      <Box className="text-blue-500 sm:mb-3 group-hover:rotate-12 transition-transform w-6 h-6 md:w-8 md:h-8 shrink-0" />
                      <span className="font-black text-[#16263F] uppercase text-[10px] md:text-xs tracking-widest text-center leading-tight">
                        Captura de
                        <br className="hidden sm:block" />
                        Medidas
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => confirmImport("detailed")}
                      className="flex flex-row sm:flex-col items-center justify-center gap-3 sm:gap-0 p-4 md:p-6 border-2 border-slate-100 rounded-2xl md:rounded-[2rem] hover:border-purple-500 hover:bg-purple-50 transition-all group shadow-sm"
                    >
                      <FileText className="text-purple-600 sm:mb-3 group-hover:rotate-12 transition-transform w-6 h-6 md:w-8 md:h-8 shrink-0" />
                      <span className="font-black text-[#16263F] uppercase text-[10px] md:text-xs tracking-widest text-center leading-tight">
                        Validación
                        <br className="hidden sm:block" />
                        Detallada
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => confirmImport("airway")}
                      className="col-span-1 sm:col-span-2 flex flex-row items-center justify-center gap-3 p-4 md:p-6 border-2 border-slate-100 rounded-2xl md:rounded-[2rem] hover:border-orange-500 hover:bg-orange-50 transition-all group shadow-sm"
                    >
                      <Plane className="text-orange-500 group-hover:rotate-12 transition-transform w-6 h-6 shrink-0" />
                      <span className="font-black text-[#16263F] uppercase text-[10px] md:text-xs tracking-widest leading-tight">
                        Guía Aérea
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HeroChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white backdrop-blur-sm">
      <span className="text-blue-100/85">{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

function SparklineBars({ heights }: { heights: number[] }) {
  return (
    <div className="flex h-14 max-w-[220px] items-end justify-end gap-1 md:max-w-[260px]">
      {heights.map((h, i) => (
        <div
          key={i}
          className="w-2 rounded-t-md bg-white/35 transition-all"
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
        <circle cx="50" cy="50" r={r} fill="none" stroke="#e2e8f0" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="#16263F"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <Package className="h-6 w-6 text-[#16263F] opacity-80" aria-hidden />
        <span className="text-sm font-black text-[#16263F]">{percent}%</span>
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
    <div className="flex flex-col gap-0.5 rounded-xl border border-slate-100 bg-slate-50/90 p-2.5">
      <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wider text-slate-500">
        {icon}
        {label}
      </div>
      <p className="text-lg font-black tabular-nums text-[#16263F] leading-none">{value}</p>
    </div>
  );
}

type AvatarStackItem = { label: string; avatarUrl?: string | null };

function AvatarStack({
  items,
  singleIsUnknown,
}: {
  items: AvatarStackItem[];
  singleIsUnknown?: boolean;
}) {
  const max = 4;
  const show = items.slice(0, max);
  return (
    <div className="flex shrink-0 -space-x-2">
      {show.map((it, i) => (
        <div
          key={`${it.label}-${i}`}
          title={it.label}
          className={`flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 border-white text-[10px] font-black shadow-md ${paletteForKey(it.label)}`}
        >
          {it.avatarUrl?.trim() ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={it.avatarUrl.trim()}
              alt=""
              className="h-full w-full object-cover object-center"
            />
          ) : singleIsUnknown && show.length === 1 && i === 0 ? (
            "?"
          ) : (
            avatarInitialsFromName(null, it.label, null)
          )}
        </div>
      ))}
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
  const stackItems: AvatarStackItem[] = Array.from(
    new Map(
      entries.map((e) => [
        e.userKey,
        {
          label: peerPresenceVisibleName(e.userLabel, e.userKey),
          avatarUrl: e.avatarUrl,
        },
      ]),
    ).values(),
  );
  return (
    <div className="flex items-center gap-3 rounded-xl border border-blue-100/80 bg-white/90 px-3 py-2.5 shadow-sm">
      <AvatarStack items={stackItems} />
      <div className="min-w-0 flex-1">
        <p className="font-black text-[#16263F]">RA {raKey}</p>
        <p className="text-[10px] font-semibold text-slate-500 truncate">{summary}</p>
      </div>
      {operatorCount > 1 ? (
        <span className="shrink-0 rounded-full border border-amber-200 bg-amber-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-amber-900">
          {operatorCount} ops
        </span>
      ) : (
        <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2 py-1 text-[9px] font-black uppercase text-slate-600">
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
      <div className="mb-1 flex justify-between text-[10px] font-black uppercase text-slate-600">
        <span>{label}</span>
        <span>
          {formatNumber(count)}{" "}
          <span className="font-bold text-slate-400">({pct}%)</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
