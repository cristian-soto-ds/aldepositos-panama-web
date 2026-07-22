"use client";

import React from "react";
import Image from "next/image";
import { ALDEGPT_TERRA_DISPLAY_NAME } from "@/lib/aldeGptTerraBrand";

/** Logo OpenAI (PNG en /public/aldegpt-terra-logo.png). */
export const ALDEGPT_TERRA_LOGO_SRC = "/aldegpt-terra-logo.png";

type AldeGptTerraIconProps = {
  /** Tamaño en px (ancho y alto). */
  size?: number;
  className?: string;
  /** Texto alternativo; si se omite, el icono es decorativo. */
  title?: string;
};

export function AldeGptTerraIcon({
  size = 20,
  className = "",
  title,
}: AldeGptTerraIconProps) {
  const decorative = !title;

  return (
    <Image
      src={ALDEGPT_TERRA_LOGO_SRC}
      alt={title ?? ""}
      width={size}
      height={size}
      unoptimized
      className={`shrink-0 object-contain dark:invert ${className}`.trim()}
      aria-hidden={decorative ? true : undefined}
      title={title}
    />
  );
}

type AldeGptTerraBrandProps = {
  iconSize?: number;
  showLabel?: boolean;
  labelClassName?: string;
  className?: string;
};

/** Logo OpenAI + nombre «AldeGpt Terra» para botones y cabeceras. */
export function AldeGptTerraBrand({
  iconSize = 20,
  showLabel = true,
  labelClassName = "",
  className = "",
}: AldeGptTerraBrandProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`.trim()}>
      <AldeGptTerraIcon size={iconSize} />
      {showLabel ? (
        <span className={labelClassName}>{ALDEGPT_TERRA_DISPLAY_NAME}</span>
      ) : null}
    </span>
  );
}
