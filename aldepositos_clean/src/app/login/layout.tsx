import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Iniciar sesión",
  description: "Acceso al panel operativo de AldePositos (zona libre, Panamá).",
};

export default function LoginLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return children;
}
