"use client";

import React from "react";
import { AI_ASSISTANT_DISPLAY_NAME } from "@/lib/aiAssistantBrand";
import { GeminiSparkIcon } from "@/components/ui/GeminiSparkIcon";

type AldeIaBrandProps = {
  iconSize?: number;
  showLabel?: boolean;
  labelClassName?: string;
  className?: string;
};

/** Logo Gemini + nombre «Alde.IA» para botones y cabeceras. */
export function AldeIaBrand({
  iconSize = 20,
  showLabel = true,
  labelClassName = "",
  className = "",
}: AldeIaBrandProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`.trim()}>
      <GeminiSparkIcon size={iconSize} />
      {showLabel ? (
        <span className={labelClassName}>{AI_ASSISTANT_DISPLAY_NAME}</span>
      ) : null}
    </span>
  );
}
