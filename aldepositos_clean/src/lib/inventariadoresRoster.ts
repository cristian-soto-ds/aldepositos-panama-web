export type InventariadorEntry = {
  id: string;
  name: string;
  aliases: string[];
};

export const INVENTARIADORES: InventariadorEntry[] = [
  {
    id: "jahir",
    name: "Jahir Jimenez",
    aliases: ["jahir jimenez", "jahir jiménez", "jahir"],
  },
  {
    id: "claudio",
    name: "Claudio Guitierrez",
    aliases: [
      "claudio guitierrez",
      "claudio gutierrez",
      "claudio gutiérrez",
      "claudio",
    ],
  },
  {
    id: "raul",
    name: "Raul Lezcano",
    aliases: ["raul lezcano", "raúl lezcano", "raul"],
  },
];

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

export function normalizeInventariadorKey(value: string): string {
  return stripAccents(String(value ?? "").trim().toLowerCase()).replace(/\s+/g, " ");
}

const LOOKUP = new Map<string, string>();

for (const entry of INVENTARIADORES) {
  LOOKUP.set(normalizeInventariadorKey(entry.name), entry.id);
  LOOKUP.set(entry.id, entry.id);
  for (const alias of entry.aliases) {
    LOOKUP.set(normalizeInventariadorKey(alias), entry.id);
  }
}

function lookupCandidate(raw: string | null | undefined): string | null {
  const key = normalizeInventariadorKey(raw ?? "");
  if (!key) return null;
  if (LOOKUP.has(key)) return LOOKUP.get(key)!;

  // Prefijo de email (ej. claudio@…) o nombre que contiene el alias.
  const local = key.includes("@") ? key.split("@")[0]! : key;
  if (LOOKUP.has(local)) return LOOKUP.get(local)!;

  for (const entry of INVENTARIADORES) {
    const candidates = [entry.name, entry.id, ...entry.aliases].map(normalizeInventariadorKey);
    for (const c of candidates) {
      if (!c) continue;
      if (local === c || local.startsWith(`${c} `) || c.startsWith(`${local} `)) {
        return entry.id;
      }
      if (local.includes(c) || c.includes(local)) {
        // Evitar matches demasiado cortos (ej. "ra" dentro de otra cosa).
        if (Math.min(local.length, c.length) >= 4 || local === c) return entry.id;
      }
    }
  }

  return null;
}

/** Resuelve displayName (y opcionalmente email) al id del roster, o null si no coincide. */
export function resolveInventariadorId(
  displayName: string | null | undefined,
  email?: string | null,
): string | null {
  return (
    lookupCandidate(displayName) ??
    lookupCandidate(email) ??
    null
  );
}

export function getInventariadorById(id: string): InventariadorEntry | undefined {
  return INVENTARIADORES.find((e) => e.id === id);
}
