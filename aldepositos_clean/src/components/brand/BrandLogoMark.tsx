import Image from "next/image";
import logoAldepositos from "@/assets/brand/logo-aldepositos.png";

export type BrandLogoMarkProps = {
  variant: "sidebar" | "headerCompact" | "loginHero" | "reportHeader";
  className?: string;
  priority?: boolean;
};

const specs: Record<
  BrandLogoMarkProps["variant"],
  { wrap: string; size: number; img: string; alt: string }
> = {
  sidebar: {
    wrap:
      "mb-3 md:mb-4 inline-flex items-center justify-center rounded-full bg-white p-2 shadow-[0_6px_24px_rgba(0,0,0,0.35)] ring-1 ring-black/[0.06] md:p-2.5",
    size: 120,
    img: "h-11 w-11 md:h-[3.35rem] md:w-[3.35rem] object-contain object-center",
    alt: "Aldepósitos",
  },
  headerCompact: {
    wrap:
      "inline-flex shrink-0 items-center justify-center rounded-full bg-white p-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.3)] ring-1 ring-black/[0.06]",
    size: 80,
    img: "h-8 w-8 object-contain object-center",
    alt: "",
  },
  loginHero: {
    wrap: "relative inline-flex items-center justify-center rounded-full",
    size: 128,
    img: "h-[4.1rem] w-[4.1rem] object-contain object-center [filter:drop-shadow(0_14px_32px_rgba(22,38,63,0.2))]",
    alt: "Aldepósitos",
  },
  reportHeader: {
    wrap:
      "inline-flex shrink-0 items-center justify-center rounded-full bg-white p-1.5 ring-1 ring-slate-200/90 shadow-sm print:shadow-none print:ring-slate-300",
    size: 96,
    img: "h-11 w-11 object-contain object-center print:drop-shadow-none",
    alt: "Aldepósitos",
  },
};

export function BrandLogoMark({
  variant,
  className = "",
  priority,
}: BrandLogoMarkProps) {
  const s = specs[variant];
  return (
    <div
      className={`inline-flex items-center justify-center ${s.wrap} ${className}`.trim()}
    >
      <Image
        src={logoAldepositos}
        alt={s.alt}
        width={s.size}
        height={s.size}
        className={s.img}
        priority={priority}
      />
    </div>
  );
}
