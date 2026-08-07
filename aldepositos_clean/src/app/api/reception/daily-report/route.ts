import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import {
  ALDEGPT_TERRA_DISPLAY_NAME,
  aldeGptModelOption,
} from "@/lib/aldeGptTerraBrand";
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

function parseTerraJson(raw: string): ReceptionGeminiSummary | null {
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

function extractOutputText(response: {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
}): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "output_text" && typeof c.text === "string") {
        parts.push(c.text);
      }
    }
  }
  return parts.join("\n").trim();
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error: `${ALDEGPT_TERRA_DISPLAY_NAME} no configurado (falta OPENAI_API_KEY).`,
      },
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

  // Compactar filas para el prompt (menos tokens, datos clave).
  const compactRows = rows.map((r) => ({
    or: r.orNumero,
    proveedor: r.proveedor,
    cliente: r.cliente,
    bultos: r.bultos,
    llegada: r.horaLlegada,
    esperaFila: r.minutosEnFila,
    rampa: r.rampa,
    horaRampa: r.horaRampa,
    descargaMin: r.minutosDescarga,
    completado: r.horaCompletado,
    totalMin: r.minutosTotal,
    estado: r.estado,
  }));

  const prompt = `Eres ${ALDEGPT_TERRA_DISPLAY_NAME}, analista logístico de ALDEPÓSITOS (Zona Libre, Panamá).

Organizá el reporte de camiones / OR que llegaron a bodega en el período: ${dateLabel}.

Resumen numérico:
${JSON.stringify(summary ?? {}, null, 2)}

Detalle por OR:
${JSON.stringify(compactRows, null, 2)}

Respondé ÚNICAMENTE con JSON válido (sin markdown) con esta forma exacta:
{
  "titulo": "título corto y claro del período",
  "resumen": "2-3 párrafos en español claro para gerencia: cuántos camiones/OR, bultos, tiempos de espera y descarga, cumplimiento",
  "hallazgos": ["dato concreto 1", "dato concreto 2", "..."],
  "recomendaciones": ["acción operativa 1", "acción operativa 2"],
  "metricasDestacadas": [{ "label": "nombre métrica", "valor": "valor legible" }]
}

Priorizá información directa y útil:
- Total de OR / camiones y bultos
- Tiempos de espera en fila y descarga
- Rampas más usadas o cuellos de botella
- Estado Rampa 1 / Rampa 2 si viene en el resumen
- OR pendientes vs completadas
Sé concreto, sin relleno.`;

  try {
    const client = new OpenAI({ apiKey });
    const model = aldeGptModelOption("terra").apiModel;
    const response = await client.responses.create({
      model,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }],
        },
      ],
      text: {
        format: { type: "json_object" },
      },
      temperature: 0.3,
      max_output_tokens: 2048,
    });

    const text = extractOutputText(response);
    const parsed = parseTerraJson(text);
    if (!parsed) {
      return NextResponse.json(
        { error: "No se pudo interpretar la respuesta de AldeGpt Terra." },
        { status: 502 },
      );
    }

    return NextResponse.json(parsed);
  } catch (err) {
    console.error("[reception-daily-report] terra", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: msg.includes("api key") || msg.includes("401")
          ? "OpenAI rechazó la clave. Revisá OPENAI_API_KEY."
          : `No se pudo generar el resumen con ${ALDEGPT_TERRA_DISPLAY_NAME}.`,
      },
      { status: 502 },
    );
  }
}
