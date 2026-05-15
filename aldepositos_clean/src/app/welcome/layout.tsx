import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Bienvenida",
  description: "Redirección al panel de AldePositos.",
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default function WelcomeLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return children;
}
