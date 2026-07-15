"use client";

import { useEffect, useState } from "react";

/**
 * Un solo reloj compartido para etiquetas "hace X" (evita N setInterval por tarjeta).
 */
export function useSharedNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
