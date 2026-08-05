/** Identidad y modelos de AldeGpt (OpenAI Responses). */

export const ALDEGPT_TERRA_DISPLAY_NAME = "AldeGpt Terra";
export const ALDEGPT_SOL_DISPLAY_NAME = "AldeGpt Sol";

/** Claves de producto (UI / request). Terra es siempre el base por defecto. */
export type AldeGptModelKey = "terra" | "sol";

export const ALDEGPT_DEFAULT_MODEL: AldeGptModelKey = "terra";

export type AldeGptModelOption = {
  key: AldeGptModelKey;
  /** ID OpenAI Responses */
  apiModel: string;
  label: string;
  shortLabel: string;
  hint: string;
};

export const ALDEGPT_MODEL_OPTIONS: AldeGptModelOption[] = [
  {
    key: "terra",
    apiModel: "gpt-5.6-terra",
    label: ALDEGPT_TERRA_DISPLAY_NAME,
    shortLabel: "Terra",
    hint: "Modelo base · uso diario y extracción estándar",
  },
  {
    key: "sol",
    apiModel: "gpt-5.6-sol",
    label: ALDEGPT_SOL_DISPLAY_NAME,
    shortLabel: "Sol",
    hint: "Documentos difíciles · más razonamiento (máximo)",
  },
];

export function resolveAldeGptModelKey(raw: unknown): AldeGptModelKey {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "sol" || v === "gpt-5.6-sol" || v === "5.6-sol") {
    return "sol";
  }
  return "terra";
}

export function aldeGptModelOption(key: AldeGptModelKey): AldeGptModelOption {
  return (
    ALDEGPT_MODEL_OPTIONS.find((o) => o.key === key) ?? ALDEGPT_MODEL_OPTIONS[0]!
  );
}

export function aldeGptDisplayNameForModel(key: AldeGptModelKey): string {
  return aldeGptModelOption(key).label;
}
