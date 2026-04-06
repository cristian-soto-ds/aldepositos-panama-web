/** Unidad de volumen explícita (evita confusión con m² en pantallas pequeñas). */
export function M3Unit({
  className = "",
  size = "sm",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sup =
    size === "lg"
      ? "text-[0.7em]"
      : size === "md"
        ? "text-[0.68em]"
        : "text-[0.65em]";
  return (
    <span
      className={`whitespace-nowrap font-bold tracking-tight text-slate-600 dark:text-slate-300 ${className}`}
      title="Metros cúbicos (volumen)"
    >
      m<sup className={`${sup} font-extrabold leading-none`}>3</sup>
    </span>
  );
}
