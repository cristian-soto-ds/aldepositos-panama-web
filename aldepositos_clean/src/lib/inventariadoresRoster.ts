export type InventariadorEntry = {
  id: string;
  name: string;
  aliases: string[];
};

export const INVENTARIADORES: InventariadorEntry[] = [
  {
    id: "jahir",
    name: "Jahir Jimenez",
    aliases: ["jahir jimenez", "jahir jiménez"],
  },
  {
    id: "claudio",
    name: "Claudio Guitierrez",
    aliases: ["claudio guitierrez", "claudio gutiérrez"],
  },
  {
    id: "raul",
    name: "Raul Lezcano",
    aliases: ["raul lezcano", "raúl lezcano"],
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
  for (const alias of entry.aliases) {
    LOOKUP.set(normalizeInventariadorKey(alias), entry.id);
  }
}

/** Resuelve displayName (y opcionalmente email) al id del roster, o null si no coincide. */
export function resolveInventariadorId(
  displayName: string | null | undefined,
  email?: string | null,
): string | null {
  const nameKey = normalizeInventariadorKey(displayName ?? "");
  if (nameKey && LOOKUP.has(nameKey)) return LOOKUP.get(nameKey)!;

  const emailKey = normalizeInventariadorKey(email ?? "");
  if (emailKey && LOOKUP.has(emailKey)) return LOOKUP.get(emailKey)!;

  return null;
}

export function getInventariadorById(id: string): InventariadorEntry | undefined {
  return INVENTARIADORES.find((e) => e.id === id);
}
