import {
  ManageSubscriptionButton,
  UpgradeButton,
} from "@/components/billing/upgrade-cta";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  CREATE_FREE_LIMIT,
  IMPORT_FREE_LIMIT,
  SIGN_FREE_LIMIT,
  type Plan,
} from "@/lib/plan";
import { cn } from "@/lib/utils";

const FREE_FEATURES = [
  "클라이언트·인보이스 관리 무제한",
  `새 계약 작성 ${CREATE_FREE_LIMIT}건`,
  `서명 요청 발송 ${SIGN_FREE_LIMIT}건`,
  `기존 계약 불러오기(AI 파싱) 누적 ${IMPORT_FREE_LIMIT}회`,
  "미수금·이달 수익 대시보드",
  "계약서·인보이스 PDF 발행",
];

const PRO_FEATURES = [
  "새 계약 작성·서명 요청 무제한",
  "기존 계약 불러오기(AI 파싱) 무제한",
  "반복 인보이스 자동 초안",
  "미수금 자동 독촉 메일 초안",
  "AI 계약 인사이트",
  "채널 수익 TOP·클라이언트별 수익 분석",
  "세금 신고용 Excel 내보내기",
];

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

/**
 * Free / Pro 기능 비교. 현재 플랜 열을 강조하고, 해당 열에만 액션(업그레이드·구독 관리)을 둔다.
 * 금액은 Polar 체크아웃에서 확정되므로 여기서는 노출하지 않는다.
 */
export function PlanComparison({ plan }: { plan: Plan }) {
  const isPro = plan === "pro";

  return (
    <div className="grid gap-lg md:grid-cols-2">
      <Card
        className={cn(
          "flex flex-col gap-lg",
          isPro ? "border-dashed" : "border-blue-200 ring-1 ring-blue-200",
        )}
      >
        <div className="flex items-center gap-sm">
          <h4 className="text-base font-semibold text-text-primary">Free</h4>
          {isPro ? null : <Badge variant="neutral">현재 플랜</Badge>}
        </div>
        <p className="text-sm leading-relaxed text-text-muted">
          계약 한 건으로 서명부터 청구까지 흐름을 그대로 확인해 볼 수 있어요.
        </p>
        <FeatureList features={FREE_FEATURES} />
      </Card>

      <Card
        className={cn(
          "flex flex-col gap-lg",
          isPro
            ? "border-blue-200 ring-1 ring-blue-200"
            : "border-surface-border",
        )}
      >
        <div className="flex items-center gap-sm">
          <h4 className="text-base font-semibold text-text-primary">Pro</h4>
          {isPro ? <Badge variant="success">현재 플랜</Badge> : null}
        </div>
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
