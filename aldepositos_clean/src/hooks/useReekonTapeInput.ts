"use client";

import { useCallback, useRef } from "react";

type DimensionField = "l" | "w" | "h";

const DIMENSION_ORDER: DimensionField[] = ["l", "w", "h"];

/**
 * Avance L → W → H al pulsar Enter (modo teclado de la REEKON T1).
 * Opcional: vibración breve al confirmar medida.
 */
export function useReekonTapeInput() {
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const vibrate = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(30);
    }
  }, []);

  const flashInput = useCallback((el: HTMLInputElement) => {
    el.classList.remove("reekon-flash");
    void el.offsetWidth;
    el.classList.add("reekon-flash");
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => {
      el.classList.remove("reekon-flash");
    }, 400);
  }, []);

  const handleDimensionKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLInputElement>,
      field: DimensionField,
      rowContainer: HTMLElement | null,
      onRowComplete?: () => void,
    ) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      vibrate();
      flashInput(e.currentTarget);

      const idx = DIMENSION_ORDER.indexOf(field);
      const nextField = DIMENSION_ORDER[idx + 1];

      if (nextField && rowContainer) {
        const next = rowContainer.querySelector<HTMLInputElement>(
          `input[data-reekon-field="${nextField}"]`,
        );
        if (next) {
          next.focus();
          next.select();
          return;
        }
      }

      onRowComplete?.();
    },
    [flashInput, vibrate],
  );

  const focusFirstDimension = useCallback((rowContainer: HTMLElement | null) => {
    if (!rowContainer) return;
    const first = rowContainer.querySelector<HTMLInputElement>(
      'input[data-reekon-field="l"]',
    );
    if (first) {
      first.focus();
      first.select();
    }
  }, []);

  return { handleDimensionKeyDown, focusFirstDimension, vibrate, flashInput };
}
