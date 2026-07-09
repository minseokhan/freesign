import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
};

/**
 * FreeSign 워드마크. "free"(진한색, currentColor) + "sign"(브랜드 블루) +
 * 하단 물결 밑줄로 구성된 인라인 SVG. 높이는 className으로 제어(예: h-6).
 */
export function Logo({ className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 208 64"
      role="img"
      aria-label="FreeSign"
      className={cn("h-6 w-auto text-text-primary", className)}
    >
      <title>FreeSign</title>
      <text
        x="0"
        y="44"
        fontFamily="Pretendard, sans-serif"
        fontSize="46"
        fontWeight="800"
        letterSpacing="-2"
      >
        <tspan fill="currentColor">free</tspan>
        <tspan fill="#2563eb">sign</tspan>
      </text>
      <path
        d="M6 55 q 24 -11 48 0 t 48 0 t 48 0 t 48 0"
        fill="none"
        stroke="#2563eb"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}
