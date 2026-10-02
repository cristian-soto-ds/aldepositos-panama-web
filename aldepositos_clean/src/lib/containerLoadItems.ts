import type { ContainerLoadItem } from "@/lib/types/containerLoad";

/** Clave de RA para cruzar Excel ↔ tasks (sin prefijo RA, sin espacios). */
export function normalizeContainerLoadRa(ra: unknown): string {
  return String(ra ?? "")
    .trim()
    .toUpperCase()
    .replace(/^RA[\s\-_#]*/i, "")
    .replace(/\s+/g, "")
    .replace(/\.0+$/, "");
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toText(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  return s ? s : undefined;
}

/** Normaliza, deduplica por RA y renumera posiciones 1..n en orden. */
export function sanitizeContainerLoadItems(raw: unknown): ContainerLoadItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ContainerLoadItem[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    const ra = normalizeContainerLoadRa(row.ra);
    if (!ra || seen.has(ra)) continue;
    seen.add(ra);
    out.push({
      position: toNumber(row.position) ?? out.length + 1,
      ra,
      cliente: toText(row.cliente),
      proveedor: toText(row.proveedor),
      marca: toText(row.marca),
      expedidor: toText(row.expedidor),
      seguimiento: toText(row.seguimiento),
      bultos: toNumber(row.bultos),
      cbm: toNumber(row.cbm),
      peso: toNumber(row.peso),
      notas: toText(row.notas),
      ...(row.noInventoryRequired === true
        ? {
            noInventoryRequired: true,
            noInventoryReason: toText(row.noInventoryReason),
            noInventoryMarkedBy: toText(row.noInventoryMarkedBy),
          }
        : {}),
    });
  }
  out.sort((a, b) => a.position - b.position);
  return out.map((it, i) => ({ ...it, position: i + 1 }));
}
