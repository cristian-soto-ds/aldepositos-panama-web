/**
 * Acceso Supabase — Control de Carga (códigos expedidor + RA).
 */

import { supabase } from "@/lib/supabase";
import {
  defaultWarehouseClientSeeds,
  normalizeWarehouseClientText,
  shipperAliasesList,
} from "@/lib/warehouse/client-resolver";
import {
  buildOrderBarcode,
  normalizeRaForPackageBarcode,
  parsePackageBarcode,
} from "@/lib/warehouse/task-adapter";
import type {
  LoadSessionKind,
  LoadSessionRaProgress,
  PackageScanResult,
  WarehouseClientRow,
  WarehouseLoadSession,
  WarehouseLoadSessionRa,
  WarehousePackageScan,
  WarehouseRaCode,
  WarehouseRAView,
  WarehouseShipper,
} from "@/lib/warehouse/types";
import { PENDING_SHIPPER_LABEL } from "@/lib/warehouse/types";

function errMessage(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [o.message, o.details, o.hint, o.code]
      .map((x) => String(x ?? "").trim())
      .filter(Boolean);
    if (parts.length) return parts.join(" — ");
  }
  return fallback;
}

export async function fetchWarehouseClients(): Promise<WarehouseClientRow[]> {
  const { data, error } = await supabase
    .from("warehouse_clients")
    .select("code, display_name, aliases, active")
    .eq("active", true)
    .order("code");
  if (error || !data?.length) {
    console.warn("[warehouse] clients fallback seeds:", error?.message);
    return defaultWarehouseClientSeeds();
  }
  return data as WarehouseClientRow[];
}

export async function fetchWarehouseShippers(
  clientCode?: string,
): Promise<WarehouseShipper[]> {
  let q = supabase
    .from("warehouse_shippers")
    .select("*")
    .eq("active", true)
    .order("official_name");
  if (clientCode) q = q.eq("client_code", clientCode);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as WarehouseShipper[];
}

export async function fetchWarehouseRaCodes(opts?: {
  clientCode?: string;
}): Promise<WarehouseRaCode[]> {
  let q = supabase
    .from("warehouse_ra_codes")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false });
  if (opts?.clientCode) q = q.eq("client_code", opts.clientCode);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as WarehouseRaCode[];
}

export async function createShipper(input: {
  client_code: string;
  official_name: string;
  aliases?: string[];
}): Promise<WarehouseShipper> {
  const official_name = input.official_name.trim();
  if (!official_name) throw new Error("Nombre de expedidor requerido");
  const normalized_name = normalizeWarehouseClientText(official_name);

  // Un solo código por nombre (mismo cliente): no crear duplicados.
  const { data: existing } = await supabase
    .from("warehouse_shippers")
    .select("*")
    .eq("client_code", input.client_code)
    .eq("normalized_name", normalized_name)
    .eq("active", true)
    .maybeSingle();
  if (existing) return existing as WarehouseShipper;

  const { data: code, error: codeErr } = await supabase.rpc(
    "next_shipper_barcode",
    { p_client_code: input.client_code },
  );
  if (codeErr) throw codeErr;
  const aliases = Array.from(
    new Set(
      (input.aliases ?? [])
        .map((a) => a.trim())
        .filter(Boolean)
        .concat(official_name),
    ),
  );
  const { data, error } = await supabase
    .from("warehouse_shippers")
    .insert({
      client_code: input.client_code,
      barcode_code: String(code),
      official_name,
      normalized_name,
      supplier: null,
      group_id: null,
      aliases,
      active: true,
    })
    .select("*")
    .single();
  if (error) {
    // Carrera: otro insert ganó — devolver el existente.
    const { data: raced } = await supabase
      .from("warehouse_shippers")
      .select("*")
      .eq("client_code", input.client_code)
      .eq("normalized_name", normalized_name)
      .eq("active", true)
      .maybeSingle();
    if (raced) return raced as WarehouseShipper;
    throw error;
  }
  return data as WarehouseShipper;
}

/**
 * Devuelve el expedidor existente o lo crea con código EXP-… (Code 128).
 * Idempotente: mismo nombre (oficial/alias) + cliente → un solo código.
 */
