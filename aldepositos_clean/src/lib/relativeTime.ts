/**
 * Formatea un instante como tiempo relativo en español corto:
 * "ahora", "hace 3 s", "hace 5 min", "hace 2 h", "hace 3 d".
 * Acepta epoch ms (number) o ISO string. Devuelve "" si no hay valor válido.
 */
export function formatRelativeTime(
  value: number | string | null | undefined,
  now: number = Date.now(),
): string {
  if (value === null || value === undefined || value === "") return "";
  const ts = typeof value === "number" ? value : Date.parse(value);
  if (Number.isNaN(ts)) return "";

  const diffMs = Math.max(0, now - ts);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 5) return "ahora";
  if (sec < 60) return `hace ${sec} s`;

  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min} min`;

  const hours = Math.floor(min / 60);
  if (hours < 24) return `hace ${hours} h`;

  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}
