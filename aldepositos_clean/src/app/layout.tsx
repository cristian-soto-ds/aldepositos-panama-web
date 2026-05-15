import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AldePositos Zona Libre Panamá",
    template: "%s · AldePositos",
  },
  description: "Sistema de gestión logística para la zona libre de Panamá.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-PA">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
