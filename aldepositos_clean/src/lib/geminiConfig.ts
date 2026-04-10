import { ApiError } from "@google/genai";
import { AI_ASSISTANT_DISPLAY_NAME } from "@/lib/aiAssistantBrand";

/** Modelo por defecto (alias “último Flash” de Google). Override con `GEMINI_MODEL`. */
export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";

/** Mensaje claro cuando la API indica límite de uso / facturación. */
export const GEMINI_QUOTA_USER_MESSAGE = `La cuota de ${AI_ASSISTANT_DISPLAY_NAME} no está disponible o se alcanzó el límite de solicitudes. Revisa facturación y límites en Google AI Studio (https://aistudio.google.com) o inténtalo más tarde.`;

/**
 * 403 PERMISSION_DENIED / "denied access": suele ser clave, proyecto de Google Cloud
 * o políticas de la cuenta — no es un fallo del código de la app.
 */
export const GEMINI_PERMISSION_DENIED_USER_MESSAGE = `Google denegó el acceso a la API (403). Suele deberse a la clave o al proyecto vinculado.

Qué probar:
1) En https://aistudio.google.com/apikey crea una clave nueva y sustituye GEMINI_API_KEY en .env.local (reinicia npm run dev).
2) En Google Cloud Console del proyecto de esa clave, comprueba que la API "Generative Language API" esté habilitada y que el proyecto no esté suspendido.
3) Si la clave tiene restricciones (IP, app), quítalas temporalmente o ajusta para tu entorno (localhost / tu servidor).
4) Si el mensaje dice "contact support", puede ser bloqueo de cuenta o región: abre un ticket con Google AI / Cloud Support.

Mientras tanto ${AI_ASSISTANT_DISPLAY_NAME} no podrá llamar al modelo hasta que Google acepte la clave.`;

/** 400 INVALID_ARGUMENT: clave caducada, revocada o mal copiada. */
export const GEMINI_API_KEY_INVALID_USER_MESSAGE = `La clave de API de Google (GEMINI_API_KEY) no es válida o está caducada.

Qué hacer:
1) Abre https://aistudio.google.com/apikey e inicia sesión con la misma cuenta de Google del proyecto.
2) Crea una clave nueva (o elimina la antigua y genera otra).
3) Copia la clave completa en .env.local como GEMINI_API_KEY=… sin comillas ni espacios.
4) Guarda el archivo y reinicia el servidor (detén y vuelve a ejecutar npm run dev).
5) Si publicas en Vercel u otro hosting, actualiza también la variable GEMINI_API_KEY allí y vuelve a desplegar.

Hasta usar una clave activa, ${AI_ASSISTANT_DISPLAY_NAME} no podrá conectarse a Gemini.`;

/**
 * Registra el error completo en servidor (logs de Vercel / consola local).
 */
export function logGeminiServerError(
  label: string,
  err: unknown,
  context?: Record<string, unknown>,
): void {
  const serialized = serializeGeminiError(err);
  console.error(`[${label}] resumen:`, {
    ...context,
    ...serialized,
  });
  // Objeto original (Node muestra stack y propiedades de ApiError)
  console.error(`[${label}] error completo:`, err);
  if (err instanceof Error && err.stack) {
    console.error(`[${label}] stack:`, err.stack);
  }
}

function serializeGeminiError(e: unknown): Record<string, unknown> {
  if (e instanceof ApiError) {
    return {
      kind: "ApiError",
      status: e.status,
      message: e.message,
      name: e.name,
    };
  }
  if (e instanceof Error) {
    return {
      kind: "Error",
      name: e.name,
      message: e.message,
    };
  }
  return { kind: typeof e, message: String(e) };
}

/**
 * Respuesta HTTP y texto para el cliente del asistente (sin filtrar detalle en 404).
 */
export function mapGeminiErrorToClientResponse(e: unknown): {
  httpStatus: number;
  error: string;
} {
  if (e instanceof ApiError) {
    const status = e.status;
    const raw = String(e.message ?? "").trim() || "Sin detalle del proveedor.";

    if (status === 429) {
      return { httpStatus: 429, error: GEMINI_QUOTA_USER_MESSAGE };
    }

    if (status === 403) {
      const lower = raw.toLowerCase();
      const looksLikePermissionDenied =
        lower.includes("permission_denied") ||
        lower.includes("denied access") ||
        lower.includes("has been denied") ||
        lower.includes("access has been denied");
      if (looksLikePermissionDenied) {
        return { httpStatus: 403, error: GEMINI_PERMISSION_DENIED_USER_MESSAGE };
      }
      return {
        httpStatus: 403,
        error: `Acceso denegado (403). ${raw}`,
      };
    }

    if (status === 400) {
      const lower = raw.toLowerCase();
      const looksLikeBadApiKey =
        lower.includes("api key expired") ||
        lower.includes("renew the api key") ||
        lower.includes("api_key_invalid") ||
        lower.includes("invalid api key") ||
        lower.includes("api key not valid");
      if (looksLikeBadApiKey) {
        return { httpStatus: 400, error: GEMINI_API_KEY_INVALID_USER_MESSAGE };
      }
    }

    if (status === 404) {
      return {
        httpStatus: 404,
        error: `Recurso no encontrado (404). Detalle: ${raw}`,
      };
    }

    const outStatus =
      Number.isFinite(status) && status >= 400 && status < 600 ? status : 502;
    return { httpStatus: outStatus, error: raw };
  }

  if (e instanceof Error) {
    return {
      httpStatus: 502,
      error: e.message || `Error al comunicar con ${AI_ASSISTANT_DISPLAY_NAME}.`,
    };
  }

  return {
    httpStatus: 502,
    error: `Error inesperado al comunicar con ${AI_ASSISTANT_DISPLAY_NAME}.`,
  };
}
