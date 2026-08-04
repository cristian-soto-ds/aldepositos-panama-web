"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Barcode,
  CheckSquare,
  Copy,
  FileSpreadsheet,
  Loader2,
  Merge,
  Package,
  RefreshCw,
  UserRound,
  XSquare,
} from "lucide-react";
import type { Task } from "@/lib/types/task";
import type { AppRole } from "@/lib/userRole";
import {
  createShipper,
  ensureRaBarcode,
  ensureShipperByName,
  fetchWarehouseClients,
  fetchWarehouseRaCodes,
  fetchWarehouseShippers,
  matchShipperByName,
  syncShippersFromRaNames,
  syncOrderBarcodesFromRas,
  unifyShippers,
  unlinkShipperAlias,
} from "@/lib/warehouse/api";
import {
  clientDisplayName,
  normalizeWarehouseClientText,
  shipperAliasesList,
} from "@/lib/warehouse/client-resolver";
import {
  buildPackageBarcodeList,
  DEFAULT_PACKAGE_BARCODE_FORMAT,
  isCompletedInventoryStatus,
  loadPackageBarcodeFormat,
  mapTaskToWarehouseRA,
  PACKAGE_BARCODE_FORMAT_OPTIONS,
  savePackageBarcodeFormat,
  type PackageBarcodeFormat,
} from "@/lib/warehouse/task-adapter";
import {
  CANONICAL_WAREHOUSE_CLIENTS,
  CLIENT_DISPLAY_NAMES,
  PENDING_SHIPPER_LABEL,
  type CanonicalWarehouseClient,
  type WarehouseClientRow,
  type WarehouseRaCode,
  type WarehouseRAView,
  type WarehouseShipper,
} from "@/lib/warehouse/types";
import {
  buildXellentCsv,
  buildXellentPackageCsv,
  buildXellentRaCsv,
  copyToClipboard,
  downloadTextFile,
  type XellentCodeRow,
} from "@/lib/warehouse/xellent-export";
import {
  LabelPrinter,
  type LabelPrintData,
} from "@/components/control-carga/LabelPrinter";
import { LoadScanPanel } from "@/components/control-carga/LoadScanPanel";
import { supabase } from "@/lib/supabase";

type ControlCargaModuleProps = {
  userRole: AppRole;
  userDisplayName?: string | null;
};

type TabId = "Todos" | CanonicalWarehouseClient;
type SectionId = "ras" | "expedidores" | "etiquetas" | "carga" | "descarga";

