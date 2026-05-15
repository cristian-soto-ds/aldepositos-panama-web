import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Panel",
  description: "Panel interno: inventario, despachos, órdenes de recolección y reportes.",
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default function PanelLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return children;
}
