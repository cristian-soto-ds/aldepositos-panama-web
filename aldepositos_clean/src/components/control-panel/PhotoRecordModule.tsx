"use client";

import React from "react";
import { Camera } from "lucide-react";
import type { Task } from "@/lib/types/task";

type PhotoRecordModuleProps = {
  tasks: Task[];
  onUpdateTask: (task: Task) => void | Promise<void>;
  userEmail?: string | null;
  userDisplayName?: string | null;
};

export function PhotoRecordModule(_props: PhotoRecordModuleProps) {
  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(37,99,235,0.08),_transparent_55%),radial-gradient(ellipse_at_bottom,_rgba(22,38,63,0.06),_transparent_50%)] dark:bg-[radial-gradient(ellipse_at_top,_rgba(59,130,246,0.12),_transparent_55%),radial-gradient(ellipse_at_bottom,_rgba(15,23,42,0.35),_transparent_50%)]"
        aria-hidden
      />

      <div className="relative flex h-full min-h-0 flex-1 flex-col items-center justify-center px-6 py-10 text-center sm:px-10">
        <div className="mb-8 inline-flex h-20 w-20 items-center justify-center rounded-3xl border border-slate-200/80 bg-white/90 shadow-[0_18px_50px_-28px_rgba(22,38,63,0.55)] dark:border-slate-700 dark:bg-slate-900/80">
          <Camera
            className="h-9 w-9 text-[#16263F] dark:text-slate-100"
            strokeWidth={1.75}
            aria-hidden
          />
        </div>

        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-400 dark:text-slate-500">
          Registro fotográfico
        </p>

        <h2 className="max-w-3xl text-4xl font-black tracking-tight text-[#16263F] dark:text-slate-50 sm:text-5xl md:text-6xl md:leading-[1.05]">
          Módulo en desarrollo
        </h2>

        <p className="mt-5 max-w-lg text-base font-medium leading-relaxed text-slate-500 dark:text-slate-400 sm:text-lg">
          Esta sección estará disponible pronto. Mientras tanto, el resto del
          panel de AlDepósitos sigue operativo con normalidad.
        </p>

        <div className="mt-10 h-px w-24 bg-gradient-to-r from-transparent via-slate-300 to-transparent dark:via-slate-600" />
      </div>
    </div>
  );
}
