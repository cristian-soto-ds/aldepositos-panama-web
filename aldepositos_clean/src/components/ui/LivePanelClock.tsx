"use client";

import React, { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";

export type LivePanelClockProps = {
  /** Mostrar segundos (TV / preferencia del panel). */
  showSeconds?: boolean;
  /** Formato 12h vs 24h. */
  hour12?: boolean;
  /**
   * `inline` = solo hora (panel principal).
   * `tv` = hora grande + fecha (pantalla TV recepción).
   */
  variant?: "inline" | "tv";
  className?: string;
};

/**
 * Reloj hoja aislado: no re-renderiza el árbol padre cada tick.
 * Timeout alineado al segundo + reprograma al volver a la pestaña.
 */
export function LivePanelClock({
  showSeconds = false,
  hour12 = false,
  variant = "inline",
  className,
}: LivePanelClockProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timeoutId = 0;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      const intervalMs = showSeconds ? 1_000 : 60_000;
      const delay = showSeconds
        ? Math.max(16, 1_000 - (Date.now() % 1_000))
        : Math.max(16, intervalMs - (Date.now() % intervalMs));
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        setNow(new Date());
        schedule();
      }, delay);
    };

    const clear = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      timeoutId = 0;
    };

    const restart = () => {
      clear();
      setNow(new Date());
      schedule();
    };

    restart();

    const onVisibility = () => {
      if (document.visibilityState === "visible" && !cancelled) {
        restart();
      } else {
        clear();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [showSeconds]);

  const timeStr = now.toLocaleTimeString("es-PA", {
    hour: "2-digit",
    minute: "2-digit",
    second: showSeconds ? "2-digit" : undefined,
    hour12,
  });

  if (variant === "tv") {
    const dateStr = now.toLocaleDateString("es-PA", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    return (
      <div className={className ?? "hidden text-right sm:block"}>
        <p className="flex items-center justify-end gap-2 text-2xl font-black tabular-nums tracking-tight text-[#16263F] md:text-3xl">
          <Clock3 className="h-6 w-6 shrink-0 text-amber-600" aria-hidden />
          <span suppressHydrationWarning>{timeStr}</span>
        </p>
        <p className="mt-0.5 text-xs font-medium capitalize text-slate-500">
          {dateStr}
        </p>
      </div>
    );
  }

  return (
    <span
      className={className ?? "tabular-nums"}
      suppressHydrationWarning
    >
      {timeStr}
    </span>
  );
}
