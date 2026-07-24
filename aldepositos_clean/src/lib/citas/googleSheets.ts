import { createSign } from "crypto";
import type { Cita } from "@/lib/citas/types";

const SHEET_HEADERS = [
  "id",
  "created_at",
  "empresa",
  "contacto",
  "email",
  "telefono",
  "fecha_preferida",
  "bultos_est",
  "peso_est",
  "cbm_est",
  "estado",
  "fecha_cita",
  "respuesta",
  "codigo_seguimiento",
  "adjuntos_urls",
  "updated_at",
] as const;

type SheetsConfig = {
  spreadsheetId: string;
  clientEmail: string;
  privateKey: string;
};

function getSheetsConfig(): SheetsConfig | null {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  let privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  if (!spreadsheetId || !clientEmail || !privateKey) return null;
  privateKey = privateKey.replace(/\\n/g, "\n");
  return { spreadsheetId, clientEmail, privateKey };
}

function base64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getAccessToken(cfg: SheetsConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: cfg.clientEmail,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = base64url(signer.sign(cfg.privateKey));
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google OAuth falló: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Google OAuth sin access_token");
  return json.access_token;
}

function citaToRow(cita: Cita, adjuntosUrls: string): string[] {
  return [
    cita.id,
    cita.created_at,
    cita.empresa,
    cita.contacto_nombre,
    cita.email,
    cita.telefono,
    cita.fecha_preferida,
    cita.bultos_estimados != null ? String(cita.bultos_estimados) : "",
    cita.peso_kg_estimado != null ? String(cita.peso_kg_estimado) : "",
    cita.cbm_estimado != null ? String(cita.cbm_estimado) : "",
    cita.estado,
    cita.fecha_cita ?? "",
    cita.respuesta_mensaje ?? "",
    cita.codigo_seguimiento,
    adjuntosUrls,
    cita.updated_at,
  ];
}

async function sheetsFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function ensureHeaderRow(
  token: string,
  spreadsheetId: string,
): Promise<void> {
  const range = encodeURIComponent("A1:P1");
  const getRes = await sheetsFetch(
    token,
    `${spreadsheetId}/values/${range}`,
  );
  if (!getRes.ok) {
    const text = await getRes.text();
    throw new Error(`Leer encabezados Sheet: ${getRes.status} ${text}`);
  }
  const json = (await getRes.json()) as { values?: string[][] };
  const first = json.values?.[0];
  if (first && first.length > 0) return;

  const putRes = await sheetsFetch(
    token,
    `${spreadsheetId}/values/${range}?valueInputOption=RAW`,
    {
      method: "PUT",
      body: JSON.stringify({ values: [[...SHEET_HEADERS]] }),
    },
  );
  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(`Escribir encabezados Sheet: ${putRes.status} ${text}`);
  }
}

async function findRowIndexById(
  token: string,
  spreadsheetId: string,
  citaId: string,
): Promise<number | null> {
  const range = encodeURIComponent("A:A");
  const res = await sheetsFetch(token, `${spreadsheetId}/values/${range}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Buscar id en Sheet: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { values?: string[][] };
  const values = json.values ?? [];
  for (let i = 0; i < values.length; i++) {
    if (values[i]?.[0] === citaId) return i + 1; // 1-based
  }
  return null;
}

/**
 * Upsert de una cita en Google Sheets.
 * Si faltan env vars, no hace nada (la cita ya está en Supabase).
 */
export async function syncCitaToGoogleSheet(
  cita: Cita,
  adjuntosUrls = "",
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const cfg = getSheetsConfig();
  if (!cfg) {
    console.info(
      "[citas/sheets] Sync omitido: faltan GOOGLE_SHEETS_* / GOOGLE_SERVICE_ACCOUNT_*",
    );
    return { ok: true, skipped: true };
  }

  try {
    const token = await getAccessToken(cfg);
    await ensureHeaderRow(token, cfg.spreadsheetId);
    const row = citaToRow(cita, adjuntosUrls);
    const existing = await findRowIndexById(token, cfg.spreadsheetId, cita.id);

    if (existing != null) {
      const range = encodeURIComponent(`A${existing}:P${existing}`);
      const res = await sheetsFetch(
        token,
        `${cfg.spreadsheetId}/values/${range}?valueInputOption=RAW`,
        {
          method: "PUT",
          body: JSON.stringify({ values: [row] }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Update Sheet fila ${existing}: ${res.status} ${text}`);
      }
    } else {
      const range = encodeURIComponent("A:P");
      const res = await sheetsFetch(
        token,
        `${cfg.spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        {
          method: "POST",
          body: JSON.stringify({ values: [row] }),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Append Sheet: ${res.status} ${text}`);
      }
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[citas/sheets] Sync falló:", msg);
    return { ok: false, error: msg };
  }
}
