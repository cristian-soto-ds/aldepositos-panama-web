"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  Loader2,
  Plus,
  ScanLine,
  Search,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  addRasToSession,
  closeCargaAndSignalDescarga,
  closeLoadSession,
  createLoadSession,
  fetchLoadSession,
  fetchSessionRas,
  fetchSessionScans,
  listCargaReadyForDescarga,
  listLoadSessions,
  listSessionProgress,
  openDescargaFromCarga,
  recordPackageScan,
  removeRaFromSession,
  buildSessionProgress,
  updateLoadSessionContainerInfo,
} from "@/lib/warehouse/api";
import { downloadLoadSessionExcel } from "@/lib/warehouse/exportLoadSessionExcel";
import {
  normalizeRaForPackageBarcode,
  parsePackageBarcode,
} from "@/lib/warehouse/task-adapter";
import type {
  LoadSessionContainerInfo,
  LoadSessionKind,
  LoadSessionRaProgress,
  PackageScanResult,
  WarehouseLoadSession,
  WarehousePackageScan,
  WarehouseRAView,
} from "@/lib/warehouse/types";

type LoadScanPanelProps = {
  kind: LoadSessionKind;
  availableRas: WarehouseRAView[];
  userLabel?: string | null;
  onMessage?: (msg: string) => void;
  /** true = pantalla completa (oculta cabecera de Control de Carga). */
  onImmersiveChange?: (immersive: boolean) => void;
};

/** Montar = operario 1 (elige RAs). escanear = operario 2 (valida bultos). */
type WorkRole = "montar" | "escanear";

type FlashTone = "ok" | "warn" | "error" | null;

function beep(tone: "ok" | "warn" | "error") {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const play = (freq: number, startAt: number, dur: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = freq;
      g.gain.value = 0.1;
      o.start(ctx.currentTime + startAt);
      o.stop(ctx.currentTime + startAt + dur);
    };
    if (tone === "ok") {
      play(880, 0, 0.09);
    } else if (tone === "warn") {
      // Alarma doble: código ya contado
      play(520, 0, 0.16);
      play(320, 0.2, 0.22);
      play(520, 0.48, 0.16);
    } else {
      play(220, 0, 0.22);
    }
    window.setTimeout(
      () => {
        void ctx.close();
      },
      tone === "warn" ? 750 : tone === "ok" ? 150 : 280,
    );
  } catch {
    /* ignore */
  }
}

const DUPLICATE_SCAN_ALARM =
  "ALARMA: este código de barra ya fue contado y no se contará nuevamente.";

function isMissingLoadTablesError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /warehouse_load_sessions/i.test(msg) ||
    /PGRST205/i.test(msg) ||
    /schema cache/i.test(msg)
  );
}

const MISSING_TABLES_HINT =
  "Falta aplicar en Supabase (SQL Editor) las migraciones 019_warehouse_load_sessions.sql, 020_warehouse_carga_ready_descarga.sql y (recomendado) 021_warehouse_load_container_info.sql. Sin esas tablas no se puede cargar ni descargar.";

/** Capacidades tipo equipo — mismas opciones que Entrega de carga. */
const CAPACITY_MAP: Record<
  string,
  { name: string; maxCbm: number; tare: number }
> = {
  "20": { name: "Contenedor 20'", maxCbm: 28, tare: 2300 },
  "40": { name: "Contenedor 40'", maxCbm: 56, tare: 3900 },
  furgon: { name: "Contenedor 40' HQ", maxCbm: 70, tare: 0 },
};

const CONTAINER_DRAFT_KEY = "cargue_container_info_draft";

function todayIsoDate(): string {
  return new Date().toISOString().split("T")[0]!;
}

function emptyContainerInfo(
  responsible = "",
): LoadSessionContainerInfo {
  return {
    type: "40",
    consignment: "",
    number: "",
    bl: "",
    seal1: "",
    seal2: "",
    responsible,
    date: todayIsoDate(),
    tare: CAPACITY_MAP["40"].tare,
  };
}

function parseContainerInfo(
  raw: unknown,
  fallbackNumber = "",
): LoadSessionContainerInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const number = String(o.number ?? fallbackNumber ?? "").trim();
  if (!number && !String(o.type ?? "").trim()) return null;
  const type = String(o.type ?? "40").trim() || "40";
  return {
    type,
    consignment: String(o.consignment ?? "").trim(),
    number: number || fallbackNumber,
    bl: String(o.bl ?? "").trim(),
    seal1: String(o.seal1 ?? "").trim(),
    seal2: String(o.seal2 ?? "").trim(),
    responsible: String(o.responsible ?? "").trim(),
    date: String(o.date ?? todayIsoDate()).trim() || todayIsoDate(),
    tare:
      typeof o.tare === "number"
        ? o.tare
        : Number(o.tare) || CAPACITY_MAP[type]?.tare || 0,
  };
}

