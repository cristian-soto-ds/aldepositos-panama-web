import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* En carpetas sincronizadas (p. ej. OneDrive), reactCompiler en dev puede colgar el servidor. */
  reactCompiler: process.env.NODE_ENV === "production",
};

export default nextConfig;
