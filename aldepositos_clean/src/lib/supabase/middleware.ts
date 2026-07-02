import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

/** Copia cabeceras Set-Cookie (p. ej. refresh de sesión) a una redirección. */
function applySetCookiesFrom(from: NextResponse, to: NextResponse) {
  try {
    const list = from.headers.getSetCookie?.() ?? [];
    for (const line of list) {
      to.headers.append("Set-Cookie", line);
    }
  } catch {
    /* Edge: getSetCookie/append puede fallar según runtime; la redirección sigue válida */
  }
}

/**
 * Refresca la sesión Supabase en cookies y protege rutas del panel.
 * Se ejecuta en el edge (proxy).
 *
 * Importante: `setAll` debe recibir **y aplicar** el 2.º argumento `headers` que envía
 * @supabase/ssr al refrescar tokens (Cache-Control, etc.). Si no, pueden fallos raros o 500.
 */
export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  if (path.startsWith("/_next") || path.startsWith("/api")) {
    return NextResponse.next({ request });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });
  let user: User | null = null;

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
          if (headers && typeof headers === "object") {
            for (const [key, value] of Object.entries(headers)) {
              if (typeof value === "string") {
                supabaseResponse.headers.set(key, value);
              }
            }
          }
        },
      },
    });

    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user) {
      user = data.user;
    }
  } catch (e) {
    console.error("[supabase/middleware] getUser", e);
    return NextResponse.next({ request });
  }

  if (user && (path === "/login" || path === "/")) {
    try {
      const redirect = NextResponse.redirect(new URL("/panel", request.url));
      applySetCookiesFrom(supabaseResponse, redirect);
      return redirect;
    } catch (e) {
      console.error("[supabase/middleware] redirect authed", e);
      return supabaseResponse;
    }
  }

  if (!user && (path.startsWith("/panel") || path.startsWith("/welcome"))) {
    try {
      const redirect = NextResponse.redirect(new URL("/login", request.url));
      applySetCookiesFrom(supabaseResponse, redirect);
      return redirect;
    } catch (e) {
      console.error("[supabase/middleware] redirect guest", e);
      return supabaseResponse;
    }
  }

  return supabaseResponse;
}
