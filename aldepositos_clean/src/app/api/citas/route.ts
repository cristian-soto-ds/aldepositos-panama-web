import { NextRequest, NextResponse } from "next/server";
import {
  createSignedAdjuntoUrls,
  fetchCitasForViewer,
  generateCodigoSeguimiento,
  resolveAuthFromRequest,
  uploadCitaAdjuntos,
} from "@/lib/citas/server";
import {
  CITA_ALLOWED_MIME,
  CITA_MAX_FILE_BYTES,
  CITA_MAX_FILES,
  normalizeCitaRow,
} from "@/lib/citas/types";
import { syncCitaToGoogleSheet } from "@/lib/citas/googleSheets";

function parseOptionalNumber(raw: FormDataEntryValue | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(String(raw).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function trimRequired(raw: FormDataEntryValue | null, label: string): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) throw new Error(`Falta el campo: ${label}`);
  return v;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveAuthFromRequest(request);
    if (!auth.user) {
      return NextResponse.json({ error: "Sin sesión." }, { status: 401 });
    }

    const estado = request.nextUrl.searchParams.get("estado");
    const lite = request.nextUrl.searchParams.get("lite") === "1";
    const since = request.nextUrl.searchParams.get("since");

    const citas = await fetchCitasForViewer(auth.admin, {
      rol: auth.rol,
      userId: auth.user.id,
      email: auth.user.email ?? auth.perfil?.correoPerfil ?? null,
      estado: estado || null,
    });

    let maxUpdated = "";
    for (const c of citas) {
      if (c.updated_at && c.updated_at > maxUpdated) maxUpdated = c.updated_at;
    }
    const fingerprint = `${citas.length}|${maxUpdated}`;

    if (since && since === fingerprint) {
      return NextResponse.json({
        unchanged: true,
        fingerprint,
        rol: auth.rol,
      });
    }

    // Lista ligera: sin URLs firmadas (caro). Se firman al abrir el detalle.
    if (lite) {
      return NextResponse.json({
        citas,
        fingerprint,
        rol: auth.rol,
        lite: true,
      });
    }

    const withUrls = await Promise.all(
      citas.map(async (c) => ({
        ...c,
        adjuntos: await createSignedAdjuntoUrls(auth.admin, c.adjuntos),
      })),
    );

    return NextResponse.json({
      citas: withUrls,
      fingerprint,
      rol: auth.rol,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[GET /api/citas]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveAuthFromRequest(request);
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        {
          error:
            "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor (necesaria para adjuntos).",
        },
        { status: 500 },
      );
    }
    const db = auth.admin;

    const form = await request.formData();
    const empresa = trimRequired(form.get("empresa"), "empresa");
    const contacto_nombre = trimRequired(
      form.get("contacto_nombre"),
      "contacto_nombre",
    );
    const email = trimRequired(form.get("email"), "email").toLowerCase();
    const telefono = trimRequired(form.get("telefono"), "telefono");
    const fecha_preferida = trimRequired(
      form.get("fecha_preferida"),
      "fecha_preferida",
    );
    const hora_preferida =
      typeof form.get("hora_preferida") === "string"
        ? String(form.get("hora_preferida")).trim() || null
        : null;
    const observaciones =
      typeof form.get("observaciones") === "string"
        ? String(form.get("observaciones")).trim() || null
        : null;

    const bultos_estimados = parseOptionalNumber(form.get("bultos_estimados"));
    const peso_kg_estimado = parseOptionalNumber(form.get("peso_kg_estimado"));
    const cbm_estimado = parseOptionalNumber(form.get("cbm_estimado"));

    const files = form
      .getAll("adjuntos")
      .filter((f): f is File => f instanceof File && f.size > 0);

    if (files.length > CITA_MAX_FILES) {
      return NextResponse.json(
        { error: `Máximo ${CITA_MAX_FILES} archivos.` },
        { status: 400 },
      );
    }
    for (const f of files) {
      if (f.size > CITA_MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: `Archivo demasiado grande: ${f.name} (máx 15 MB).` },
          { status: 400 },
        );
      }
      const mime = f.type || "application/octet-stream";
      if (!CITA_ALLOWED_MIME.has(mime)) {
        return NextResponse.json(
          {
            error: `Tipo no permitido: ${f.name}. Usa PDF, imagen o Excel/CSV.`,
          },
          { status: 400 },
        );
      }
    }

    const codigo_seguimiento = generateCodigoSeguimiento();
    const proveedor_user_id =
      auth.user && auth.rol === "proveedor" ? auth.user.id : null;

    const { data: inserted, error: insertErr } = await db
      .from("citas")
      .insert({
        empresa,
        contacto_nombre,
        email,
        telefono,
        fecha_preferida,
        hora_preferida,
        bultos_estimados,
        peso_kg_estimado,
        cbm_estimado,
        observaciones,
        estado: "pendiente",
        codigo_seguimiento,
        proveedor_user_id,
        adjuntos: [],
      })
      .select("*")
      .single();

    if (insertErr || !inserted) {
      throw new Error(insertErr?.message ?? "No se pudo crear la cita.");
    }

    let cita = normalizeCitaRow(inserted as Record<string, unknown>);

    if (files.length > 0) {
      const adjuntos = await uploadCitaAdjuntos(db, cita.id, files);
      const { data: updated, error: updErr } = await db
        .from("citas")
        .update({ adjuntos })
        .eq("id", cita.id)
        .select("*")
        .single();
      if (updErr || !updated) {
        throw new Error(updErr?.message ?? "Cita creada pero falló guardar adjuntos.");
      }
      cita = normalizeCitaRow(updated as Record<string, unknown>);
    }

    const signed = await createSignedAdjuntoUrls(db, cita.adjuntos);
    const adjuntosUrls = signed
      .map((a) => a.url)
      .filter((u): u is string => !!u)
      .join(" | ");

    void syncCitaToGoogleSheet(cita, adjuntosUrls);

    return NextResponse.json({
      ok: true,
      cita: {
        ...cita,
        adjuntos: signed,
      },
      codigo_seguimiento: cita.codigo_seguimiento,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[POST /api/citas]", msg);
    const status = msg.startsWith("Falta el campo") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
