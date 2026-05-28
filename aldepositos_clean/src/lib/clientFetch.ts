/**
 * `fetch` con tiempo máximo de espera (AbortController).
 * Solo para uso en el cliente (usa `window.setTimeout`).
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number; timeoutReason?: string } = {},
): Promise<Response> {
  const { timeoutMs = 30_000, timeoutReason, signal: external, ...rest } = init;
  const controller = new AbortController();
  const id = window.setTimeout(() => {
    const reason =
      timeoutReason ??
      "La solicitud tardó demasiado. Reintenta en unos segundos.";
    try {
      controller.abort(
        typeof DOMException !== "undefined"
          ? new DOMException(reason, "TimeoutError")
          : reason,
      );
    } catch {
      controller.abort();
    }
  }, timeoutMs);

  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      const msg =
        err.message && err.message !== "signal is aborted without reason"
          ? err.message
          : timeoutReason ?? "La solicitud fue cancelada o tardó demasiado.";
      throw new DOMException(msg, "TimeoutError");
    }
    throw err;
  } finally {
    window.clearTimeout(id);
  }
}
