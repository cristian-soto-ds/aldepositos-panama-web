"use client";

import { TruckDirectionModule } from "@/components/truck-direction/TruckDirectionModule";

/** Ruta dedicada del operador. URL: /direccion-camiones */
export default function TruckDirectionPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-[var(--panel-bg-subtle)]">
      <TruckDirectionModule />
    </div>
  );
}
