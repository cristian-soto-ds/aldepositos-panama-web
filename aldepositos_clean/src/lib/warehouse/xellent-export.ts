/**
 * Export CSV/TXT de códigos para pegar en software Xellent X-1000VL.
 */

export type XellentCodeRow = {
  tipo: "EXPEDIDOR" | "RA" | "BULTO";
  codigo: string;
  cliente: string;
  nombre: string;
  ra?: string;
  expedidor?: string;
  proveedor?: string;
  referencia?: string;
  bultos?: number | string;
  bulto?: number | string;
  total?: number | string;
};

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** CSV de expedidores (códigos EXP-…). */
export function buildXellentCsv(rows: XellentCodeRow[]): string {
  const header = [
    "tipo",
    "codigo",
    "cliente",
    "nombre",
    "ra",
    "expedidor",
    "proveedor",
    "referencia",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.tipo,
        r.codigo,
        r.cliente,
        r.nombre,
        r.ra ?? "",
        r.expedidor ?? "",
        r.proveedor ?? "",
        r.referencia ?? "",
      ]
        .map((c) => csvEscape(String(c)))
        .join(","),
    );
  }
  return lines.join("\r\n");
}

/** CSV de pedidos / RA: sin tipo ni nombre; bultos al final. */
export function buildXellentRaCsv(rows: XellentCodeRow[]): string {
  const header = [
    "codigo",
    "cliente",
    "ra",
    "expedidor",
    "proveedor",
    "referencia",
    "bultos",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.codigo,
        r.cliente,
        r.ra ?? "",
        r.expedidor ?? "",
        r.proveedor ?? "",
        r.referencia ?? "",
        r.bultos ?? "",
      ]
        .map((c) => csvEscape(String(c)))
        .join(","),
    );
  }
  return lines.join("\r\n");
}

/** CSV una fila por bulto físico (código corto RA-NNN). */
export function buildXellentPackageCsv(rows: XellentCodeRow[]): string {
  const header = [
    "codigo",
    "ra",
    "bulto",
    "total",
    "cliente",
    "expedidor",
    "proveedor",
    "referencia",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.codigo,
        r.ra ?? "",
        r.bulto ?? "",
        r.total ?? r.bultos ?? "",
        r.cliente,
        r.expedidor ?? "",
        r.proveedor ?? "",
        r.referencia ?? "",
      ]
        .map((c) => csvEscape(String(c)))
        .join(","),
    );
  }
  return lines.join("\r\n");
}

export function downloadTextFile(
  content: string,
  filename: string,
  mime = "text/csv;charset=utf-8",
): void {
  const blob = new Blob(["\uFEFF" + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