function loadDraftContainerInfo(
  responsibleHint: string,
): LoadSessionContainerInfo {
  const base = emptyContainerInfo(responsibleHint);
  if (typeof window === "undefined") return base;
  try {
    const raw = window.localStorage.getItem(CONTAINER_DRAFT_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<LoadSessionContainerInfo>;
    const type = String(saved.type ?? base.type).trim() || "40";
    return {
      ...base,
      ...saved,
      type,
      responsible:
        String(saved.responsible ?? "").trim() ||
        responsibleHint ||
        base.responsible,
      tare:
        typeof saved.tare === "number"
          ? saved.tare
          : CAPACITY_MAP[type]?.tare ?? base.tare,
      date: String(saved.date ?? base.date).trim() || base.date,
    };
  } catch {
    return base;
  }
}

export function LoadScanPanel({
  kind,
  availableRas,
  userLabel,
  onMessage,
  onImmersiveChange,
}: LoadScanPanelProps) {
  const title = kind === "carga" ? "Cargue" : "Descarga";
  /** null = menú principal (solo cargue). */
  const [workRole, setWorkRole] = useState<WorkRole | null>(
    kind === "descarga" ? "escanear" : null,
  );
  const [sessions, setSessions] = useState<WarehouseLoadSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [session, setSession] = useState<WarehouseLoadSession | null>(null);
  const [progress, setProgress] = useState<LoadSessionRaProgress[]>([]);
  const [scans, setScans] = useState<WarehousePackageScan[]>([]);
  const [busy, setBusy] = useState(false);
  const [scanValue, setScanValue] = useState("");
  const [raQuickAdd, setRaQuickAdd] = useState("");
  const [flash, setFlash] = useState<{ tone: FlashTone; text: string }>({
    tone: null,
    text: "",
  });
  const [containerInfo, setContainerInfo] = useState<LoadSessionContainerInfo>(
    () => emptyContainerInfo(userLabel?.trim() || ""),
  );
  const [notesDraft, setNotesDraft] = useState("");
  const [showContainerEditor, setShowContainerEditor] = useState(false);
  const [expandedRa, setExpandedRa] = useState<string | null>(null);
  const [mountOk, setMountOk] = useState<string | null>(null);
  const [tablesMissing, setTablesMissing] = useState(false);
  const [readyCargas, setReadyCargas] = useState<
    Array<
      WarehouseLoadSession & {
        raCount: number;
        descargaSessionId: string | null;
      }
    >
  >([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const raAddRef = useRef<HTMLInputElement>(null);
  const draftHydrated = useRef(false);

  const reportError = useCallback(
    (e: unknown, fallback: string) => {
      if (isMissingLoadTablesError(e)) {
        setTablesMissing(true);
        onMessage?.(MISSING_TABLES_HINT);
        return;
      }
      onMessage?.(e instanceof Error ? e.message : fallback);
    },
    [onMessage],
  );

  // Borrador local del formulario (como Entrega de carga).
  useEffect(() => {
    if (kind !== "carga" || draftHydrated.current) return;
    draftHydrated.current = true;
    setContainerInfo(loadDraftContainerInfo(userLabel?.trim() || ""));
  }, [kind, userLabel]);

  useEffect(() => {
    if (kind !== "carga" || typeof window === "undefined") return;
    if (!draftHydrated.current) return;
    window.localStorage.setItem(
      CONTAINER_DRAFT_KEY,
      JSON.stringify(containerInfo),
    );
  }, [containerInfo, kind]);

  const sessionContainerInfo = useMemo(() => {
    if (!session) return null;
    return (
      parseContainerInfo(session.container_info, session.container_number) ?? {
        ...emptyContainerInfo(session.created_by || userLabel?.trim() || ""),
        number: session.container_number,
      }
    );
  }, [session, userLabel]);

  const refreshSessions = useCallback(async () => {
    const list = await listLoadSessions({ kind, status: "all" });
    setSessions(list);
    setTablesMissing(false);
    if (kind === "descarga") {
      const ready = await listCargaReadyForDescarga();
      setReadyCargas(ready);
    } else {
      setReadyCargas([]);
    }
  }, [kind]);

  const refreshActive = useCallback(async (id: string) => {
    const [s, ras, sc] = await Promise.all([
      fetchLoadSession(id),
      fetchSessionRas(id),
      fetchSessionScans(id),
    ]);
    setSession(s);
    setScans(sc);
    setProgress(buildSessionProgress(ras, sc));
  }, []);

  useEffect(() => {
    void refreshSessions().catch((e) => reportError(e, "Error listando sesiones"));
  }, [refreshSessions, reportError]);

  useEffect(() => {
    if (!activeId) {
      setSession(null);
      setProgress([]);
      setScans([]);
      return;
    }
    void refreshActive(activeId).catch((e) =>
      reportError(e, "Error cargando sesión"),
    );
  }, [activeId, refreshActive, reportError]);

  // Sync entre operarios: refresca progreso mientras la sesión está abierta.
  useEffect(() => {
    if (!activeId || session?.status !== "abierta") return;
    const tick = window.setInterval(() => {
      void refreshActive(activeId).catch(() => {
        /* silencioso en poll */
      });
      void refreshSessions().catch(() => {
        /* silencioso */
      });
    }, 3500);
    return () => window.clearInterval(tick);
  }, [activeId, session?.status, refreshActive, refreshSessions]);

  useEffect(() => {
    if (session?.status !== "abierta") return;
    if (workRole === "escanear") {
      window.setTimeout(() => inputRef.current?.focus(), 50);
    } else if (workRole === "montar") {
      window.setTimeout(() => raAddRef.current?.focus(), 50);
    }
  }, [session?.id, session?.status, workRole]);

  useEffect(() => {
    if (!session) return;
    const parsed =
      parseContainerInfo(session.container_info, session.container_number) ?? {
        ...emptyContainerInfo(session.created_by || userLabel?.trim() || ""),
        number: session.container_number,
      };
    setContainerInfo(parsed);
    setShowContainerEditor(false);
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- solo al cambiar de sesión

  const goHub = () => {
    if (kind !== "carga") return;
    setWorkRole(null);
    setShowContainerEditor(false);
  };

  const openPedidos = () => setWorkRole("montar");
  const openContar = () => setWorkRole("escanear");

  // Pantalla completa al entrar a Pedidos / Contar, o al abrir una descarga.
  useEffect(() => {
    const immersive =
      kind === "carga" ? workRole != null : Boolean(activeId);
    onImmersiveChange?.(immersive);
    return () => onImmersiveChange?.(false);
  }, [kind, workRole, activeId, onImmersiveChange]);

  const openSessions = useMemo(
    () => sessions.filter((s) => s.status === "abierta"),
    [sessions],
  );
  const closedSessions = useMemo(
    () => sessions.filter((s) => s.status === "cerrada").slice(0, 12),
    [sessions],
  );

  const totals = useMemo(() => {
    let exp = 0;
    let sc = 0;
    for (const p of progress) {
      exp += p.expectedBultos;
      sc += p.scannedBultos;
    }
    return { exp, sc };
  }, [progress]);

  const showFlash = (result: PackageScanResult) => {
    const tone: FlashTone =
      result.code === "ok"
        ? "ok"
        : result.code === "duplicate"
          ? "warn"
          : "error";
    const text =
      result.code === "duplicate"
        ? result.barcode
          ? `${DUPLICATE_SCAN_ALARM} (${result.barcode})`
          : DUPLICATE_SCAN_ALARM
        : result.message;
    setFlash({ tone, text });
    beep(tone === "ok" ? "ok" : tone === "warn" ? "warn" : "error");
    try {
      if (tone === "warn" && typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate([120, 80, 120, 80, 200]);
      }
    } catch {
      /* ignore */
    }
    window.setTimeout(
      () => setFlash({ tone: null, text: "" }),
      tone === "warn" ? 4500 : 2500,
    );
  };

  const createSession = async () => {
    if (kind === "descarga") {
      onMessage?.(
        "En Descarga elegí un contenedor ya cargado (señalado desde Cargue).",
      );
      return;
    }
    const number = containerInfo.number.trim();
    if (!number) {
      onMessage?.("Indicá el número de contenedor.");
      return;
    }
    setBusy(true);
    try {
      const info: LoadSessionContainerInfo = {
        ...containerInfo,
        number,
        responsible:
          containerInfo.responsible.trim() || userLabel?.trim() || "",
        tare:
          typeof containerInfo.tare === "number"
            ? containerInfo.tare
            : CAPACITY_MAP[containerInfo.type]?.tare ?? 0,
      };
      const s = await createLoadSession({
        kind,
        container_number: number,
        notes: notesDraft,
        created_by: userLabel ?? null,
        container_info: info,
      });
      setNotesDraft("");
      setActiveId(s.id);
      setWorkRole("montar");
      setShowContainerEditor(false);
      await refreshSessions();
      onMessage?.(
        `Cargue creado (${number}). Ahora asigná los RA al contenedor.`,
      );
    } catch (e) {
      reportError(e, "No se pudo crear");
    } finally {
      setBusy(false);
    }
  };

  const saveContainerEdits = async () => {
    if (!activeId || !session) return;
    const number = containerInfo.number.trim();
    if (!number) {
      onMessage?.("Indicá el número de contenedor.");
      return;
    }
    setBusy(true);
    try {
      const info: LoadSessionContainerInfo = {
        ...containerInfo,
        number,
        responsible:
          containerInfo.responsible.trim() || userLabel?.trim() || "",
      };
      const updated = await updateLoadSessionContainerInfo(activeId, info);
      setSession(updated);
      setShowContainerEditor(false);
      await refreshSessions();
      onMessage?.("Datos del contenedor actualizados.");
    } catch (e) {
      reportError(e, "No se pudo actualizar el contenedor");
    } finally {
      setBusy(false);
    }
  };

  const openFromCarga = async (cargaId: string) => {
    setBusy(true);
    try {
      const s = await openDescargaFromCarga({
        cargaSessionId: cargaId,
        created_by: userLabel ?? null,
      });
      setActiveId(s.id);
      setWorkRole("escanear");
      await refreshSessions();
      onMessage?.(
        `Descarga: contenedor ${s.container_number}. RA montados desde la carga.`,
      );
    } catch (e) {
      reportError(e, "No se pudo abrir descarga");
    } finally {
      setBusy(false);
    }
  };

  const mountByRaNumber = async (raw?: string) => {
    if (!activeId) return;
    const typed = String(raw ?? raQuickAdd).trim();
    if (!typed) return;
    const want = normalizeRaForPackageBarcode(typed);
    const match = availableRas.find(
      (r) => normalizeRaForPackageBarcode(r.ra) === want,
    );
    if (!match) {
      onMessage?.(
        `No encontré el RA ${want}. Revisá el número o el filtro de cliente.`,
      );
      beep("error");
      return;
    }
    const already = progress.some((p) => p.ra === want);
    if (already) {
      onMessage?.(`El RA ${want} ya está en el contenedor.`);
      setRaQuickAdd("");
      beep("warn");
      return;
    }
    setBusy(true);
    try {
      await addRasToSession(activeId, [match]);
      setRaQuickAdd("");
      await refreshActive(activeId);
      const bultos = match.expectedBultos || match.currentBultos || 0;
      setMountOk(`✓ RA ${want} agregado · ${bultos} bultos`);
      beep("ok");
      window.setTimeout(() => setMountOk(null), 2200);
      raAddRef.current?.focus();
    } catch (e) {
      reportError(e, "No se pudo montar el RA");
      beep("error");
    } finally {
      setBusy(false);
    }
  };

  const onScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeId || !scanValue.trim() || session?.status !== "abierta") return;
    const code = scanValue.trim();
    setScanValue("");

    // Detección local inmediata: no volver a contar el mismo bulto.
    const parsed = parsePackageBarcode(code);
    if (parsed) {
      const alreadyLocal = scans.some(
        (s) =>
          s.package_barcode === parsed.barcode ||
          (s.ra === parsed.ra && Number(s.package_seq) === parsed.seq),
      );
      if (alreadyLocal) {
        showFlash({
          code: "duplicate",
          message: DUPLICATE_SCAN_ALARM,
          ra: parsed.ra,
          seq: parsed.seq,
          barcode: parsed.barcode,
        });
        inputRef.current?.focus();
        return;
      }
    }

    try {
      const result = await recordPackageScan({
        sessionId: activeId,
        barcode: code,
        userLabel: userLabel ?? null,
      });
      showFlash(result);
      if (result.code === "ok") {
        await refreshActive(activeId);
      }
    } catch (err) {
      if (isMissingLoadTablesError(err)) {
        setTablesMissing(true);
        showFlash({ code: "invalid", message: MISSING_TABLES_HINT });
      } else {
        showFlash({
          code: "invalid",
          message: err instanceof Error ? err.message : "Error al escanear",
        });
      }
    }
    inputRef.current?.focus();
  };

  const doClose = async () => {
    if (!activeId || !session) return;
    if (kind === "carga") {
      if (
        !window.confirm(
          `¿Cerrar el cargue del contenedor ${session.container_number} y enviarlo a Descarga?\n\nEl operario de descarga podrá seleccionarlo.`,
        )
      ) {
        return;
      }
      setBusy(true);
      try {
        await closeCargaAndSignalDescarga(activeId);
        await refreshSessions();
        await refreshActive(activeId);
        onMessage?.(
          `Cargue cerrado. Contenedor ${session.container_number} listo en Descarga.`,
        );
      } catch (e) {
        reportError(e, "No se pudo cerrar");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (
      !window.confirm(
        `¿Cerrar esta descarga? No se podrán escanear más bultos.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await closeLoadSession(activeId);
      await refreshSessions();
      await refreshActive(activeId);
      onMessage?.("Descarga cerrada.");
    } catch (e) {
      reportError(e, "No se pudo cerrar");
    } finally {
      setBusy(false);
    }
  };

  const doExcel = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const [prog, sc] = await Promise.all([
        listSessionProgress(session.id),
        fetchSessionScans(session.id),
      ]);
      await downloadLoadSessionExcel({
        session,
        progress: prog,
        scans: sc,
      });
      onMessage?.("Excel descargado.");
    } catch (e) {
      reportError(e, "Error al exportar");
    } finally {
      setBusy(false);
    }
  };

  const flashClass =
    flash.tone === "ok"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
      : flash.tone === "warn"
        ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
        : flash.tone === "error"
          ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100"
          : "border-transparent bg-transparent";

  const mountedRas = new Set(progress.map((p) => p.ra));
  const pickable = availableRas.filter((r) => {
    if (!r.ra) return false;
    return !mountedRas.has(normalizeRaForPackageBarcode(r.ra));
  });

  const raSuggestions = useMemo(() => {
    const q = raQuickAdd.trim().toLowerCase();
    if (!q) return pickable;
    return pickable.filter((r) => {
      const ra = String(r.ra).toLowerCase();
      const client = String(r.clientDisplay).toLowerCase();
      return ra.includes(q) || client.includes(q);
    });
  }, [pickable, raQuickAdd]);

  const progressBlock = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase text-slate-500">
          Validación de bultos
        </p>
        <p className="text-xs font-black tabular-nums text-[#16263F] dark:text-slate-100">
          {totals.sc}/{totals.exp || "—"} bultos
        </p>
      </div>
      {progress.length === 0 ? (
        <p className="text-xs text-slate-400">
          Todavía no hay RA montados. El operario de montaje debe agregarlos.
        </p>
      ) : (
        progress.map((p) => {
          const pct =
            p.expectedBultos > 0
              ? Math.min(
                  100,
                  Math.round((p.scannedBultos / p.expectedBultos) * 100),
                )
              : p.scannedBultos > 0
                ? 100
                : 0;
          const complete =
            p.expectedBultos > 0 && p.scannedBultos >= p.expectedBultos;
          const open = expandedRa === p.ra;
          return (
            <div
              key={p.ra}
              className={`rounded-xl border p-2.5 ${
                complete
                  ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20"
                  : "border-slate-200 dark:border-slate-700"
              }`}
            >
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left"
                onClick={() =>
                  setExpandedRa((prev) => (prev === p.ra ? null : p.ra))
                }
              >
                <span className="text-sm font-black">{p.ra}</span>
                <span className="inline-flex items-center gap-2 text-xs font-bold tabular-nums">
                  {complete ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : p.scannedBultos === 0 ? (
                    <XCircle className="h-4 w-4 text-slate-300" />
                  ) : null}
                  {p.scannedBultos}/{p.expectedBultos || "—"}
                </span>
              </button>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className={`h-full rounded-full transition-all ${
                    complete ? "bg-emerald-600" : "bg-blue-600"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {open ? (
                <div className="mt-2 space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                  <p>
                    {p.clientDisplay || "—"} · {p.shipperLabel || "—"}
                  </p>
                  {p.orderBarcode ? (
                    <p className="font-mono text-[10px]">{p.orderBarcode}</p>
                  ) : null}
                  {p.missingSeqs.length > 0 ? (
                    <p>
                      Faltan:{" "}
                      {p.missingSeqs
                        .slice(0, 40)
                        .map((n) => String(n).padStart(3, "0"))
                        .join(", ")}
                      {p.missingSeqs.length > 40 ? "…" : ""}
                    </p>
                  ) : (
                    <p className="text-emerald-700 dark:text-emerald-300">
                      Completo
                    </p>
                  )}
                  {workRole === "montar" &&
                  session?.status === "abierta" &&
                  p.scannedBultos === 0 ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600"
                      onClick={() => {
                        if (
                          !window.confirm(
                            `¿Quitar RA ${p.ra} de esta sesión?`,
                          )
                        ) {
                          return;
                        }
                        void removeRaFromSession(session.id, p.ra)
                          .then(() => refreshActive(session.id))
                          .catch((e) =>
                            reportError(e, "No se pudo quitar"),
                          );
                      }}
                    >
                      <Trash2 className="h-3 w-3" /> Quitar RA
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {tablesMissing ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {MISSING_TABLES_HINT}
        </div>
      ) : null}

      {/* ─── Menú principal Cargue ─── */}
      {kind === "carga" && workRole === null ? (
        <div className="space-y-4">
          <p className="text-base font-black text-[#16263F] dark:text-slate-100">
            ¿Qué vas a hacer?
          </p>

          <button
            type="button"
            onClick={openPedidos}
            className="flex w-full items-center gap-4 rounded-2xl border-2 border-[#16263F] bg-[#16263F] px-5 py-5 text-left text-white shadow-sm transition active:scale-[0.99]"
          >
            <ClipboardList className="h-8 w-8 shrink-0 opacity-90" />
            <span className="min-w-0">
              <span className="block text-lg font-black">Pedidos</span>
              <span className="mt-0.5 block text-sm font-medium text-white/80">
                Datos del contenedor y asignar RAs
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={openContar}
            className="flex w-full items-center gap-4 rounded-2xl border-2 border-blue-600 bg-blue-600 px-5 py-5 text-left text-white shadow-sm transition active:scale-[0.99]"
          >
            <ScanLine className="h-8 w-8 shrink-0 opacity-90" />
            <span className="min-w-0">
              <span className="block text-lg font-black">Contar</span>
              <span className="mt-0.5 block text-sm font-medium text-white/80">
                Escanear etiquetas y validar bultos
              </span>
            </span>
          </button>

          {openSessions.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Contenedores abiertos
              </p>
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
                {openSessions.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-black text-[#16263F] dark:text-slate-100">
                      ● {s.container_number}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveId(s.id);
                        openPedidos();
                      }}
                      className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-[10px] font-black uppercase text-slate-700 dark:border-slate-600 dark:text-slate-200"
                    >
                      Pedidos
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveId(s.id);
                        openContar();
                      }}
                      className="rounded-xl bg-blue-600 px-2.5 py-1.5 text-[10px] font-black uppercase text-white"
                    >
                      Contar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Cabecera de pestaña completa */}
          <div className="flex items-center gap-2">
            {kind === "carga" || activeId ? (
              <button
                type="button"
                onClick={() => {
                  if (kind === "carga") {
                    goHub();
                    return;
                  }
                  setActiveId(null);
                  setSession(null);
                  setProgress([]);
                  setScans([]);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              >
                <ArrowLeft className="h-4 w-4" /> Volver
              </button>
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="text-base font-black text-[#16263F] dark:text-slate-100">
                {kind === "descarga"
                  ? "Descarga"
                  : workRole === "montar"
                    ? "Pedidos"
                    : "Contar bultos"}
              </p>
              <p className="text-[11px] font-semibold text-slate-500">
                {kind === "descarga"
                  ? "Contenedores listos desde Cargue"
                  : workRole === "montar"
                    ? "Datos del contenedor y asignar RAs"
                    : "Escanear etiquetas de bulto"}
              </p>
            </div>
          </div>

      {/* Cargue: nueva sesión con datos de contenedor (estilo Entrega de carga) */}
      {kind === "carga" && workRole === "montar" && !session ? (
        <div className="rounded-2xl border-2 border-[#16263F]/15 bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-slate-900">
          <p className="mb-1 text-base font-black text-[#16263F] dark:text-slate-100">
            Iniciar / cargar contenedor
          </p>
          <p className="mb-3 text-xs text-slate-500">
            Completá los datos del contenedor (igual que en Entrega de carga) y
            creá el cargue. Después asignás los RAs.
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <label className="space-y-1 text-xs">
              <span className="font-black uppercase tracking-wide text-slate-500">
                Tipo equipo
              </span>
              <select
                value={containerInfo.type}
                onChange={(e) => {
                  const type = e.target.value;
                  setContainerInfo((prev) => ({
                    ...prev,
                    type,
                    tare: CAPACITY_MAP[type]?.tare ?? prev.tare ?? 0,
                  }));
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2.5 text-xs font-bold text-[#16263F] outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-100"
              >
                {Object.keys(CAPACITY_MAP).map((k) => (
                  <option key={k} value={k}>
                    {CAPACITY_MAP[k]!.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-black uppercase tracking-wide text-slate-500">
                N° consignación
              </span>
              <input
                type="text"
                value={containerInfo.consignment}
                onChange={(e) =>
                  setContainerInfo((prev) => ({
                    ...prev,
                    consignment: e.target.value,
                  }))
                }
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2.5 text-xs font-bold uppercase text-[#16263F] outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-100"
                placeholder="Consignación"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-black uppercase tracking-wide text-slate-500">
                Contenedor
              </span>
              <input
                type="text"
                value={containerInfo.number}
                onChange={(e) =>
                  setContainerInfo((prev) => ({
                    ...prev,
                    number: e.target.value,
                  }))
                }
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2.5 text-xs font-bold uppercase text-[#16263F] outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-100"
                placeholder="Ej: HLXU1234567"
                autoFocus
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-black uppercase tracking-wide text-slate-500">
                Seguimiento / BL
              </span>
              <input
                type="text"
                value={containerInfo.bl}
                onChange={(e) =>
                  setContainerInfo((prev) => ({
                    ...prev,
                    bl: e.target.value,
                  }))
                }
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2.5 text-xs font-bold uppercase text-[#16263F] outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-100"
                placeholder="N° o referencia"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-black uppercase tracking-wide text-slate-500">
                Sello 1
              </span>
              <input
                type="text"
                value={containerInfo.seal1}
                onChange={(e) =>
                  setContainerInfo((prev) => ({
                    ...prev,
                    seal1: e.target.value,
                  }))
                }
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2.5 text-xs font-bold text-[#16263F] outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-100"
                placeholder="Sello principal"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-black uppercase tracking-wide text-slate-500">
                Sello 2
              </span>
              <input
                type="text"
                value={containerInfo.seal2}
                onChange={(e) =>
                  setContainerInfo((prev) => ({
                    ...prev,
                    seal2: e.target.value,
                  }))
                }
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2.5 text-xs font-bold text-[#16263F] outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-100"
                placeholder="Opcional"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-black uppercase tracking-wide text-slate-500">
                Tara (kg)
              </span>
              <input
                type="number"
                step="1"
                value={containerInfo.tare ?? ""}
                onChange={(e) =>
                  setContainerInfo((prev) => ({
                    ...prev,
                    tare: Number(e.target.value) || 0,
                  }))
                }
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2.5 text-xs font-bold text-[#16263F] outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-100"
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-black uppercase tracking-wide text-slate-500">
                Fecha llegada
              </span>
              <input
                type="date"
                value={containerInfo.date}
                onChange={(e) =>
                  setContainerInfo((prev) => ({
                    ...prev,
                    date: e.target.value,
                  }))
                }
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2.5 text-xs font-bold text-[#16263F] outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-100"
              />
            </label>
            <label className="col-span-2 space-y-1 text-xs md:col-span-2">
              <span className="font-black uppercase tracking-wide text-slate-500">
                Responsable de cargue
              </span>
              <input
                type="text"
                value={containerInfo.responsible}
                onChange={(e) =>
                  setContainerInfo((prev) => ({
                    ...prev,
                    responsible: e.target.value,
                  }))
                }
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2.5 text-xs font-bold text-[#16263F] outline-none focus:border-blue-500 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-100"
                placeholder={userLabel?.trim() || "Nombre del responsable"}
              />
            </label>
            <label className="col-span-2 space-y-1 text-xs md:col-span-2">
              <span className="font-black uppercase tracking-wide text-slate-400">
                Nota (opcional)
              </span>
              <input
                value={notesDraft}
                onChange={(e) => setNotesDraft(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-2.5 py-2.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                placeholder=""
              />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={
                busy || !containerInfo.number.trim() || tablesMissing
              }
              onClick={() => void createSession()}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#16263F] px-6 text-sm font-black uppercase text-white disabled:opacity-50"
            >
              <Plus className="h-5 w-5" /> Crear cargue
            </button>
            <p className="text-[11px] text-slate-500">
              Capacidad ref.:{" "}
              {CAPACITY_MAP[containerInfo.type]?.maxCbm ?? "—"} m³ · Tara{" "}
              {containerInfo.tare ?? 0} kg
            </p>
          </div>
        </div>
      ) : null}

      {kind === "carga" && workRole === "escanear" && !session ? (
        <p className="text-sm text-slate-500">
          Tocá el contenedor abierto abajo para empezar a contar bultos.
        </p>
      ) : null}

      {kind === "descarga" ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
          <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-blue-800 dark:text-blue-200">
            Contenedores listos (desde Cargue)
          </p>
          {readyCargas.length === 0 && !tablesMissing ? (
            <p className="text-xs text-blue-900/80 dark:text-blue-100/80">
              Todavía no hay contenedores señalados. En Cargue, cuando terminen,
              usá «Cerrar y enviar a descarga».
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            {readyCargas.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-white px-3 py-2 dark:border-blue-800 dark:bg-slate-900"
              >
                <div className="min-w-0">
                  <p className="text-sm font-black text-[#16263F] dark:text-slate-100">
                    {c.container_number}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {c.raCount} RA ·{" "}
                    {c.descargaSessionId
                      ? "Ya tiene sesión de descarga"
                      : "Pendiente de abrir"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy || tablesMissing}
                  onClick={() => {
                    if (c.descargaSessionId) {
                      setActiveId(c.descargaSessionId);
                      setWorkRole("escanear");
                      return;
                    }
                    void openFromCarga(c.id);
                  }}
                  className="rounded-xl bg-blue-600 px-3 py-2 text-[10px] font-black uppercase text-white disabled:opacity-50"
                >
                  {c.descargaSessionId ? "Abrir" : "Iniciar descarga"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Lista sesiones */}
      <div className="flex flex-wrap gap-2">
        {openSessions.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveId(s.id)}
            className={`rounded-xl border px-3 py-1.5 text-[11px] font-bold ${
              activeId === s.id
                ? workRole === "escanear"
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-[#16263F] bg-[#16263F] text-white"
                : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100"
            }`}
          >
            ● {s.container_number}
          </button>
        ))}
        {closedSessions.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveId(s.id)}
            className={`rounded-xl border px-3 py-1.5 text-[11px] font-semibold ${
              activeId === s.id
                ? "border-slate-700 bg-slate-700 text-white"
                : "border-slate-200 text-slate-500 dark:border-slate-700"
            }`}
          >
            {s.container_number}
          </button>
        ))}
        {sessions.length === 0 && !tablesMissing ? (
          <span className="text-xs text-slate-400">Sin sesiones aún.</span>
        ) : null}
      </div>

      {session ? (
        <div className="space-y-3 rounded-2xl border border-slate-200 p-3 dark:border-slate-700 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-black text-[#16263F] dark:text-slate-100">
                {title}: {session.container_number}
              </p>
              <p className="text-[11px] text-slate-500">
                {session.status === "abierta" ? "Abierta" : "Cerrada"} ·{" "}
                {progress.length} RA · {totals.sc}/{totals.exp || "—"} bultos
              </p>
              {sessionContainerInfo ? (
                <p className="mt-0.5 text-[10px] font-semibold text-slate-500">
                  {CAPACITY_MAP[sessionContainerInfo.type]?.name ||
                    sessionContainerInfo.type ||
                    "Equipo"}
                  {sessionContainerInfo.seal1
                    ? ` · Sello ${sessionContainerInfo.seal1}`
                    : ""}
                  {sessionContainerInfo.bl
                    ? ` · Seg. ${sessionContainerInfo.bl}`
                    : ""}
                  {sessionContainerInfo.responsible
                    ? ` · ${sessionContainerInfo.responsible}`
                    : ""}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {kind === "carga" && workRole === "montar" ? (
                <button
                  type="button"
                  onClick={() => {
                    setActiveId(null);
                    setSession(null);
                    setProgress([]);
                    setShowContainerEditor(false);
                    setContainerInfo(
                      loadDraftContainerInfo(userLabel?.trim() || ""),
                    );
                  }}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-[10px] font-black uppercase text-slate-600 dark:border-slate-600 dark:text-slate-300"
                >
                  Nuevo cargue
                </button>
              ) : null}
              {kind === "carga" &&
              workRole === "montar" &&
              session.status === "abierta" ? (
                <button
                  type="button"
                  onClick={() => setShowContainerEditor((v) => !v)}
                  className="rounded-xl border border-blue-200 px-3 py-2 text-[10px] font-black uppercase text-blue-800 dark:border-blue-800 dark:text-blue-200"
                >
                  {showContainerEditor ? "Ocultar datos" : "Editar contenedor"}
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => void doExcel()}
                className="inline-flex items-center gap-1 rounded-xl border border-emerald-600 px-3 py-2 text-[10px] font-black uppercase text-emerald-700 dark:text-emerald-300"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
              </button>
              {session.status === "abierta" &&
              (workRole === "montar" || kind === "descarga") ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void doClose()}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-[10px] font-black uppercase dark:border-slate-600"
                >
                  {kind === "carga"
                    ? "Cerrar y enviar a descarga"
                    : "Cerrar descarga"}
                </button>
              ) : null}
            </div>
          </div>

          {kind === "carga" &&
          workRole === "montar" &&
          showContainerEditor &&
          session.status === "abierta" ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900 dark:bg-blue-950/30">
              <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-blue-800 dark:text-blue-200">
                Datos del contenedor
              </p>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <label className="text-[10px]">
                  <span className="font-bold text-slate-500">Tipo</span>
                  <select
                    value={containerInfo.type}
                    onChange={(e) => {
                      const type = e.target.value;
                      setContainerInfo((prev) => ({
                        ...prev,
                        type,
                        tare: CAPACITY_MAP[type]?.tare ?? prev.tare ?? 0,
                      }));
                    }}
                    className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                  >
                    {Object.keys(CAPACITY_MAP).map((k) => (
                      <option key={k} value={k}>
                        {CAPACITY_MAP[k]!.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[10px]">
                  <span className="font-bold text-slate-500">Contenedor</span>
                  <input
                    value={containerInfo.number}
                    onChange={(e) =>
                      setContainerInfo((prev) => ({
                        ...prev,
                        number: e.target.value,
                      }))
                    }
                    className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-xs font-bold uppercase dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <label className="text-[10px]">
                  <span className="font-bold text-slate-500">Consignación</span>
                  <input
                    value={containerInfo.consignment}
                    onChange={(e) =>
                      setContainerInfo((prev) => ({
                        ...prev,
                        consignment: e.target.value,
                      }))
                    }
                    className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-xs font-bold uppercase dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <label className="text-[10px]">
                  <span className="font-bold text-slate-500">Seguimiento</span>
                  <input
                    value={containerInfo.bl}
                    onChange={(e) =>
                      setContainerInfo((prev) => ({
                        ...prev,
                        bl: e.target.value,
                      }))
                    }
                    className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-xs font-bold uppercase dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <label className="text-[10px]">
                  <span className="font-bold text-slate-500">Sello 1</span>
                  <input
                    value={containerInfo.seal1}
                    onChange={(e) =>
                      setContainerInfo((prev) => ({
                        ...prev,
                        seal1: e.target.value,
                      }))
                    }
                    className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <label className="text-[10px]">
                  <span className="font-bold text-slate-500">Sello 2</span>
                  <input
                    value={containerInfo.seal2}
                    onChange={(e) =>
                      setContainerInfo((prev) => ({
                        ...prev,
                        seal2: e.target.value,
                      }))
                    }
                    className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <label className="text-[10px]">
                  <span className="font-bold text-slate-500">Tara</span>
                  <input
                    type="number"
                    value={containerInfo.tare ?? ""}
                    onChange={(e) =>
                      setContainerInfo((prev) => ({
                        ...prev,
                        tare: Number(e.target.value) || 0,
                      }))
                    }
                    className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <label className="text-[10px]">
                  <span className="font-bold text-slate-500">Fecha</span>
                  <input
                    type="date"
                    value={containerInfo.date}
                    onChange={(e) =>
                      setContainerInfo((prev) => ({
                        ...prev,
                        date: e.target.value,
                      }))
                    }
                    className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
                <label className="col-span-2 text-[10px]">
                  <span className="font-bold text-slate-500">Responsable</span>
                  <input
                    value={containerInfo.responsible}
                    onChange={(e) =>
                      setContainerInfo((prev) => ({
                        ...prev,
                        responsible: e.target.value,
                      }))
                    }
                    className="mt-0.5 w-full rounded-lg border px-2 py-1.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={busy || !containerInfo.number.trim()}
                onClick={() => void saveContainerEdits()}
                className="mt-3 rounded-xl bg-[#16263F] px-3 py-2 text-[10px] font-black uppercase text-white disabled:opacity-50"
              >
                Guardar datos
              </button>
            </div>
          ) : null}

          {/* ─── Rol: Montar (simple) ─── */}
          {workRole === "montar" && session.status === "abierta" ? (
            <div className="space-y-3">
              {mountOk ? (
                <div className="rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
                  {mountOk}
                </div>
              ) : null}

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-950/40">
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void mountByRaNumber();
                  }}
                >
                  <label className="sr-only" htmlFor="load-ra-quick-add">
                    Buscar RA
                  </label>
                  <div className="relative w-full max-w-[14rem] sm:max-w-[16rem]">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      id="load-ra-quick-add"
                      ref={raAddRef}
                      value={raQuickAdd}
                      onChange={(e) => setRaQuickAdd(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs font-bold tabular-nums outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-slate-700 dark:bg-slate-900 sm:rounded-xl sm:py-2 sm:text-sm"
                      placeholder="Buscar RA…"
                      inputMode="numeric"
                      autoComplete="off"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy || !raQuickAdd.trim()}
                    className="shrink-0 rounded-lg bg-[#16263F] px-3 py-1.5 text-[10px] font-black uppercase text-white disabled:opacity-40 sm:rounded-xl sm:py-2"
                  >
                    + Agregar
                  </button>
                </form>

                {raSuggestions.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    <p className="text-[10px] text-slate-500">
                      Sugerencias ({raSuggestions.length})
                    </p>
                    <div className="max-h-[min(75vh,42rem)] min-h-[16rem] overflow-auto overscroll-contain rounded-lg border border-slate-200 dark:border-slate-700">
                      <table className="w-full min-w-[560px] text-left text-xs">
                        <thead className="sticky top-0 z-[1] bg-white dark:bg-slate-950">
                          <tr className="border-b text-[10px] uppercase text-slate-400">
                            <th className="px-3 py-2">RA</th>
                            <th className="px-2 py-2">Cliente</th>
                            <th className="px-2 py-2">Expedidor</th>
                            <th className="px-2 py-2">Bultos</th>
                            <th className="px-3 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {raSuggestions.map((r) => {
                            const bultos =
                              r.expectedBultos || r.currentBultos || 0;
                            return (
                              <tr
                                key={r.taskId}
                                className="border-b border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900/60"
                              >
                                <td className="px-3 py-2 font-black tabular-nums text-[#16263F] dark:text-slate-100">
                                  {r.ra}
                                </td>
                                <td className="px-2 py-2">
                                  {r.clientDisplay || "—"}
                                </td>
                                <td className="max-w-[12rem] truncate px-2 py-2">
                                  {r.shipper || "—"}
                                </td>
                                <td className="px-2 py-2 tabular-nums">
                                  {bultos}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      void mountByRaNumber(String(r.ra))
                                    }
                                    className="text-[10px] font-bold text-blue-600 disabled:opacity-50"
                                  >
                                    + Agregar
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : raQuickAdd.trim() ? (
                  <p className="mt-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                    Sin coincidencias. Revisá el nº o el cliente filtrado.
                  </p>
                ) : pickable.length === 0 ? (
                  <p className="mt-1.5 text-[10px] text-slate-500">
                    No hay RA pendientes para este filtro.
                  </p>
                ) : null}
              </div>

              {/* En el contenedor — lista plana */}
              <div>
                <p className="mb-2 text-sm font-black text-[#16263F] dark:text-slate-100">
                  En este contenedor ({progress.length})
                </p>
                {progress.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400 dark:border-slate-600">
                    Todavía vacío. Agregá el primer RA arriba.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                    <table className="w-full min-w-[420px] text-left text-xs">
                      <thead>
                        <tr className="border-b text-[10px] uppercase text-slate-400">
                          <th className="px-3 py-2">RA</th>
                          <th className="px-2 py-2">Cliente</th>
                          <th className="px-2 py-2">Bultos</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {progress.map((p) => (
                          <tr
                            key={p.ra}
                            className="border-b border-slate-100 dark:border-slate-800"
                          >
                            <td className="px-3 py-2 font-black tabular-nums text-[#16263F] dark:text-slate-100">
                              {p.ra}
                            </td>
                            <td className="px-2 py-2 text-slate-600 dark:text-slate-300">
                              {p.clientDisplay || "—"}
                            </td>
                            <td className="px-2 py-2 tabular-nums">
                              {p.scannedBultos > 0
                                ? `${p.scannedBultos}/${p.expectedBultos}`
                                : p.expectedBultos}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {p.scannedBultos === 0 ? (
                                <button
                                  type="button"
                                  title="Quitar"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                  onClick={() => {
                                    if (
                                      !window.confirm(
                                        `¿Sacar RA ${p.ra} del contenedor?`,
                                      )
                                    ) {
                                      return;
                                    }
                                    void removeRaFromSession(session.id, p.ra)
                                      .then(() => refreshActive(session.id))
                                      .catch((e) =>
                                        reportError(e, "No se pudo quitar"),
                                      );
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              ) : (
                                <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300">
                                  escaneando
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* ─── Rol: escanear ─── */}
          {workRole === "escanear" ? (
            <>
              <div
                className={`min-h-[2.5rem] rounded-xl border px-3 py-2 text-sm font-bold transition ${flashClass} ${
                  flash.tone === "warn" ? "animate-pulse text-base" : ""
                }`}
              >
                {flash.text || (
                  <span className="font-normal text-slate-400">
                    Esperando lectura de etiqueta…
                  </span>
                )}
              </div>

              {session.status === "abierta" ? (
                progress.length === 0 ? (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                    Aún no hay RA montados. Pedile al otro operario que agregue
                    los RA del contenedor.
                  </p>
                ) : (
                  <form
                    onSubmit={(e) => void onScanSubmit(e)}
                    className="space-y-2"
                  >
                    <label className="block text-xs font-bold uppercase text-slate-500">
                      Escanear bulto
                    </label>
                    <div className="flex gap-2">
                      <div className="relative min-w-0 flex-1">
                        <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                        <input
                          ref={inputRef}
                          value={scanValue}
                          onChange={(e) => setScanValue(e.target.value)}
                          className="w-full rounded-2xl border-2 border-blue-300 bg-white py-3 pl-11 pr-3 text-lg font-bold tracking-wide outline-none focus:border-blue-600 dark:border-blue-800 dark:bg-slate-950"
                          placeholder="424/AAA64353-1 · 64368-001"
                          autoComplete="off"
                          inputMode="text"
                        />
                      </div>
                      <button
                        type="submit"
                        className="rounded-2xl bg-blue-600 px-5 text-sm font-black text-white"
                      >
                        OK
                      </button>
                    </div>
                  </form>
                )
              ) : (
                <p className="text-xs text-slate-400">Sesión cerrada.</p>
              )}
            </>
          ) : null}

          {workRole === "escanear" ? progressBlock : null}

          {busy ? (
            <p className="inline-flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Trabajando…
            </p>
          ) : null}
          {scans.length > 0 ? (
            <p className="text-[10px] text-slate-400">
              Último scan: {scans[scans.length - 1]?.package_barcode} ·{" "}
              {scans.length} lecturas
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          {workRole === "montar"
            ? "Creá un contenedor arriba o tocá uno abierto."
            : "Tocá un contenedor abierto para contar bultos."}
        </p>
      )}
        </div>
      )}
    </div>
  );
}
