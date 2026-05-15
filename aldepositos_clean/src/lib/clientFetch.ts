/**
 * `fetch` con tiempo máximo de espera (AbortController).
 * Solo para uso en el cliente (usa `window.setTimeout`).
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 30_000, signal: external, ...rest } = init;
  const controller = new AbortController();
  const id = window.setTimeout(() => controller.abort(), timeoutMs);

  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    window.clearTimeout(id);
  }
}
