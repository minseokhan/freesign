import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatKRW } from "@/lib/metrics";
import {
  FREE_FEATURES,
  PRO_FEATURES,
  PRO_PRICE_KRW,
} from "@/lib/plan-features";
import { cn } from "@/lib/utils";

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary"
    >
      <path
        d="M4 10.5 8 14.5 16 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlanCard({
  name,
  price,
  caption,
  features,
  highlighted,
}: {
  name: string;
  price: number;
  caption: string;
  features: readonly string[];
  highlighted: boolean;
}) {
  return (
    <Card
      className={cn(
        "flex flex-col gap-lg",
        highlighted ? "border-blue-200 ring-1 ring-blue-200" : undefined,
      )}
    >
      <div className="flex items-center gap-sm">
        <h3 className="text-base font-semibold text-text-primary">{name}</h3>
        {highlighted ? <Badge variant="success">추천</Badge> : null}
      </div>

      <p className="flex items-baseline gap-xs">
        <span className="text-3xl font-bold tracking-tight text-text-primary tabular-nums">
          {formatKRW(price)}
        </span>
        <span className="text-sm text-text-muted">/ 월</span>
      </p>

      <p className="text-sm leading-relaxed text-text-muted">{caption}</p>

      <ul className="space-y-sm">
        {features.map((feature) => (
          <li
            key={feature}
            className="flex items-start gap-sm text-sm leading-relaxed text-text-body"
          >
            <CheckIcon />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * 공개 랜딩용 요금제 비교. 앱 내부 `/billing`과 같은 목록(plan-features.ts)을 쓴다.
 * 카드 안에는 CTA를 두지 않는다(시작·결제는 히어로와 하단 CTA에서만).
 */
export function PricingSection() {
  return (
    <section
      id="pricing"
      aria-labelledby="pricing-heading"
      className="space-y-2xl scroll-mt-16"
    >
      <div className="max-w-2xl">
        <h2
          id="pricing-heading"
          className="text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl"
        >
          요금제
        </h2>
        <p className="mt-md text-sm leading-relaxed text-text-body sm:text-base">
          카드 없이 Free로 시작해 계약 한 건을 서명까지 끝내 보고, 청구가
          반복되기 시작하면 그때 Pro로 올리세요.
        </p>
      </div>

      <div className="grid gap-lg md:grid-cols-2">
        <PlanCard
          name="Free"
          price={0}
          caption="계약 한 건으로 서명부터 청구까지 흐름을 그대로 확인해 볼 수 있어요."
          features={FREE_FEATURES}
          highlighted={false}
        />
        <PlanCard
          name="Pro"
          price={PRO_PRICE_KRW}
          caption="Free의 모든 기능에 더해, 반복 청구와 미수금 회수까지 자동으로 굴러가요."
          features={PRO_FEATURES}
          highlighted
        />
      </div>

      <p className="text-xs text-text-muted">
        Pro 결제는 로그인 후 요금제 화면에서 진행하며, 언제든 해지할 수 있어요.
        해지해도 지금까지의 계약·입금 기록은 그대로 남습니다.
      </p>
    </section>
  );
}
