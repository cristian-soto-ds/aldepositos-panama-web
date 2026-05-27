"use client";

import React from "react";
import Image from "next/image";

/** Logo oficial Gemini (PNG en /public/gemini-logo.png). */
export const GEMINI_LOGO_SRC = "/gemini-logo.png";

type GeminiSparkIconProps = {
  /** Tamaño en px (ancho y alto). */
  size?: number;
  className?: string;
  /** Texto alternativo; si se omite, el icono es decorativo. */
  title?: string;
};

export function GeminiSparkIcon({
  size = 20,
  className = "",
  title,
}: GeminiSparkIconProps) {
  const decorative = !title;

  return (
    <Image
      src={GEMINI_LOGO_SRC}
      alt={title ?? ""}
      width={size}
      height={size}
      unoptimized
      className={`shrink-0 object-contain ${className}`.trim()}
      aria-hidden={decorative ? true : undefined}
      title={title}
    />
  );
}