export function ControlCargaModule({
  userDisplayName,
}: ControlCargaModuleProps) {
  const [tab, setTab] = useState<TabId>("AAA");
  const [section, setSection] = useState<SectionId>("ras");
  const [clients, setClients] = useState<WarehouseClientRow[]>([]);
  const [shippers, setShippers] = useState<WarehouseShipper[]>([]);
  const [, setRaCodes] = useState<WarehouseRaCode[]>([]);
  const [ras, setRas] = useState<WarehouseRAView[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [printLabels, setPrintLabels] = useState<LabelPrintData[] | null>(null);
  const [packageFormat, setPackageFormat] = useState<PackageBarcodeFormat>(
    DEFAULT_PACKAGE_BARCODE_FORMAT,
  );
  /** RAs marcados para CSV / impresión masiva (por taskId). */
  const [selectedRaIds, setSelectedRaIds] = useState<Set<string>>(
    () => new Set(),
  );
  /** Selección múltiple solo cuando el operador la habilita. */
  const [raSelectMode, setRaSelectMode] = useState(false);
  /** Pedidos/Contar (o Descarga): ocupa toda la vista sin cabecera. */
  const [loadImmersive, setLoadImmersive] = useState(false);

  // Crear / unificar expedidor
  const [newShipperName, setNewShipperName] = useState("");
  const [unifyTargetId, setUnifyTargetId] = useState("");
  const [unifyMergeIds, setUnifyMergeIds] = useState<string[]>([]);
  const [unifyExtraNames, setUnifyExtraNames] = useState("");

  useEffect(() => {
    setPackageFormat(loadPackageBarcodeFormat());
  }, []);

  useEffect(() => {
    if (section !== "carga" && section !== "descarga") {
      setLoadImmersive(false);
    }
  }, [section]);

  const onLoadImmersiveChange = useCallback((immersive: boolean) => {
    setLoadImmersive(immersive);
  }, []);

  const changePackageFormat = (next: PackageBarcodeFormat) => {
    setPackageFormat(next);
    savePackageBarcodeFormat(next);
    const opt = PACKAGE_BARCODE_FORMAT_OPTIONS.find((o) => o.id === next);
    setMessage(
      `Formato de bulto: ${opt?.label ?? next} (ej. ${opt?.example ?? ""})`,
    );
  };

  const loadCompletedRas = useCallback(
    async (clientRows: WarehouseClientRow[], codes: WarehouseRaCode[]) => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, payload")
        .order("updated_at", { ascending: false })
        .limit(3000);
      if (error) throw error;

      const byTask = new Map(codes.map((x) => [x.task_id, x]));
      const out: WarehouseRAView[] = [];
      for (const row of (data ?? []) as { id: string; payload: Task }[]) {
        const payload = { ...row.payload, id: row.id };
        if (!isCompletedInventoryStatus(payload.status)) continue;
        const view = mapTaskToWarehouseRA(payload, clientRows);
        if (!view.recognized || !view.clientCode) continue;
        const existing = byTask.get(row.id);
        out.push({
          ...view,
          raBarcode: existing?.barcode_code ?? null,
          shipperId: existing?.shipper_id ?? null,
        });
      }
      return out;
    },
    [],
  );

  /** Crea expedidores (con barcode) desde nombres de RA que aún no tienen código. */
  const autoSyncShippersFromRas = useCallback(
    async (
      raViews: WarehouseRAView[],
      currentShippers: WarehouseShipper[],
    ) => {
      const entries = raViews
        .filter(
          (r) =>
            r.clientCode &&
            r.shipper &&
            r.shipper !== PENDING_SHIPPER_LABEL,
        )
        .map((r) => ({
          clientCode: String(r.clientCode),
          shipperName: r.shipper,
        }));
      return syncShippersFromRaNames(entries, currentShippers);
    },
    [],
  );

  const refreshAll = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const c = await fetchWarehouseClients();
      let s = await fetchWarehouseShippers();
      let codes = await fetchWarehouseRaCodes();
      setClients(c);

      let raViews = await loadCompletedRas(c, codes);
      setRas(raViews);

      const synced = await autoSyncShippersFromRas(raViews, s);
      s = synced.shippers;
      setShippers(s);

      // Igual que expedidores: generar códigos de pedido automáticamente
      const orderSync = await syncOrderBarcodesFromRas(raViews, s);
      codes = orderSync.codes;
      setRaCodes(codes);
      raViews = await loadCompletedRas(c, codes);
      setRas(raViews);

      const parts: string[] = [];
      if (synced.createdCount > 0) {
        parts.push(
          `${synced.createdCount} expedidor(es) con código`,
        );
      }
      if (synced.mergedDuplicates > 0) {
        parts.push(
          `${synced.mergedDuplicates} duplicado(s) unificados`,
        );
      }
      if (orderSync.createdCount > 0) {
        parts.push(
          `${orderSync.createdCount} código(s) de pedido (EXP+RA)`,
        );
      }
      if (orderSync.errors.length > 0) {
        parts.push(
          `aviso: ${orderSync.errors[0]}${orderSync.errors.length > 1 ? ` (+${orderSync.errors.length - 1})` : ""}`,
        );
      }
      if (parts.length) {
        setMessage(`RA cargadas. ${parts.join("; ")}.`);
      }
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : e && typeof e === "object" && "message" in e
            ? String((e as { message: unknown }).message)
            : "Error cargando datos (¿aplicaste migraciones 017/018?)";
      setMessage(msg);
    } finally {
      setBusy(false);
    }
  }, [autoSyncShippersFromRas, loadCompletedRas]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const filteredRas = useMemo(() => {
    const list = tab === "Todos" ? ras : ras.filter((r) => r.clientCode === tab);
    // Siempre RA mayor → menor (numérico; si no parsea, al final).
    return [...list].sort((a, b) => {
      const na = parseInt(String(a.ra).replace(/\D/g, ""), 10);
      const nb = parseInt(String(b.ra).replace(/\D/g, ""), 10);
      const va = Number.isFinite(na) ? na : -1;
      const vb = Number.isFinite(nb) ? nb : -1;
      if (vb !== va) return vb - va;
      return String(b.ra).localeCompare(String(a.ra));
    });
  }, [ras, tab]);

  const selectedRas = useMemo(
    () => filteredRas.filter((r) => selectedRaIds.has(r.taskId)),
    [filteredRas, selectedRaIds],
  );

  const allFilteredSelected =
    filteredRas.length > 0 && selectedRas.length === filteredRas.length;

  const toggleRaSelected = (taskId: string) => {
    setSelectedRaIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedRaIds(new Set(filteredRas.map((r) => r.taskId)));
  };

  const deselectAll = () => {
    setSelectedRaIds(new Set());
  };

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) deselectAll();
    else selectAllFiltered();
  };

  const setRaSelectionEnabled = (enabled: boolean) => {
    setRaSelectMode(enabled);
    if (!enabled) setSelectedRaIds(new Set());
  };

  const filteredShippers = useMemo(() => {
    if (tab === "Todos") return shippers;
    return shippers.filter((s) => s.client_code === tab);
  }, [shippers, tab]);

  const orphanShipperNames = useMemo(() => {
    const known = new Set<string>();
    for (const s of shippers) {
      known.add(normalizeWarehouseClientText(s.official_name));
      known.add(normalizeWarehouseClientText(s.normalized_name));
      for (const a of shipperAliasesList(s.aliases)) {
        known.add(normalizeWarehouseClientText(a));
      }
    }
    const orphans = new Set<string>();
    for (const r of filteredRas) {
      if (r.shipper === PENDING_SHIPPER_LABEL) continue;
      const key = normalizeWarehouseClientText(r.shipper);
      if (key && !known.has(key)) {
        orphans.add(r.shipper);
      }
    }
    return Array.from(orphans).sort((a, b) => a.localeCompare(b));
  }, [filteredRas, shippers]);

  const generateRaCode = async (view: WarehouseRAView) => {
    if (!view.clientCode) return;
    if (!view.shipper || view.shipper === PENDING_SHIPPER_LABEL) {
      setMessage(
        "Esta RA no tiene expedidor. Asignalo en inventario o crealo en Expedidores antes de generar el código del pedido.",
      );
      return;
    }
    setBusy(true);
    try {
      let list = shippers;
      let matched = matchShipperByName(
        list,
        view.shipper,
        view.clientCode,
      );
      if (!matched) {
        const ensured = await ensureShipperByName({
          client_code: view.clientCode,
          official_name: view.shipper,
          shippers: list,
        });
        matched = ensured.shipper;
        if (ensured.created) {
          list = [...list, ensured.shipper];
          setShippers(list);
        }
      }
      const row = await ensureRaBarcode({
        task_id: view.taskId,
        ra: view.ra,
        client_code: view.clientCode,
        shipper_id: matched.id,
        shipper_barcode: matched.barcode_code,
        provider: view.provider || null,
        order_ref: view.orderRef || null,
        shipper_label: view.shipper,
      });
      setRaCodes((prev) => {
        const rest = prev.filter((x) => x.task_id !== view.taskId);
        return [row, ...rest];
      });
      setRas((prev) =>
        prev.map((r) =>
          r.taskId === view.taskId
            ? {
                ...r,
                raBarcode: row.barcode_code,
                shipperId: row.shipper_id,
              }
            : r,
        ),
      );
      setMessage(
        `Pedido ${row.barcode_code} · etiquetas de bulto: ${view.ra}-001 …`,
      );
      const total = resolvePackageTotal(view);
      if (total == null) return;
      const pack = packageLabelsFromRa(view, total);
      if (!pack?.length) {
        setMessage(
          "Código de pedido listo, pero no hay bultos para etiquetar.",
        );
        return;
      }
      setPrintLabels(pack);
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : e && typeof e === "object" && "message" in e
            ? String((e as { message: unknown }).message)
            : "Error generando código de pedido";
      setMessage(msg);
    } finally {
      setBusy(false);
    }
  };

  const addShipper = async () => {
    const name = newShipperName.trim();
    if (!name) return;
    const clientCode = tab === "Todos" ? "AAA" : tab;
    setBusy(true);
    try {
      const s = await createShipper({
        client_code: clientCode,
        official_name: name,
      });
      setShippers((prev) =>
        [...prev, s].sort((a, b) =>
          a.official_name.localeCompare(b.official_name),
        ),
      );
      setNewShipperName("");
      setMessage(`Expedidor creado: ${s.barcode_code}`);
      setPrintLabels([
        {
          kind: "EXPEDIDOR",
          barcode: s.barcode_code,
          clientDisplay: clientDisplayName(clientCode, clients),
          title: s.official_name,
          shipperName: s.official_name,
        },
      ]);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error creando expedidor");
    } finally {
      setBusy(false);
    }
  };

  const doUnify = async () => {
    if (!unifyTargetId) {
      setMessage("Elegí el expedidor canónico (código que se conserva)");
      return;
    }
    setBusy(true);
    try {
      const extras = unifyExtraNames
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const updated = await unifyShippers({
        targetShipperId: unifyTargetId,
        mergeShipperIds: unifyMergeIds,
        extraAliasNames: extras,
      });
      setShippers(await fetchWarehouseShippers());
      setUnifyMergeIds([]);
      setUnifyExtraNames("");
      setMessage(
        `Unificados bajo ${updated.barcode_code} (${updated.official_name})`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error al unificar");
    } finally {
      setBusy(false);
    }
  };

  const doUnlinkAlias = async (shipperId: string, aliasName: string) => {
    if (
      !window.confirm(
        `¿Desvincular «${aliasName}»?\n\nVolverá a tener su propio código EXP (o se reactiva el que tenía).`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const { restored } = await unlinkShipperAlias({
        shipperId,
        aliasName,
      });
      setShippers(await fetchWarehouseShippers());
      setMessage(
        restored
          ? `Desvinculado: ${restored.official_name} → ${restored.barcode_code}`
          : `Alias «${aliasName}» quitado`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error al desvincular");
    } finally {
      setBusy(false);
    }
  };

  /** Cantidad de bultos del pedido; si falta, pide al operador. */
  const resolvePackageTotal = (view: WarehouseRAView): number | null => {
    let total = Math.max(
      0,
      Math.round(view.expectedBultos || view.currentBultos || 0),
    );
    if (total >= 1) return total;
    const raw = window.prompt(
      `¿Cuántos bultos tiene el pedido RA ${view.ra}? Se generará un código por bulto.`,
      "",
    );
    if (raw == null) return null;
    total = Math.max(0, Math.floor(Number(String(raw).trim()) || 0));
    if (total < 1) {
      setMessage("Indicá un número de bultos mayor a 0.");
      return null;
    }
    return total;
  };

  /**
   * Una etiqueta = un código por bulto según el formato elegido
   * (corto / completo EXP / expedidor+RA+bulto).
   */
  const packageLabelsFromRa = (
    view: WarehouseRAView,
    totalOverride?: number,
  ): LabelPrintData[] | null => {
    const total =
      totalOverride ??
      Math.max(0, Math.round(view.expectedBultos || view.currentBultos || 0));
    if (!view.ra || total < 1) return null;
    const sh = view.shipperId
      ? shippers.find((s) => s.id === view.shipperId)
      : matchShipperByName(shippers, view.shipper, view.clientCode ?? undefined);
    if (
      (packageFormat === "completo" || packageFormat === "expedidor_ra_bulto") &&
      !view.raBarcode &&
      !sh?.barcode_code
    ) {
      return null;
    }
    const codes = buildPackageBarcodeList(
      {
        ra: view.ra,
        total,
        orderBarcode: view.raBarcode,
        shipperBarcode: sh?.barcode_code ?? null,
      },
      total,
      packageFormat,
    );
    return codes.map((codigo, i) => ({
      kind: "BULTO" as const,
      barcode: codigo,
      clientDisplay: view.clientDisplay,
      title: `RA ${view.ra}`,
      ra: view.ra,
      shipperName: sh?.official_name ?? view.shipper,
      provider: view.provider || undefined,
      orderRef: view.orderRef || undefined,
      packageSeq: i + 1,
      packageTotal: total,
    }));
  };

  const printPackageLabelsForRas = (list: WarehouseRAView[]) => {
    const labels: LabelPrintData[] = [];
    for (const r of list) {
      const total = resolvePackageTotal(r);
      if (total == null) {
        if (labels.length === 0) return;
        continue;
      }
      if (
        (packageFormat === "completo" ||
          packageFormat === "expedidor_ra_bulto") &&
        !r.raBarcode
      ) {
        const sh = r.shipperId
          ? shippers.find((s) => s.id === r.shipperId)
          : matchShipperByName(
              shippers,
              r.shipper,
              r.clientCode ?? undefined,
            );
        if (!sh?.barcode_code) {
          setMessage(
            `RA ${r.ra}: este formato necesita código de pedido/expedidor. Actualizá o generá el pedido primero.`,
          );
          return;
        }
      }
      const pack = packageLabelsFromRa(r, total);
      if (pack) labels.push(...pack);
    }
    if (!labels.length) {
      setMessage(
        "No hay bultos para imprimir. Revisá cantidad de bultos y el formato elegido.",
      );
      return;
    }
    const example = labels[0]?.barcode ?? "";
    setMessage(
      `${labels.length} etiqueta(s) · formato ${packageFormat} · ej. ${example}`,
    );
    setPrintLabels(labels);
  };

  const exportPackageCsv = (list: WarehouseRAView[]) => {
    const stamp = new Date().toISOString().slice(0, 10);
    const rows: XellentCodeRow[] = [];
    for (const r of list) {
      const total = Math.max(
        0,
        Math.round(r.expectedBultos || r.currentBultos || 0),
      );
      if (!r.ra || total < 1) continue;
      const sh = r.shipperId
        ? shippers.find((s) => s.id === r.shipperId)
        : matchShipperByName(shippers, r.shipper, r.clientCode ?? undefined);
      const codes = buildPackageBarcodeList(
        {
          ra: r.ra,
          total,
          orderBarcode: r.raBarcode,
          shipperBarcode: sh?.barcode_code ?? null,
        },
        total,
        packageFormat,
      );
      codes.forEach((codigo, i) => {
        rows.push({
          tipo: "BULTO",
          codigo,
          cliente: r.clientDisplay,
          nombre: `RA ${r.ra} bulto ${i + 1}`,
          ra: r.ra,
          expedidor: r.shipper,
          proveedor: r.provider,
          referencia: r.orderRef,
          bulto: i + 1,
          total,
        });
      });
    }
    if (!rows.length) {
      setMessage("No hay códigos de bulto para exportar.");
      return;
    }
    downloadTextFile(
      buildXellentPackageCsv(rows),
      `xellent-bultos-${packageFormat}-${tab}-${stamp}.csv`,
    );
    setMessage(
      `CSV de bultos (${rows.length}, formato ${packageFormat}) listo para Xellent.`,
    );
  };

  const exportXellentCsv = (kind: "pedidos" | "expedidores") => {
    const stamp = new Date().toISOString().slice(0, 10);
    const rows: XellentCodeRow[] = [];

    if (kind === "expedidores") {
      for (const s of filteredShippers) {
        rows.push({
          tipo: "EXPEDIDOR",
          codigo: s.barcode_code,
          cliente: clientDisplayName(s.client_code, clients),
          nombre: s.official_name,
          expedidor: s.official_name,
        });
      }
      if (!rows.length) {
        setMessage("No hay códigos de expedidor para exportar.");
        return;
      }
      downloadTextFile(
        buildXellentCsv(rows),
        `xellent-expedidores-${tab}-${stamp}.csv`,
      );
      setMessage(
        `CSV de expedidores (${rows.length}) listo para Xellent X-1000VL.`,
      );
      return;
    }

    for (const r of filteredRas) {
      if (!r.raBarcode) continue;
      rows.push({
        tipo: "RA",
        codigo: r.raBarcode,
        cliente: r.clientDisplay,
        nombre: `RA ${r.ra}`,
        ra: r.ra,
        expedidor: r.shipper,
        proveedor: r.provider,
        referencia: r.orderRef,
        bultos: r.expectedBultos || r.currentBultos || "",
      });
    }
    if (!rows.length) {
      setMessage(
        "No hay códigos de pedido (RA) para exportar. Actualizá para generarlos.",
      );
      return;
    }
    downloadTextFile(
      buildXellentRaCsv(rows),
      `xellent-pedidos-ra-${tab}-${stamp}.csv`,
    );
    setMessage(
      `CSV de pedidos / RA (${rows.length}) listo para Xellent X-1000VL.`,
    );
  };

  const tabs: TabId[] = ["Todos", ...CANONICAL_WAREHOUSE_CLIENTS];

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 sm:p-4">
      {!loadImmersive ? (
        <>
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-black text-[#16263F] dark:text-slate-100 sm:text-xl">
            Control de Carga
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void refreshAll()}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-wide dark:border-slate-700 dark:bg-slate-900"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Actualizar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => exportXellentCsv("pedidos")}
            className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
            title="Solo códigos de pedido (EXP+RA)"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> CSV Pedidos / RA
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => exportXellentCsv("expedidores")}
            className="inline-flex items-center gap-1 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100"
            title="Solo códigos de expedidor (EXP-…)"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> CSV Expedidores
          </button>
        </div>
      </header>

      <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1 sm:max-w-md">
          <label className="sr-only" htmlFor="cc-package-format">
            Formato código de bulto
          </label>
          <select
            id="cc-package-format"
            value={packageFormat}
            onChange={(e) =>
              changePackageFormat(e.target.value as PackageBarcodeFormat)
            }
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#16263F] outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs"
            title="Formato del código de barras por bulto"
          >
            {PACKAGE_BARCODE_FORMAT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}: {opt.example}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 flex-1 sm:max-w-md">
          <label className="sr-only" htmlFor="cc-client-tab">
            Cliente
          </label>
          <select
            id="cc-client-tab"
            value={tab}
            onChange={(e) => setTab(e.target.value as TabId)}
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#16263F] outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs"
            title="Filtrar por cliente"
          >
            {tabs.map((t) => {
              const count =
                t === "Todos"
                  ? ras.length
                  : ras.filter((r) => r.clientCode === t).length;
              const label =
                t === "IMPOMEX"
                  ? CLIENT_DISPLAY_NAMES.IMPOMEX
                  : t === "Todos"
                    ? "TODOS"
                    : t;
              return (
                <option key={t} value={t}>
                  {label} ({count})
                </option>
              );
            })}
          </select>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["RA completas", filteredRas.length],
          [
            "Con código RA",
            filteredRas.filter((r) => r.raBarcode).length,
          ],
          ["Expedidores", filteredShippers.length],
          ["Sin mapear", orphanShipperNames.length],
        ].map(([k, v]) => (
          <div
            key={String(k)}
            className="rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900"
          >
            <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
              {k}
            </p>
            <p className="text-sm font-black text-[#16263F] dark:text-slate-100">
              {v}
            </p>
          </div>
        ))}
      </div>

      <div className="flex shrink-0 gap-1 overflow-x-auto">
        {(
          [
            ["ras", "RA completas", Package],
            ["expedidores", "Expedidores", UserRound],
            ["etiquetas", "Etiquetas / Xellent", Barcode],
            ["carga", "Carga", ArrowUpFromLine],
            ["descarga", "Descarga", ArrowDownToLine],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setMessage(null);
              setSection(id);
            }}
            className={`inline-flex items-center gap-1 rounded-xl px-3 py-2 text-[10px] font-bold uppercase ${
              section === id
                ? "bg-blue-600 text-white"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>
        </>
      ) : null}

      {message ? (
        <p className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          {message}
        </p>
      ) : null}

      <div
        className={`min-h-0 flex-1 overflow-y-auto bg-white dark:bg-slate-900 ${
          loadImmersive
            ? "rounded-none border-0 p-2 sm:p-3"
            : "rounded-2xl border border-slate-200 p-3 dark:border-slate-700 sm:p-4"
        }`}
      >
        {section === "ras" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                disabled={filteredRas.length === 0}
                onClick={() => setRaSelectionEnabled(!raSelectMode)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide disabled:opacity-50 ${
                  raSelectMode
                    ? "border border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                    : "border border-slate-200 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
                }`}
                title="Marcar varios RA para imprimir o exportar"
              >
                {raSelectMode ? (
                  <>
                    <XSquare className="h-3.5 w-3.5" /> Desactivar selección
                  </>
                ) : (
                  <>
                    <CheckSquare className="h-3.5 w-3.5" /> Selección múltiple
                  </>
                )}
              </button>
              {raSelectMode ? (
                <>
                  <button
                    type="button"
                    disabled={busy || selectedRas.length === 0}
                    onClick={() => printPackageLabelsForRas(selectedRas)}
                    className="rounded-xl bg-[#16263F] px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-white disabled:opacity-50"
                  >
                    Imprimir ({selectedRas.length || "—"})
                  </button>
                  <button
                    type="button"
                    disabled={busy || selectedRas.length === 0}
                    onClick={() => {
                      if (selectedRas.length === 0) {
                        setMessage(
                          "Seleccioná al menos un RA para el CSV de bultos.",
                        );
                        return;
                      }
                      exportPackageCsv(selectedRas);
                    }}
                    className="inline-flex items-center gap-1 rounded-xl border border-emerald-600 px-3 py-1.5 text-[10px] font-black uppercase text-emerald-700 dark:text-emerald-300 disabled:opacity-50"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" /> CSV (
                    {selectedRas.length || "—"})
                  </button>
                  <button
                    type="button"
                    disabled={filteredRas.length === 0}
                    onClick={selectAllFiltered}
                    className="rounded-xl border border-slate-300 px-3 py-1.5 text-[10px] font-bold uppercase dark:border-slate-600 disabled:opacity-50"
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    disabled={selectedRaIds.size === 0}
                    onClick={deselectAll}
                    className="rounded-xl border border-slate-300 px-3 py-1.5 text-[10px] font-bold uppercase dark:border-slate-600 disabled:opacity-50"
                  >
                    Ninguno
                  </button>
                </>
              ) : null}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:border-slate-700">
                    {raSelectMode ? (
                      <th className="w-8 py-2.5 pr-1">
                        <input
                          type="checkbox"
                          checked={allFilteredSelected}
                          ref={(el) => {
                            if (el) {
                              el.indeterminate =
                                selectedRas.length > 0 && !allFilteredSelected;
                            }
                          }}
                          onChange={toggleSelectAllFiltered}
                          title={
                            allFilteredSelected
                              ? "Deseleccionar todos"
                              : "Seleccionar todos"
                          }
                          aria-label="Seleccionar todos los RA visibles"
                        />
                      </th>
                    ) : null}
                    <th className="py-2.5 pr-3">RA</th>
                    <th className="py-2.5 pr-3">Cliente</th>
                    <th className="py-2.5 pr-3">Expedidor</th>
                    <th className="py-2.5 pr-3">Proveedor</th>
                    <th className="py-2.5 pr-3">Ref</th>
                    <th className="py-2.5 pr-3">Bultos</th>
                    <th className="py-2.5 pr-3">Código (EXP+RA)</th>
                    <th className="py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {filteredRas.map((r) => (
                    <tr
                      key={r.taskId}
                      className="border-b border-slate-100 dark:border-slate-800"
                    >
                      {raSelectMode ? (
                        <td className="py-2.5 pr-1 align-middle">
                          <input
                            type="checkbox"
                            checked={selectedRaIds.has(r.taskId)}
                            onChange={() => toggleRaSelected(r.taskId)}
                            aria-label={`Seleccionar RA ${r.ra}`}
                          />
                        </td>
                      ) : null}
                      <td className="py-2.5 pr-3 align-middle text-sm font-black tabular-nums text-[#16263F] dark:text-slate-100">
                        {r.ra}
                      </td>
                      <td className="py-2.5 pr-3 align-middle text-slate-700 dark:text-slate-300">
                        {r.clientDisplay}
                      </td>
                      <td className="max-w-[10rem] truncate py-2.5 pr-3 align-middle text-slate-700 dark:text-slate-300">
                        {r.shipper}
                      </td>
                      <td className="max-w-[11rem] truncate py-2.5 pr-3 align-middle text-slate-700 dark:text-slate-300">
                        {r.provider || "—"}
                      </td>
                      <td className="py-2.5 pr-3 align-middle text-slate-700 dark:text-slate-300">
                        {r.orderRef || "—"}
                      </td>
                      <td className="py-2.5 pr-3 align-middle font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                        {r.expectedBultos || r.currentBultos}
                      </td>
                      <td className="py-2.5 pr-3 align-middle font-mono text-[10px] text-slate-600 dark:text-slate-400">
                        {r.raBarcode || "—"}
                      </td>
                      <td className="py-2.5 align-middle whitespace-nowrap">
                        {r.raBarcode ? (
                          <span className="inline-flex items-center gap-3">
                            <button
                              type="button"
                              className="text-[10px] font-bold text-blue-600 hover:underline"
                              onClick={() => printPackageLabelsForRas([r])}
                            >
                              Etiquetas bultos
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center gap-0.5 text-[10px] font-bold text-blue-600 hover:underline"
                              onClick={() =>
                                void copyToClipboard(r.raBarcode!).then((ok) =>
                                  setMessage(
                                    ok
                                      ? `Pedido (EXP+RA): ${r.raBarcode}`
                                      : "No se pudo copiar",
                                  ),
                                )
                              }
                            >
                              <Copy className="h-3 w-3" /> Copiar pedido
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="text-[10px] font-bold text-blue-600 hover:underline"
                            onClick={() => void generateRaCode(r)}
                          >
                            Generar + etiquetas bultos
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredRas.length === 0 ? (
                <p className="py-8 text-center text-slate-400">
                  No hay RA completas para este filtro. Solo aparecen inventarios
                  con estado <strong>completed</strong> de AAA, JH o IMPOMEX DE
                  COLOMBIA LTDA.
                </p>
              ) : null}
            </div>
          </div>
        )}

        {section === "expedidores" && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs">
                <span className="font-bold uppercase text-slate-500">
                  Agregar expedidor manual
                </span>
                <input
                  value={newShipperName}
                  onChange={(e) => setNewShipperName(e.target.value)}
                  className="mt-1 block min-w-[14rem] rounded-xl border px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                  placeholder=""
                />
              </label>
              <button
                type="button"
                disabled={busy || !newShipperName.trim()}
                onClick={() => void addShipper()}
                className="rounded-xl bg-[#16263F] px-4 py-2 text-[10px] font-black uppercase text-white disabled:opacity-50"
              >
                Crear código EXP
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead>
                  <tr className="border-b text-[10px] uppercase text-slate-400">
                    <th className="py-2">Código</th>
                    <th>Nombre</th>
                    <th>Cliente</th>
                    <th>Aliases (unificados)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredShippers.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b border-slate-100 dark:border-slate-800"
                    >
                      <td className="py-2 font-mono font-bold">
                        {s.barcode_code}
                      </td>
                      <td className="font-semibold">{s.official_name}</td>
                      <td>{clientDisplayName(s.client_code, clients)}</td>
                      <td className="max-w-[18rem] text-[10px] text-slate-500">
                        {(() => {
                          const extras = shipperAliasesList(s.aliases).filter(
                            (a) =>
                              normalizeWarehouseClientText(a) !==
                              normalizeWarehouseClientText(s.official_name),
                          );
                          if (!extras.length) return "—";
                          return (
                            <div className="flex flex-wrap gap-1">
                              {extras.map((a) => (
                                <span
                                  key={a}
                                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 dark:border-slate-600 dark:bg-slate-800"
                                >
                                  <span className="max-w-[8rem] truncate">
                                    {a}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    title="Desvincular"
                                    className="font-black text-rose-600 disabled:opacity-50"
                                    onClick={() =>
                                      void doUnlinkAlias(s.id, a)
                                    }
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="whitespace-nowrap space-x-2">
                        <button
                          type="button"
                          className="text-[10px] font-bold text-blue-600"
                          onClick={() =>
                            setPrintLabels([
                              {
                                kind: "EXPEDIDOR",
                                barcode: s.barcode_code,
                                clientDisplay: clientDisplayName(
                                  s.client_code,
                                  clients,
                                ),
                                title: s.official_name,
                                shipperName: s.official_name,
                                extraLines: shipperAliasesList(s.aliases)
                                  .filter(
                                    (a) =>
                                      normalizeWarehouseClientText(a) !==
                                      normalizeWarehouseClientText(
                                        s.official_name,
                                      ),
                                  ).length
                                  ? [
                                      `También: ${shipperAliasesList(s.aliases)
                                        .filter(
                                          (a) =>
                                            normalizeWarehouseClientText(a) !==
                                            normalizeWarehouseClientText(
                                              s.official_name,
                                            ),
                                        )
                                        .join(", ")}`,
                                    ]
                                  : undefined,
                              },
                            ])
                          }
                        >
                          Etiqueta
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-600"
                          onClick={() =>
                            void copyToClipboard(s.barcode_code).then((ok) =>
                              setMessage(
                                ok
                                  ? `Copiado: ${s.barcode_code}`
                                  : "No se pudo copiar",
                              ),
                            )
                          }
                        >
                          <Copy className="h-3 w-3" /> Copiar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredShippers.length === 0 ? (
                <p className="py-6 text-center text-slate-400">
                  Sin expedidores aún. Actualizá para crearlos desde las RA, o
                  agregá uno manual.
                </p>
              ) : null}
            </div>

            <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-black text-[#16263F] dark:text-slate-100">
                <Merge className="h-4 w-4" /> Unificar / agrupar expedidores
              </h2>
              <p className="mb-3 text-[11px] text-slate-500">
                Si varios nombres son la misma persona, unificalos bajo un solo
                código EXP. Los demás quedan como aliases. Si te equivocás, en
                la tabla tocá <strong>×</strong> en el alias para desvincularlo
                (recupera su propio código).
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-xs">
                  <span className="font-bold uppercase text-slate-500">
                    Conservar este código
                  </span>
                  <select
                    value={unifyTargetId}
                    onChange={(e) => setUnifyTargetId(e.target.value)}
                    className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="">Seleccioná…</option>
                    {filteredShippers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.official_name} ({s.barcode_code})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs">
                  <span className="font-bold uppercase text-slate-500">
                    Nombres extra a unificar (coma)
                  </span>
                  <input
                    value={unifyExtraNames}
                    onChange={(e) => setUnifyExtraNames(e.target.value)}
                    placeholder=""
                    className="mt-1 w-full rounded-xl border px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
              </div>
              <div className="mt-3">
                <p className="mb-1 text-[10px] font-bold uppercase text-slate-500">
                  Fusionar expedidores existentes (se desactivan)
                </p>
                <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                  {filteredShippers
                    .filter((s) => s.id !== unifyTargetId)
                    .map((s) => {
                      const on = unifyMergeIds.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() =>
                            setUnifyMergeIds((prev) =>
                              on
                                ? prev.filter((id) => id !== s.id)
                                : [...prev, s.id],
                            )
                          }
                          className={`rounded-full px-3 py-1 text-[10px] font-bold ${
                            on
                              ? "bg-blue-600 text-white"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-800"
                          }`}
                        >
                          {s.official_name}
                        </button>
                      );
                    })}
                </div>
              </div>
              <button
                type="button"
                disabled={busy || !unifyTargetId}
                onClick={() => void doUnify()}
                className="mt-4 rounded-xl border border-slate-300 px-4 py-2 text-[10px] font-black uppercase dark:border-slate-600 disabled:opacity-50"
              >
                Unificar bajo un código
              </button>
            </div>
          </div>
        )}

        {section === "etiquetas" && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={selectedRas.length === 0}
                onClick={() => printPackageLabelsForRas(selectedRas)}
                className="rounded-xl bg-[#16263F] px-4 py-2 text-[10px] font-black uppercase text-white disabled:opacity-50"
              >
                Imprimir bultos ({selectedRas.length || "—"})
              </button>
              <button
                type="button"
                disabled={selectedRas.length === 0}
                onClick={() => {
                  if (selectedRas.length === 0) {
                    setMessage(
                      "En «RA completas» habilitá la selección, marcá los RA y volvé a exportar.",
                    );
                    return;
                  }
                  exportPackageCsv(selectedRas);
                }}
                className="rounded-xl border border-emerald-600 px-4 py-2 text-[10px] font-black uppercase text-emerald-700 dark:text-emerald-300 disabled:opacity-50"
              >
                CSV bultos ({selectedRas.length || "—"})
              </button>
              <button
                type="button"
                onClick={() => exportXellentCsv("pedidos")}
                className="rounded-xl bg-emerald-700 px-4 py-2 text-[10px] font-black uppercase text-white"
              >
                CSV Pedidos / RA
              </button>
              <button
                type="button"
                onClick={() => exportXellentCsv("expedidores")}
                className="rounded-xl bg-sky-700 px-4 py-2 text-[10px] font-black uppercase text-white"
              >
                CSV Expedidores
              </button>
              <button
                type="button"
                onClick={() => {
                  const labels: LabelPrintData[] = filteredShippers.map((s) => ({
                    kind: "EXPEDIDOR" as const,
                    barcode: s.barcode_code,
                    clientDisplay: clientDisplayName(s.client_code, clients),
                    title: s.official_name,
                    shipperName: s.official_name,
                  }));
                  if (!labels.length) {
                    setMessage("No hay códigos de expedidor para imprimir.");
                    return;
                  }
                  setPrintLabels(labels);
                }}
                className="rounded-xl border border-slate-300 px-4 py-2 text-[10px] font-black uppercase dark:border-slate-600"
              >
                Imprimir expedidores
              </button>
            </div>
          </div>
        )}

        {section === "carga" && (
          <LoadScanPanel
            kind="carga"
            availableRas={filteredRas}
            userLabel={userDisplayName}
            onMessage={setMessage}
            onImmersiveChange={onLoadImmersiveChange}
          />
        )}

        {section === "descarga" && (
          <LoadScanPanel
            kind="descarga"
            availableRas={filteredRas}
            userLabel={userDisplayName}
            onMessage={setMessage}
            onImmersiveChange={onLoadImmersiveChange}
          />
        )}
      </div>

      {printLabels ? (
        <LabelPrinter
          labels={printLabels}
          onClose={() => setPrintLabels(null)}
        />
      ) : null}
    </div>
  );
}
