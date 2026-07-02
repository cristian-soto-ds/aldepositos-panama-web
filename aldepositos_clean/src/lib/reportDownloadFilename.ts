export type ReportDownloadFilenameTask = {
  ra: string;
  provider?: string;
  currentBultos?: number;
};

function formatRaNumber(ra: string): string {
  const trimmed = String(ra ?? "").trim();
  if (!trimmed) return "0";
  return trimmed.replace(/^RA-?/i, "").trim() || trimmed;
}

function sanitizeFilenamePart(s: string): string {
  return String(s ?? "")
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

/** Número RA + tres espacios + proveedor + tres espacios + bultos + " BULTOS" */
export function buildReportDownloadFilename(
  tasks: ReportDownloadFilenameTask[],
): string {
  if (tasks.length === 0) return "reporte";

  const ra = formatRaNumber(tasks[0].ra);
  const provider = sanitizeFilenamePart(tasks[0].provider || "Sin proveedor");
  const bultos =
    tasks.length === 1
      ? Math.round(Number(tasks[0].currentBultos) || 0)
      : tasks.reduce((sum, t) => sum + (Number(t.currentBultos) || 0), 0);

  const base = `${ra}   ${provider}   ${bultos} BULTOS`;

  if (tasks.length > 1) {
    return `${base} y ${tasks.length - 1} ordenes mas`;
  }

  return base;
}
