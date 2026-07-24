"use client";

import React, { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import type { Task } from "@/lib/types/task";
import { PhotoRecordPcModule } from "./PhotoRecordPcModule";
import { PhotoRecordMobileModule } from "./PhotoRecordMobileModule";

type PhotoMode = "pc" | "mobile";

type PhotoRecordModuleProps = {
  tasks: Task[];
  onUpdateTask: (task: Task) => void | Promise<void>;
  userEmail?: string | null;
  userDisplayName?: string | null;
};

export function PhotoRecordModule({
  tasks,
  onUpdateTask,
  userEmail,
  userDisplayName,
}: PhotoRecordModuleProps) {
  const [mode, setMode] = useState<PhotoMode>("pc");

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900 sm:px-4">
        <div className="mx-auto flex max-w-4xl items-center gap-2">
          <p className="mr-auto hidden text-[10px] font-black uppercase tracking-widest text-slate-400 sm:block">
            Registro fotográfico
          </p>
          <div className="flex w-full gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800 sm:w-auto">
            <button
              type="button"
              onClick={() => setMode("pc")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition sm:flex-none ${
                mode === "pc"
                  ? "bg-white text-[#16263F] shadow-sm dark:bg-slate-950 dark:text-slate-100"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              <Monitor className="h-4 w-4" />
              PC
            </button>
            <button
              type="button"
              onClick={() => setMode("mobile")}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[10px] font-black uppercase tracking-widest transition sm:flex-none ${
                mode === "mobile"
                  ? "bg-white text-[#16263F] shadow-sm dark:bg-slate-950 dark:text-slate-100"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              <Smartphone className="h-4 w-4" />
              Celular
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === "pc" ? (
          <PhotoRecordPcModule tasks={tasks} onUpdateTask={onUpdateTask} />
        ) : (
          <PhotoRecordMobileModule
            tasks={tasks}
            onUpdateTask={onUpdateTask}
            userEmail={userEmail}
            userDisplayName={userDisplayName}
          />
        )}
      </div>
    </div>
  );
}