export async function ensureShipperByName(input: {
  client_code: string;
  official_name: string;
  shippers?: WarehouseShipper[];
}): Promise<{ shipper: WarehouseShipper; created: boolean }> {
  const name = input.official_name.trim();
  if (!name) throw new Error("Nombre de expedidor requerido");
  const list =
    input.shippers ?? (await fetchWarehouseShippers(input.client_code));
  const existing = matchShipperByName(list, name, input.client_code);
  if (existing) return { shipper: existing, created: false };

  const normalized = normalizeWarehouseClientText(name);
  const { data: fromDb } = await supabase
    .from("warehouse_shippers")
    .select("*")
    .eq("client_code", input.client_code)
    .eq("normalized_name", normalized)
    .eq("active", true)
    .maybeSingle();
  if (fromDb) return { shipper: fromDb as WarehouseShipper, created: false };

  const before = await fetchWarehouseShippers(input.client_code);
  const shipper = await createShipper({
    client_code: input.client_code,
    official_name: name,
  });
  const wasCreated = !before.some((s) => s.id === shipper.id);
  return { shipper, created: wasCreated };
}

export type SyncShippersFromRasResult = {
  shippers: WarehouseShipper[];
  created: WarehouseShipper[];
  createdCount: number;
  mergedDuplicates: number;
};

/**
 * Fusiona duplicados activos con el mismo nombre normalizado + cliente.
 * Conserva el código más antiguo (EXP-… menor) y desactiva el resto.
 */
export async function dedupeShippersByNormalizedName(
  existingShippers?: WarehouseShipper[],
): Promise<{ shippers: WarehouseShipper[]; mergedCount: number }> {
  const list = existingShippers
    ? [...existingShippers]
    : await fetchWarehouseShippers();
  const groups = new Map<string, WarehouseShipper[]>();
  for (const s of list) {
    const norm =
      String(s.normalized_name ?? "").trim() ||
      normalizeWarehouseClientText(s.official_name);
    if (!norm) continue;
    const key = `${s.client_code}::${norm}`;
    const arr = groups.get(key) ?? [];
    arr.push(s);
    groups.set(key, arr);
  }

  let mergedCount = 0;
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    group.sort((a, b) =>
      String(a.barcode_code).localeCompare(String(b.barcode_code)),
    );
    const target = group[0]!;
    const mergeIds = group.slice(1).map((s) => s.id);
    await unifyShippers({
      targetShipperId: target.id,
      mergeShipperIds: mergeIds,
      extraAliasNames: group.map((s) => s.official_name),
    });
    mergedCount += mergeIds.length;
  }

  return {
    shippers: await fetchWarehouseShippers(),
    mergedCount,
  };
}

/**
 * Crea automáticamente un expedidor (con barcode) por cada nombre distinto
 * que aparece en las RA. Mismo nombre → un solo código.
 */
