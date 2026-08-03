import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
};

/**
 * 매듭 워드마크. 두 고리가 맞물린 심볼(액센트 블루 + currentColor) +
 * "매듭" 글자로 구성된 인라인 SVG. 높이는 className으로 제어(예: h-6).
 *
 * 글자는 폰트에 따라 실제 너비가 달라지므로 textLength로 폭을 고정해
 * 어떤 폴백 폰트에서도 viewBox 밖으로 넘치지 않게 한다.
 */
export function Logo({ className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 116 40"
      role="img"
      aria-label="매듭"
      className={cn("h-6 w-auto text-brand-primary", className)}
    >
      <title>매듭</title>
      <rect
        x="3"
        y="3"
        width="20"
        height="20"
        rx="7"
        fill="none"
        stroke="#4e61f6"
        strokeWidth="5.5"
      />
      <rect
        x="15"
        y="15"
        width="20"
        height="20"
        rx="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="5.5"
      />
      <text
        x="52"
        y="30"
        fill="currentColor"
        fontFamily="Pretendard, sans-serif"
        fontSize="30"
        fontWeight="800"
        letterSpacing="-1"
        textLength="62"
        lengthAdjust="spacingAndGlyphs"
      >
        매듭
      </text>
    </svg>
  );
}
