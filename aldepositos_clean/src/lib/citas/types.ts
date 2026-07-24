export const CITA_ESTADOS = [
  "pendiente",
  "confirmada",
  "rechazada",
  "completada",
] as const;

export type CitaEstado = (typeof CITA_ESTADOS)[number];

export type CitaAdjunto = {
  path: string;
  name: string;
  size: number;
  mime: string;
};

export type Cita = {
  id: string;
  created_at: string;
  updated_at: string;
  empresa: string;
  contacto_nombre: string;
  email: string;
  telefono: string;
  fecha_preferida: string;
  hora_preferida: string | null;
  bultos_estimados: number | null;
  peso_kg_estimado: number | null;
  cbm_estimado: number | null;
  observaciones: string | null;
  estado: CitaEstado;
  fecha_cita: string | null;
  hora_cita: string | null;
  respuesta_mensaje: string | null;
  respondido_por: string | null;
  respondido_at: string | null;
  proveedor_user_id: string | null;
  codigo_seguimiento: string;
  adjuntos: CitaAdjunto[];
};

export type CitaCreateInput = {
  empresa: string;
  contacto_nombre: string;
  email: string;
  telefono: string;
  fecha_preferida: string;
  hora_preferida?: string | null;
  bultos_estimados?: number | null;
  peso_kg_estimado?: number | null;
  cbm_estimado?: number | null;
  observaciones?: string | null;
  proveedor_user_id?: string | null;
};

export type CitaRespondInput = {
  estado: Exclude<CitaEstado, "pendiente">;
  fecha_cita?: string | null;
  hora_cita?: string | null;
  respuesta_mensaje?: string | null;
};

export const CITA_ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
]);

export const CITA_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const CITA_MAX_FILES = 8;

export function isCitaEstado(v: unknown): v is CitaEstado {
  return typeof v === "string" && (CITA_ESTADOS as readonly string[]).includes(v);
}

export function parseAdjuntos(raw: unknown): CitaAdjunto[] {
  if (!Array.isArray(raw)) return [];
  const out: CitaAdjunto[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const path = typeof o.path === "string" ? o.path : "";
    const name = typeof o.name === "string" ? o.name : "";
    if (!path || !name) continue;
    out.push({
      path,
      name,
      size: typeof o.size === "number" ? o.size : 0,
      mime: typeof o.mime === "string" ? o.mime : "application/octet-stream",
    });
  }
  return out;
}

export function normalizeCitaRow(row: Record<string, unknown>): Cita {
  return {
    id: String(row.id ?? ""),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    empresa: String(row.empresa ?? ""),
    contacto_nombre: String(row.contacto_nombre ?? ""),
    email: String(row.email ?? ""),
    telefono: String(row.telefono ?? ""),
    fecha_preferida: String(row.fecha_preferida ?? ""),
    hora_preferida:
      typeof row.hora_preferida === "string" ? row.hora_preferida : null,
    bultos_estimados:
      typeof row.bultos_estimados === "number" ? row.bultos_estimados : null,
    peso_kg_estimado:
      typeof row.peso_kg_estimado === "number"
        ? row.peso_kg_estimado
        : row.peso_kg_estimado != null
          ? Number(row.peso_kg_estimado)
          : null,
    cbm_estimado:
      typeof row.cbm_estimado === "number"
        ? row.cbm_estimado
        : row.cbm_estimado != null
          ? Number(row.cbm_estimado)
          : null,
    observaciones:
      typeof row.observaciones === "string" ? row.observaciones : null,
    estado: isCitaEstado(row.estado) ? row.estado : "pendiente",
    fecha_cita: typeof row.fecha_cita === "string" ? row.fecha_cita : null,
    hora_cita: typeof row.hora_cita === "string" ? row.hora_cita : null,
    respuesta_mensaje:
      typeof row.respuesta_mensaje === "string" ? row.respuesta_mensaje : null,
    respondido_por:
      typeof row.respondido_por === "string" ? row.respondido_por : null,
    respondido_at:
      typeof row.respondido_at === "string" ? row.respondido_at : null,
    proveedor_user_id:
      typeof row.proveedor_user_id === "string" ? row.proveedor_user_id : null,
    codigo_seguimiento: String(row.codigo_seguimiento ?? ""),
    adjuntos: parseAdjuntos(row.adjuntos),
  };
}