export async function syncShippersFromRaNames(
  entries: Array<{ clientCode: string; shipperName: string }>,
  existingShippers?: WarehouseShipper[],
): Promise<SyncShippersFromRasResult> {
  // Primero limpia duplicados ya creados (mismo nombre varias veces).
  const deduped = await dedupeShippersByNormalizedName(existingShippers);
  let shippers = deduped.shippers;
  const created: WarehouseShipper[] = [];
  const seen = new Set<string>();

  for (const e of entries) {
    const client = String(e.clientCode ?? "").trim();
    const name = String(e.shipperName ?? "").trim();
    if (!client || !name) continue;
    if (
      normalizeWarehouseClientText(name) ===
      normalizeWarehouseClientText(PENDING_SHIPPER_LABEL)
    ) {
      continue;
    }
    const key = `${client}::${normalizeWarehouseClientText(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { shipper, created: wasCreated } = await ensureShipperByName({
      client_code: client,
      official_name: name,
      shippers,
    });
    if (wasCreated) {
      created.push(shipper);
      shippers = [...shippers, shipper];
    } else if (!shippers.some((s) => s.id === shipper.id)) {
      shippers = [...shippers, shipper];
    }
  }

  // Segunda pasada por si hubo carrera al crear.
  const finalDeduped = await dedupeShippersByNormalizedName(shippers);

  return {
    shippers: finalDeduped.shippers,
    created,
    createdCount: created.length,
    mergedDuplicates: deduped.mergedCount + finalDeduped.mergedCount,
  };
}

/**
 * Unifica varios nombres (y/o shippers) bajo un expedidor canónico.
 * Los shippers fusionados se desactivan; sus nombres pasan a aliases.
 */
export async function unifyShippers(input: {
  targetShipperId: string;
  mergeShipperIds?: string[];
  extraAliasNames?: string[];
}): Promise<WarehouseShipper> {
  const { data: target, error: tErr } = await supabase
    .from("warehouse_shippers")
    .select("*")
    .eq("id", input.targetShipperId)
    .single();
  if (tErr || !target) throw tErr ?? new Error("Expedidor destino no encontrado");

  const mergeIds = (input.mergeShipperIds ?? []).filter(
    (id) => id && id !== input.targetShipperId,
  );
  let aliases = shipperAliasesList(target.aliases);
  aliases.push(String(target.official_name));

  if (mergeIds.length) {
    const { data: others, error } = await supabase
      .from("warehouse_shippers")
      .select("*")
      .in("id", mergeIds);
    if (error) throw error;
    for (const o of others ?? []) {
      aliases.push(String(o.official_name));
      aliases.push(...shipperAliasesList(o.aliases));
    }
    const { error: deactErr } = await supabase
      .from("warehouse_shippers")
      .update({ active: false, updated_at: new Date().toISOString() })
      .in("id", mergeIds);
    if (deactErr) throw deactErr;

    // Reasignar códigos RA al expedidor canónico
    const { error: reErr } = await supabase
      .from("warehouse_ra_codes")
      .update({
        shipper_id: input.targetShipperId,
        updated_at: new Date().toISOString(),
      })
      .in("shipper_id", mergeIds);
    if (reErr) throw reErr;
  }

  for (const n of input.extraAliasNames ?? []) {
    if (n.trim()) aliases.push(n.trim());
  }
  aliases = Array.from(
    new Set(aliases.map((a) => a.trim()).filter(Boolean)),
  );

  const { data, error: upErr } = await supabase
    .from("warehouse_shippers")
    .update({
      aliases,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.targetShipperId)
    .select("*")
    .single();
  if (upErr) throw upErr;
  return data as WarehouseShipper;
}

/**
 * Desvincula un alias de un expedidor.
 * Si había un expedidor desactivado con ese nombre, lo reactiva con su código EXP.
 * Si no, crea uno nuevo con código propio.
 */
export async function unlinkShipperAlias(input: {
  shipperId: string;
  aliasName: string;
}): Promise<{
  parent: WarehouseShipper;
  restored: WarehouseShipper | null;
}> {
  const aliasName = input.aliasName.trim();
  if (!aliasName) throw new Error("Indicá el alias a desvincular");

  const { data: parent, error: pErr } = await supabase
    .from("warehouse_shippers")
    .select("*")
    .eq("id", input.shipperId)
    .single();
  if (pErr || !parent) throw pErr ?? new Error("Expedidor no encontrado");

  const aliasKey = normalizeWarehouseClientText(aliasName);
  const officialKey = normalizeWarehouseClientText(parent.official_name);
  if (aliasKey === officialKey) {
    throw new Error("No podés desvincular el nombre oficial del expedidor");
  }

  const prevAliases = shipperAliasesList(parent.aliases);
  const nextAliases = prevAliases.filter(
    (a) => normalizeWarehouseClientText(a) !== aliasKey,
  );
  if (nextAliases.length === prevAliases.length) {
    throw new Error("Ese nombre no está en los aliases de este expedidor");
  }

  const { data: updatedParent, error: upErr } = await supabase
    .from("warehouse_shippers")
    .update({
      aliases: nextAliases.length ? nextAliases : [parent.official_name],
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.shipperId)
    .select("*")
    .single();
  if (upErr) throw upErr;

  // Si ya existe uno activo con ese nombre, solo quitar el alias.
  const activeList = await fetchWarehouseShippers(String(parent.client_code));
  const alreadyActive = matchShipperByName(
    activeList,
    aliasName,
    String(parent.client_code),
  );
  if (alreadyActive && alreadyActive.id !== input.shipperId) {
    return {
      parent: updatedParent as WarehouseShipper,
      restored: alreadyActive,
    };
  }

  // Reactivar expedidor desactivado con ese nombre (mismo cliente).
  const { data: inactive } = await supabase
    .from("warehouse_shippers")
    .select("*")
    .eq("client_code", parent.client_code)
    .eq("active", false)
    .eq("normalized_name", aliasKey)
    .order("barcode_code", { ascending: true })
    .limit(1)
    .maybeSingle();

  let restored: WarehouseShipper | null = null;
  if (inactive) {
    const { data: reactivated, error: rErr } = await supabase
      .from("warehouse_shippers")
      .update({
        active: true,
        official_name: aliasName,
        normalized_name: aliasKey,
        aliases: [aliasName],
        updated_at: new Date().toISOString(),
      })
      .eq("id", (inactive as WarehouseShipper).id)
      .select("*")
      .single();
    if (rErr) throw rErr;
    restored = reactivated as WarehouseShipper;
  } else {
    // No había fila desactivada: crear expedidor propio.
    restored = await createShipper({
      client_code: String(parent.client_code),
      official_name: aliasName,
    });
  }

  return {
    parent: updatedParent as WarehouseShipper,
    restored,
  };
}

/** Genera (o reutiliza) código de pedido = código expedidor + RA. */
export async function ensureRaBarcode(input: {
  task_id: string;
  ra: string;
  client_code: string;
  shipper_id?: string | null;
  shipper_barcode: string;
  provider?: string | null;
  order_ref?: string | null;
  shipper_label?: string | null;
}): Promise<WarehouseRaCode> {
  const desired = buildOrderBarcode(input.shipper_barcode, input.ra);

  const { data: existing, error: exErr } = await supabase
    .from("warehouse_ra_codes")
    .select("*")
    .eq("task_id", input.task_id)
    .maybeSingle();
  if (exErr) throw new Error(errMessage(exErr, "Error leyendo códigos de pedido"));
  if (existing) {
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      barcode_code: desired,
    };
    if (input.shipper_id !== undefined) patch.shipper_id = input.shipper_id;
    if (input.shipper_label !== undefined)
      patch.shipper_label = input.shipper_label;
    if (input.provider !== undefined) patch.provider = input.provider;
    if (input.order_ref !== undefined) patch.order_ref = input.order_ref;
    const { data: updated, error: upErr } = await supabase
      .from("warehouse_ra_codes")
      .update(patch)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (upErr) {
      // Colisión de código: sufijo corto del task
      if (String(upErr.message ?? "").toLowerCase().includes("unique")) {
        const fallback = `${desired}-${input.task_id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
        const { data: retry, error: retryErr } = await supabase
          .from("warehouse_ra_codes")
          .update({ ...patch, barcode_code: fallback })
          .eq("id", existing.id)
          .select("*")
          .single();
        if (retryErr) {
          throw new Error(errMessage(retryErr, "No se pudo actualizar el código"));
        }
        return retry as WarehouseRaCode;
      }
      throw new Error(errMessage(upErr, "No se pudo actualizar el código"));
    }
    return updated as WarehouseRaCode;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const insertRow = async (barcode_code: string) => {
    const { data, error } = await supabase
      .from("warehouse_ra_codes")
      .insert({
        task_id: input.task_id,
        ra: input.ra,
        client_code: input.client_code,
        shipper_id: input.shipper_id ?? null,
        barcode_code,
        provider: input.provider ?? null,
        order_ref: input.order_ref ?? null,
        shipper_label: input.shipper_label ?? null,
        active: true,
        created_by: user?.id ?? null,
      })
      .select("*")
      .single();
    return { data, error };
  };

  let { data, error } = await insertRow(desired);
  if (error && String(error.message ?? "").toLowerCase().includes("unique")) {
    const fallback = `${desired}-${input.task_id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    ({ data, error } = await insertRow(fallback));
  }
  if (error) throw new Error(errMessage(error, "No se pudo guardar el código de pedido"));
  return data as WarehouseRaCode;
}

/**
 * Genera automáticamente códigos de pedido (EXP + RA) para todas las RA
 * que aún no tienen código y tienen expedidor.
 */
export async function syncOrderBarcodesFromRas(
  raViews: WarehouseRAView[],
  shippers: WarehouseShipper[],
): Promise<{
  codes: WarehouseRaCode[];
  createdCount: number;
  skippedPending: number;
  errors: string[];
}> {
  let list = [...shippers];
  const existing = await fetchWarehouseRaCodes();
  const byTask = new Map(existing.map((c) => [c.task_id, c]));
  let createdCount = 0;
  let skippedPending = 0;
  const errors: string[] = [];

  for (const view of raViews) {
    if (!view.clientCode) continue;
    if (byTask.has(view.taskId)) continue;
    if (!view.shipper || view.shipper === PENDING_SHIPPER_LABEL) {
      skippedPending += 1;
      continue;
    }
    try {
      let matched = matchShipperByName(list, view.shipper, view.clientCode);
      if (!matched) {
        const ensured = await ensureShipperByName({
          client_code: view.clientCode,
          official_name: view.shipper,
          shippers: list,
        });
        matched = ensured.shipper;
        if (ensured.created) list = [...list, matched];
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
      byTask.set(view.taskId, row);
      createdCount += 1;
    } catch (e) {
      errors.push(`${view.ra}: ${errMessage(e, "error")}`);
    }
  }

  return {
    codes: Array.from(byTask.values()),
    createdCount,
    skippedPending,
    errors,
  };
}

export async function appendClientAlias(
  code: string,
  alias: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("warehouse_clients")
    .select("aliases")
    .eq("code", code)
    .maybeSingle();
  if (error) throw error;
  const prev = Array.isArray(data?.aliases) ? (data!.aliases as string[]) : [];
  const next = Array.from(new Set([...prev, alias]));
  const { error: upErr } = await supabase
    .from("warehouse_clients")
    .update({ aliases: next, updated_at: new Date().toISOString() })
    .eq("code", code);
  if (upErr) throw upErr;
}

/** Empareja nombre de expedidor (subClient) con un shipper por nombre oficial o alias. */
export function matchShipperByName(
  shippers: WarehouseShipper[],
  name: string,
  clientCode?: string,
): WarehouseShipper | null {
  const key = normalizeWarehouseClientText(name);
  if (!key) return null;
  const list = clientCode
    ? shippers.filter((s) => s.client_code === clientCode)
    : shippers;
  for (const s of list) {
    if (normalizeWarehouseClientText(s.official_name) === key) return s;
    for (const a of shipperAliasesList(s.aliases)) {
      if (normalizeWarehouseClientText(a) === key) return s;
    }
  }
  return null;
}

// ─── Sesiones Carga / Descarga (pistoleo por bulto) ─────────────────────────

export async function listLoadSessions(opts: {
  kind: LoadSessionKind;
  status?: "abierta" | "cerrada" | "all";
}): Promise<WarehouseLoadSession[]> {
  let q = supabase
    .from("warehouse_load_sessions")
    .select("*")
    .eq("kind", opts.kind)
    .order("created_at", { ascending: false })
    .limit(80);
  if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw new Error(errMessage(error, "No se pudieron listar sesiones"));
  return (data ?? []) as WarehouseLoadSession[];
}

export async function createLoadSession(input: {
  kind: LoadSessionKind;
  container_number: string;
  notes?: string;
  created_by?: string | null;
}): Promise<WarehouseLoadSession> {
  const container_number = String(input.container_number ?? "").trim();
  if (!container_number) throw new Error("Indicá el número de contenedor");
  const { data, error } = await supabase
    .from("warehouse_load_sessions")
    .insert({
      kind: input.kind,
      container_number,
      notes: String(input.notes ?? "").trim(),
      status: "abierta",
      created_by: input.created_by?.trim() || null,
    })
    .select("*")
    .single();
  if (error) throw new Error(errMessage(error, "No se pudo crear la sesión"));
  return data as WarehouseLoadSession;
}

export async function fetchSessionRas(
  sessionId: string,
): Promise<WarehouseLoadSessionRa[]> {
  const { data, error } = await supabase
    .from("warehouse_load_session_ras")
    .select("*")
    .eq("session_id", sessionId)
    .order("ra");
  if (error) throw new Error(errMessage(error, "No se pudieron cargar los RA"));
  return (data ?? []) as WarehouseLoadSessionRa[];
}

export async function fetchSessionScans(
  sessionId: string,
): Promise<WarehousePackageScan[]> {
  const { data, error } = await supabase
    .from("warehouse_package_scans")
    .select("*")
    .eq("session_id", sessionId)
    .order("scanned_at", { ascending: true });
  if (error) throw new Error(errMessage(error, "No se pudieron cargar los scans"));
  return (data ?? []) as WarehousePackageScan[];
}

export async function addRasToSession(
  sessionId: string,
  ras: WarehouseRAView[],
): Promise<number> {
  if (!ras.length) return 0;
  const rows = ras.map((r) => ({
    session_id: sessionId,
    task_id: r.taskId,
    ra: normalizeRaForPackageBarcode(r.ra),
    order_barcode: r.raBarcode ?? null,
    expected_bultos: Math.max(
      0,
      Math.round(r.expectedBultos || r.currentBultos || 0),
    ),
    client_display: r.clientDisplay || null,
    shipper_label: r.shipper || null,
    provider: r.provider || null,
    order_ref: r.orderRef || null,
  }));
  const { error } = await supabase
    .from("warehouse_load_session_ras")
    .upsert(rows, { onConflict: "session_id,ra", ignoreDuplicates: false });
  if (error) throw new Error(errMessage(error, "No se pudieron agregar los RA"));
  return rows.length;
}

export async function removeRaFromSession(
  sessionId: string,
  ra: string,
): Promise<void> {
  const raKey = normalizeRaForPackageBarcode(ra);
  const { count, error: cErr } = await supabase
    .from("warehouse_package_scans")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("ra", raKey);
  if (cErr) throw new Error(errMessage(cErr, "No se pudo verificar scans"));
  if ((count ?? 0) > 0) {
    throw new Error(
      "Este RA ya tiene lecturas. Los scans no se borran; cerrá la sesión o pedí acceso completo.",
    );
  }
  const { error: e2 } = await supabase
    .from("warehouse_load_session_ras")
    .delete()
    .eq("session_id", sessionId)
    .eq("ra", raKey);
  if (e2) throw new Error(errMessage(e2, "No se pudo quitar el RA"));
}

export function buildSessionProgress(
  ras: WarehouseLoadSessionRa[],
  scans: WarehousePackageScan[],
): LoadSessionRaProgress[] {
  const byRa = new Map<string, number[]>();
  for (const s of scans) {
    const list = byRa.get(s.ra) ?? [];
    list.push(s.package_seq);
    byRa.set(s.ra, list);
  }
  return ras.map((r) => {
    const scanned = new Set(byRa.get(r.ra) ?? []);
    const expected = Math.max(0, r.expected_bultos);
    const missingSeqs: number[] = [];
    for (let i = 1; i <= expected; i += 1) {
      if (!scanned.has(i)) missingSeqs.push(i);
    }
    return {
      ra: r.ra,
      taskId: r.task_id,
      orderBarcode: r.order_barcode,
      expectedBultos: expected,
      scannedBultos: scanned.size,
      missingSeqs,
      clientDisplay: r.client_display,
      shipperLabel: r.shipper_label,
      provider: r.provider,
      orderRef: r.order_ref,
    };
  });
}

export async function listSessionProgress(
  sessionId: string,
): Promise<LoadSessionRaProgress[]> {
  const [ras, scans] = await Promise.all([
    fetchSessionRas(sessionId),
    fetchSessionScans(sessionId),
  ]);
  return buildSessionProgress(ras, scans);
}

export async function recordPackageScan(input: {
  sessionId: string;
  barcode: string;
  userLabel?: string | null;
}): Promise<PackageScanResult> {
  const { data: session, error: sErr } = await supabase
    .from("warehouse_load_sessions")
    .select("id, status")
    .eq("id", input.sessionId)
    .maybeSingle();
  if (sErr) throw new Error(errMessage(sErr, "No se pudo leer la sesión"));
  if (!session) {
    return { code: "invalid", message: "Sesión no encontrada." };
  }
  if (session.status !== "abierta") {
    return { code: "session_closed", message: "La sesión ya está cerrada." };
  }

  const parsed = parsePackageBarcode(input.barcode);
  if (!parsed) {
    return {
      code: "invalid",
      message:
        "Código inválido. Usá etiqueta de bulto (64368-001, EXP-…-64368-001 o EXP-…-64368-001/018).",
    };
  }

  const { data: raRow, error: rErr } = await supabase
    .from("warehouse_load_session_ras")
    .select("*")
    .eq("session_id", input.sessionId)
    .eq("ra", parsed.ra)
    .maybeSingle();
  if (rErr) throw new Error(errMessage(rErr, "No se pudo validar el RA"));
  if (!raRow) {
    return {
      code: "ra_not_in_session",
      message: `El RA ${parsed.ra} no está montado en esta sesión.`,
      ra: parsed.ra,
      seq: parsed.seq,
    };
  }

  const expected = Math.max(0, Number(raRow.expected_bultos) || 0);
  if (expected > 0 && parsed.seq > expected) {
    return {
      code: "seq_out_of_range",
      message: `Bulto ${parsed.seq} fuera de rango (esperados ${expected}).`,
      ra: parsed.ra,
      seq: parsed.seq,
    };
  }

  const barcode = parsed.barcode;
  const { error: insErr } = await supabase.from("warehouse_package_scans").insert({
    session_id: input.sessionId,
    ra: parsed.ra,
    package_seq: parsed.seq,
    package_barcode: barcode,
    scanned_by_label: input.userLabel?.trim() || null,
  });

  if (insErr) {
    const msg = String(insErr.message ?? "");
    const code = String((insErr as { code?: string }).code ?? "");
    if (code === "23505" || /duplicate|unique/i.test(msg)) {
      return {
        code: "duplicate",
        message: `ALARMA: este código de barra ya fue contado y no se contará nuevamente (${barcode}).`,
        ra: parsed.ra,
        seq: parsed.seq,
        barcode,
      };
    }
    throw new Error(errMessage(insErr, "No se pudo registrar el scan"));
  }

  return {
    code: "ok",
    message: `OK ${barcode}`,
    ra: parsed.ra,
    seq: parsed.seq,
    barcode,
  };
}

export async function closeLoadSession(
  sessionId: string,
  opts?: { signalReadyForDescarga?: boolean },
): Promise<void> {
  const patch: Record<string, unknown> = {
    status: "cerrada",
    closed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (opts?.signalReadyForDescarga) {
    patch.ready_for_descarga = true;
  }
  const { error } = await supabase
    .from("warehouse_load_sessions")
    .update(patch)
    .eq("id", sessionId);
  if (error) throw new Error(errMessage(error, "No se pudo cerrar la sesión"));
}

/** Cierra carga y la marca lista para que aparezca en Descarga. */
export async function closeCargaAndSignalDescarga(
  sessionId: string,
): Promise<void> {
  const session = await fetchLoadSession(sessionId);
  if (!session) throw new Error("Sesión no encontrada");
  if (session.kind !== "carga") {
    throw new Error("Solo una sesión de carga puede enviarse a descarga");
  }
  await closeLoadSession(sessionId, { signalReadyForDescarga: true });
}

/**
 * Contenedores de carga ya cerrados y señalados, aún sin descarga abierta
 * (o con descarga ya creada — se incluye el vínculo si existe).
 */
export async function listCargaReadyForDescarga(): Promise<
  Array<
    WarehouseLoadSession & {
      raCount: number;
      descargaSessionId: string | null;
    }
  >
> {
  const { data, error } = await supabase
    .from("warehouse_load_sessions")
    .select("*")
    .eq("kind", "carga")
    .eq("ready_for_descarga", true)
    .order("closed_at", { ascending: false })
    .limit(60);
  if (error) {
    throw new Error(
      errMessage(
        error,
        "No se pudieron listar contenedores listos (¿aplicaste migraciones 019/020?)",
      ),
    );
  }
  const cargas = (data ?? []) as WarehouseLoadSession[];
  if (!cargas.length) return [];

  const ids = cargas.map((c) => c.id);
  const { data: descargas } = await supabase
    .from("warehouse_load_sessions")
    .select("id, source_carga_session_id, status")
    .eq("kind", "descarga")
    .in("source_carga_session_id", ids);

  const descargaByCarga = new Map<string, string>();
  for (const d of descargas ?? []) {
    const src = String(
      (d as { source_carga_session_id?: string }).source_carga_session_id ?? "",
    );
    if (src) descargaByCarga.set(src, String((d as { id: string }).id));
  }

  const { data: raRows } = await supabase
    .from("warehouse_load_session_ras")
    .select("session_id")
    .in("session_id", ids);
  const countBySession = new Map<string, number>();
  for (const row of raRows ?? []) {
    const sid = String((row as { session_id: string }).session_id);
    countBySession.set(sid, (countBySession.get(sid) ?? 0) + 1);
  }

  return cargas.map((c) => ({
    ...c,
    raCount: countBySession.get(c.id) ?? 0,
    descargaSessionId: descargaByCarga.get(c.id) ?? null,
  }));
}

/**
 * Abre (o reutiliza) una sesión de descarga a partir de una carga lista:
 * mismo contenedor + mismos RA montados. Los scans de descarga empiezan en cero.
 */
export async function openDescargaFromCarga(input: {
  cargaSessionId: string;
  created_by?: string | null;
}): Promise<WarehouseLoadSession> {
  const carga = await fetchLoadSession(input.cargaSessionId);
  if (!carga) throw new Error("Sesión de carga no encontrada");
  if (carga.kind !== "carga") throw new Error("La sesión origen no es de carga");
  if (!carga.ready_for_descarga) {
    throw new Error(
      "Esa carga aún no fue señalada como lista. En Carga usá «Cerrar y enviar a descarga».",
    );
  }

  // Reutilizar descarga abierta ya vinculada.
  const { data: existing } = await supabase
    .from("warehouse_load_sessions")
    .select("*")
    .eq("kind", "descarga")
    .eq("source_carga_session_id", carga.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    const ex = existing as WarehouseLoadSession;
    if (ex.status === "abierta") return ex;
    // Si ya había una cerrada, abrir una nueva para re-pistolear.
  }

  const { data: created, error: cErr } = await supabase
    .from("warehouse_load_sessions")
    .insert({
      kind: "descarga",
      container_number: carga.container_number,
      notes: carga.notes
        ? `Desde carga ${carga.container_number}. ${carga.notes}`
        : `Desde carga ${carga.container_number}`,
      status: "abierta",
      created_by: input.created_by?.trim() || null,
      source_carga_session_id: carga.id,
      ready_for_descarga: false,
    })
    .select("*")
    .single();
  if (cErr) {
    throw new Error(
      errMessage(cErr, "No se pudo abrir la descarga (¿migración 020?)"),
    );
  }
  const descarga = created as WarehouseLoadSession;

  const ras = await fetchSessionRas(carga.id);
  if (ras.length) {
    const rows = ras.map((r) => ({
      session_id: descarga.id,
      task_id: r.task_id,
      ra: r.ra,
      order_barcode: r.order_barcode,
      expected_bultos: r.expected_bultos,
      client_display: r.client_display,
      shipper_label: r.shipper_label,
      provider: r.provider,
      order_ref: r.order_ref,
    }));
    const { error: raErr } = await supabase
      .from("warehouse_load_session_ras")
      .upsert(rows, { onConflict: "session_id,ra", ignoreDuplicates: false });
    if (raErr) {
      throw new Error(
        errMessage(raErr, "Descarga creada pero no se copiaron los RA"),
      );
    }
  }

  return descarga;
}

export async function fetchLoadSession(
  sessionId: string,
): Promise<WarehouseLoadSession | null> {
  const { data, error } = await supabase
    .from("warehouse_load_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(errMessage(error, "No se pudo leer la sesión"));
  return (data as WarehouseLoadSession) ?? null;
}
