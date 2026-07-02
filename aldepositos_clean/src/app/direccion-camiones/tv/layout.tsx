import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Recepción de camiones — Pantalla TV | ALDEPÓSITOS",
  description: "Visualización en tiempo real de fila y rampas de recepción",
};

export default function TruckDirectionTvLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
