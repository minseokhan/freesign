import { Card } from "@/components/ui/card";

type Feature = {
  title: string;
  description: string;
  icon: React.ReactNode;
};

const iconClass = "size-6 text-brand-primary";

const FEATURES: Feature[] = [
  {
    title: "기록 체인으로 방어",
    description:
      "계약 → 지급기한 → 입금/미수 증빙이 하나의 체인으로 남습니다. 분쟁이나 세무 대응에 필요한 증빙이 끊기지 않아요.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className={iconClass} aria-hidden="true">
        <path
          d="M9 12a3 3 0 0 1 3-3h4a3 3 0 0 1 0 6h-1M15 12a3 3 0 0 1-3 3H8a3 3 0 0 1 0-6h1"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: "AI 계약 초안",
    description:
      "구조화 입력만으로 계약 초안을 생성합니다. 항상 '초안'으로 표시되고, 실패해도 골격 폴백으로 흐름이 끊기지 않아요.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className={iconClass} aria-hidden="true">
        <path
          d="M4 6h16M4 12h10M4 18h7"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    title: "원천징수 자동 계산",
    description:
      "유형만 선택하면 소득세·지방세·실지급액을 자동으로 계산합니다. 참고용 계산 고지도 함께 표시돼요.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className={iconClass} aria-hidden="true">
        <path
          d="M8 7h8M8 12h8M8 17h5M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: "세금 정리 CSV",
    description:
      "연도별로 입금/발행 기준을 명시한 CSV를 한 번에 내보냅니다. 연말 정산과 세무 대리인 전달이 간편해요.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className={iconClass} aria-hidden="true">
        <path
          d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

export function FeatureSection() {
  return (
    <section aria-labelledby="features-heading" className="space-y-2xl">
      <div className="max-w-2xl">
        <h2
          id="features-heading"
          className="text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl"
        >
          프리랜서에게 꼭 필요한 것만
        </h2>
        <p className="mt-md text-sm leading-relaxed text-text-body sm:text-base">
          화려함이 아니라 &ldquo;내 돈이 어디까지 왔나&rdquo;를 3초 안에 읽히게.
          정산에 필요한 기능만 담았습니다.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-lg md:grid-cols-2">
        {FEATURES.map((feature) => (
          <Card key={feature.title} className="flex flex-col gap-md">
            {feature.icon}
            <h3 className="text-lg font-semibold text-text-primary">
              {feature.title}
            </h3>
            <p className="text-sm leading-relaxed text-text-body">
              {feature.description}
            </p>
          </Card>
        ))}
      </div>
    </section>
  );
}
