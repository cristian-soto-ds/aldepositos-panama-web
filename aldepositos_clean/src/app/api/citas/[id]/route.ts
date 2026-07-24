import { NextRequest, NextResponse } from "next/server";
import {
  createSignedAdjuntoUrls,
  resolveAuthFromRequest,
} from "@/lib/citas/server";
import {
  isCitaEstado,
  normalizeCitaRow,
  type CitaEstado,
} from "@/lib/citas/types";
import { syncCitaToGoogleSheet } from "@/lib/citas/googleSheets";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await resolveAuthFromRequest(request);
    if (!auth.user) {
      return NextResponse.json({ error: "Sin sesión." }, { status: 401 });
    }

    const { data, error } = await auth.admin
      .from("citas")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Cita no encontrada." }, { status: 404 });
    }

    const cita = normalizeCitaRow(data as Record<string, unknown>);
    if (auth.rol === "proveedor") {
      const email = (
        auth.user.email ??
        auth.perfil?.correoPerfil ??
        ""
      ).toLowerCase();
      const own =
        cita.proveedor_user_id === auth.user.id ||
        (email && cita.email.toLowerCase() === email);
      if (!own) {
        return NextResponse.json({ error: "Sin permiso." }, { status: 403 });
      }
    }

    const adjuntos = await createSignedAdjuntoUrls(auth.admin, cita.adjuntos);
    return NextResponse.json({ cita: { ...cita, adjuntos }, rol: auth.rol });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[GET /api/citas/:id]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const auth = await resolveAuthFromRequest(request);
    if (!auth.user) {
      return NextResponse.json({ error: "Sin sesión." }, { status: 401 });
    }
    if (auth.rol !== "staff") {
      return NextResponse.json(
        { error: "Solo personal AlDepósitos puede responder citas." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as Record<string, unknown>;
    const estadoRaw = body.estado;
    if (!isCitaEstado(estadoRaw) || estadoRaw === "pendiente") {
      return NextResponse.json(
        {
          error:
            "estado debe ser confirmada, rechazada o completada.",
        },
        { status: 400 },
      );
    }
    const estado = estadoRaw as Exclude<CitaEstado, "pendiente">;

    const fecha_cita =
      typeof body.fecha_cita === "string" ? body.fecha_cita.trim() || null : null;
    const hora_cita =
      typeof body.hora_cita === "string" ? body.hora_cita.trim() || null : null;
    const respuesta_mensaje =
      typeof body.respuesta_mensaje === "string"
        ? body.respuesta_mensaje.trim() || null
        : null;

    if (estado === "confirmada" && !fecha_cita) {
      return NextResponse.json(
        { error: "Para confirmar indica fecha_cita." },
        { status: 400 },
      );
    }

    const { data, error } = await auth.admin
      .from("citas")
      .update({
        estado,
        fecha_cita,
        hora_cita,
        respuesta_mensaje,
        respondido_por: auth.user.id,
        respondido_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Cita no encontrada." }, { status: 404 });
    }

    const cita = normalizeCitaRow(data as Record<string, unknown>);
    const signed = await createSignedAdjuntoUrls(auth.admin, cita.adjuntos);
    const adjuntosUrls = signed
      .map((a) => a.url)
      .filter((u): u is string => !!u)
      .join(" | ");

    void syncCitaToGoogleSheet(cita, adjuntosUrls);

    return NextResponse.json({
      ok: true,
      cita: { ...cita, adjuntos: signed },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[PATCH /api/citas/:id]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
