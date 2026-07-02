import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_GEMINI_MODEL,
  logGeminiServerError,
  mapGeminiErrorToClientResponse,
} from "@/lib/geminiConfig";
import { AI_ASSISTANT_DISPLAY_NAME } from "@/lib/aiAssistantBrand";
import type {
  DailyReceptionReportRow,
  DailyReceptionReportSummary,
} from "@/lib/receptionLogistics/buildDailyReceptionReport";
import type { ReceptionGeminiSummary } from "@/lib/receptionLogistics/exportDailyReceptionExcel";

export const runtime = "nodejs";
export const maxDuration = 60;

type RequestBody = {
  dateLabel?: string;
  rows?: DailyReceptionReportRow[];
  summary?: DailyReceptionReportSummary;
};

function parseGeminiJson(raw: string): ReceptionGeminiSummary | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  try {
    const parsed = JSON.parse(candidate) as ReceptionGeminiSummary;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return { resumen: trimmed };
  }
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: `${AI_ASSISTANT_DISPLAY_NAME} no configurado (falta GEMINI_API_KEY).` },
      { status: 503 },
    );
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Cuerpo JSON inválido." }, { status: 400 });
  }

  const rows = body.rows ?? [];
  const summary = body.summary;
  const dateLabel = body.dateLabel ?? "hoy";

  if (rows.length === 0) {
    return NextResponse.json({ error: "Sin filas para analizar." }, { status: 400 });
  }

  const prompt = `Sos analista logístico de ALDEPÓSITOS (Zona Libre, Panamá). Analizá el reporte diario de recepción de órdenes de recolección (OR) en bodega.

Fecha: ${dateLabel}

Resumen numérico:
${JSON.stringify(summary ?? {}, null, 2)}

Detalle por OR (JSON):
${JSON.stringify(rows, null, 2)}

Respondé ÚNICAMENTE con JSON válido (sin markdown) con esta forma:
{
  "titulo": "título corto del día",
  "resumen": "2-3 párrafos en español claro para gerencia: volumen, tiempos de espera, descarga y cumplimiento",
  "hallazgos": ["bullet 1", "bullet 2", "..."],
  "recomendaciones": ["acción 1", "acción 2"],
  "metricasDestacadas": [{ "label": "nombre métrica", "valor": "valor legible" }]
}

Enfocate en: hora de llegada, tiempo en fila, tiempo de descarga, cuellos de botella en rampas, OR pendientes vs completadas.`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.35,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
      },
    });

    const text =
      typeof response.text === "string"
        ? response.text
        : String(response.candidates?.[0]?.content?.parts?.[0]?.text ?? "");

    const parsed = parseGeminiJson(text);
    if (!parsed) {
      return NextResponse.json(
        { error: "No se pudo interpretar la respuesta del modelo." },
        { status: 502 },
      );
    }

    return NextResponse.json(parsed);
  } catch (err) {
    logGeminiServerError("reception-daily-report", err);
    const mapped = mapGeminiErrorToClientResponse(err);
    return NextResponse.json({ error: mapped.error }, { status: mapped.httpStatus });
  }
}
