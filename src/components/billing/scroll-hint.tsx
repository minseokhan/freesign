/**
 * 요금제 카드와 Pro 기능 미리보기 사이의 "아래도 보세요" 힌트.
 * 배경에 녹아드는 그라데이션 셰브론이며, 클릭하면 미리보기 섹션으로 이동한다
 * (모션은 prefers-reduced-motion에서 멈춘다).
 */
export function ScrollHint() {
  return (
    <div className="flex justify-center" aria-hidden="true">
      <a
        href="#pro-features"
        tabIndex={-1}
        className="group relative flex h-14 w-24 items-center justify-center"
      >
        <svg
          viewBox="0 0 48 30"
          fill="none"
          className="h-8 w-12 opacity-80 transition-opacity duration-300 group-hover:opacity-100 motion-safe:animate-bounce"
        >
          <defs>
            {/* 바깥(위)에서 화살표 머리(아래)로 갈수록 진해진다 */}
            <linearGradient id="scroll-hint-fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2b3587" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#2b3587" stopOpacity="0.75" />
            </linearGradient>
          </defs>
          <path
            d="M10 8 L24 20 L38 8"
            stroke="url(#scroll-hint-fade)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M14 18 L24 27 L34 18"
            stroke="url(#scroll-hint-fade)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.5"
          />
        </svg>
      </a>
    </div>
  );
}
