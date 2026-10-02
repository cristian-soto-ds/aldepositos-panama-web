import type { CollectionOrder } from "@/lib/types/collectionOrder";

function normalizeSearchText(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Texto donde se busca: número de OR, cliente, proveedor, marca, expedidor, RA y referencias. */
function orderSearchHaystack(order: CollectionOrder): string {
  const parts = [
    order.numero,
    order.cliente,
    order.proveedor,
    order.marca,
    order.expedidor,
    ...(order.linkedRaNumbers ?? []),
    ...(order.lines ?? []).map((l) => l.referencia),
  ];
  return normalizeSearchText(
    parts.map((p) => String(p ?? "").trim()).filter(Boolean).join(" "),
  );
}

/**
 * Cada palabra de la búsqueda debe aparecer en la OR (en cualquier campo).
 * «#6135» busca el número sin el «#».
 */
export function collectionOrderMatchesSearch(
  order: CollectionOrder,
  query: string,
): boolean {
  const tokens = normalizeSearchText(query.replace(/#/g, " "))
    .split(" ")
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = orderSearchHaystack(order);
  return tokens.every((t) => haystack.includes(t));
}

export function filterCollectionOrdersBySearch(
  orders: CollectionOrder[],
  query: string,
): CollectionOrder[] {
  if (!query.trim()) return orders;
  return orders.filter((o) => collectionOrderMatchesSearch(o, query));
}
