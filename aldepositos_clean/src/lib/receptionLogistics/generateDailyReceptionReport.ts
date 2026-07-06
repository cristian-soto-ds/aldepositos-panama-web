import type { ReceptionTruck } from "@/lib/receptionLogistics/types";
import {
  buildDailyReceptionReport,
  formatReportDateLabel,
} from "@/lib/receptionLogistics/buildDailyReceptionReport";
import {
  downloadDailyReceptionExcel,
  type ReceptionGeminiSummary,
} from "@/lib/receptionLogistics/exportDailyReceptionExcel";
import { rampOccupancyReportLines, type RampOccupancyState } from "@/lib/receptionLogistics/rampOccupancy";
import { fetchRampOccupancy } from "@/lib/receptionLogistics/rampOccupancyRepository";

export class DailyReceptionReportError extends Error {
  constructor(
    message: string,
    readonly code: "NO_ROWS" | "EXPORT_FAILED" = "EXPORT_FAILED",
  ) {
    super(message);
    this.name = "DailyReceptionReportError";
  }
}

export async function generateAndDownloadDailyReceptionReport(
  trucks: ReceptionTruck[],
  options?: { exportedByLabel?: string; reportDate?: Date },
): Promise<{ rowCount: number; withGemini: boolean }> {
  const reportDate = options?.reportDate ?? new Date();
  const { rows, summary: baseSummary } = buildDailyReceptionReport(trucks, reportDate);

  let rampOccupancy: RampOccupancyState | null = null;
  try {
    rampOccupancy = await fetchRampOccupancy();
  } catch {
    /* Estado de rampas opcional */
  }

  const rampLines = rampOccupancy ? rampOccupancyReportLines(rampOccupancy) : null;
  const summary = {
    ...baseSummary,
    ...(rampLines
      ? {
          rampa1Estado: rampLines.rampa1.value,
          rampa2Estado: rampLines.rampa2.value,
        }
      : {}),
  };

  if (rows.length === 0) {
    throw new DailyReceptionReportError(
      "No hay órdenes de recolección (OR) registradas hoy en recepción.",
      "NO_ROWS",
    );
  }

  let geminiSummary: ReceptionGeminiSummary | null = null;
  try {
    const res = await fetch("/api/reception/daily-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dateLabel: formatReportDateLabel(reportDate),
        rows,
        summary,
      }),
    });
    if (res.ok) {
      geminiSummary = (await res.json()) as ReceptionGeminiSummary;
    }
  } catch {
    /* Resumen IA opcional */
  }

  await downloadDailyReceptionExcel({
    rows,
    summary,
    reportDate,
    exportedByLabel: options?.exportedByLabel,
    geminiSummary,
    rampOccupancy,
  });

  return {
    rowCount: rows.length,
    withGemini: !!geminiSummary?.resumen,
  };
}
