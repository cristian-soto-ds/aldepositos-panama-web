import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16: `middleware` pasó a llamarse `proxy` (mismo rol en el edge).
 * @see https://nextjs.org/docs/messages/middleware-to-proxy
 */
export async function proxy(request: NextRequest) {
  try {
    return await updateSession(request);
  } catch (e) {
    console.error("[proxy]", e);
    return NextResponse.next({ request });
  }
}

export const config = {
  matcher: [
    /*
     * No ejecutar en: chunks/HMR de Next, imágenes optimizadas, API, favicon ni assets estáticos.
     * Un matcher demasiado amplio puede interceptar rutas internas y provocar fallos raros en dev.
     */
    "/((?!_next/|api/|favicon\\.ico|.*\\.(?:ico|svg|png|jpg|jpeg|gif|webp|woff2?|ttf|eot)$).*)",
  ],
};
