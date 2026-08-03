import {
  ManageSubscriptionButton,
  UpgradeButton,
} from "@/components/billing/upgrade-cta";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatKRW } from "@/lib/metrics";
import type { Plan } from "@/lib/plan";
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

function FeatureList({ features }: { features: readonly string[] }) {
  return (
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
  );
}

function PriceLine({ price }: { price: number }) {
  return (
    <p className="flex items-baseline gap-xs">
      <span className="text-2xl font-bold tracking-tight text-text-primary tabular-nums">
        {formatKRW(price)}
      </span>
      <span className="text-sm text-text-muted">/ 월</span>
    </p>
  );
}

/**
 * Free / Pro 기능 비교. 현재 플랜 열을 강조하고, 해당 열에만 액션(업그레이드·구독 관리)을 둔다.
 * 표시 금액은 랜딩과 같은 상수(plan-features.ts)를 쓰고, 실제 청구는 Polar 체크아웃에서 확정된다.
 */
export function PlanComparison({ plan }: { plan: Plan }) {
  const isPro = plan === "pro";

  return (
    <div className="grid gap-lg md:grid-cols-2">
      <Card
        className={cn(
          "flex flex-col gap-lg",
          isPro ? "border-dashed" : "border-brand-primary/20 ring-1 ring-brand-primary/20",
        )}
      >
        <div className="flex items-center gap-sm">
          <h4 className="text-base font-semibold text-text-primary">Free</h4>
          {isPro ? null : <Badge variant="neutral">현재 플랜</Badge>}
        </div>
        <PriceLine price={0} />
        <p className="text-sm leading-relaxed text-text-muted">
          계약 한 건으로 서명부터 청구까지 흐름을 그대로 확인해 볼 수 있어요.
        </p>
        <FeatureList features={FREE_FEATURES} />
      </Card>

      <Card
        className={cn(
          "flex flex-col gap-lg",
          isPro
            ? "border-brand-primary/20 ring-1 ring-brand-primary/20"
            : "border-surface-border",
        )}
      >
        <div className="flex items-center gap-sm">
          <h4 className="text-base font-semibold text-text-primary">Pro</h4>
          {isPro ? <Badge variant="success">현재 플랜</Badge> : null}
        </div>
        <PriceLine price={PRO_PRICE_KRW} />
        <p className="text-sm leading-relaxed text-text-muted">
          Free의 모든 기능에 더해, 반복 청구와 미수금 회수까지 자동으로
          굴러가요.
        </p>
        <FeatureList features={PRO_FEATURES} />
        <div className="mt-auto pt-sm">
          {isPro ? (
            <ManageSubscriptionButton className="w-full" />
          ) : (
            <UpgradeButton className="w-full" />
          )}
        </div>
      </Card>
    </div>
  );
}
