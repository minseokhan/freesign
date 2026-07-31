import { PlanBadge } from "@/components/billing/plan-badge";
import { PlanComparison } from "@/components/billing/plan-comparison";
import { ProFeatureShowcase } from "@/components/billing/pro-feature-showcase";
import { ScrollHint } from "@/components/billing/scroll-hint";
import { Card } from "@/components/ui/card";
import { getUserPlan } from "@/lib/plan";

// 결제 진입(/api/billing/checkout·portal)이 되돌려 보낼 때 보여줄 안내.
const PORTAL_ERRORS: Record<string, string> = {
  no_customer:
    "결제 고객 정보가 아직 연결되지 않아 구독 관리를 열 수 없어요. 결제 직후라면 잠시 뒤 다시 시도해 주세요.",
  portal_failed:
    "구독 관리 페이지를 여는 데 실패했어요. 잠시 뒤 다시 시도하고, 계속 안 되면 문의해 주세요.",
  // 미구성은 사용자 잘못도 장애도 아니라 오류 대신 상태로 알린다.
  not_configured:
    "아직 결제 기능을 준비하고 있어요. 준비가 끝나면 이 화면에서 바로 업그레이드할 수 있습니다.",
};

type BillingPageProps = {
  searchParams?: Promise<{ portal?: string }>;
};

export default async function BillingPage({ searchParams }: BillingPageProps) {
  const [plan, resolvedSearchParams] = await Promise.all([
    getUserPlan(),
    searchParams,
  ]);
  const portalError = resolvedSearchParams?.portal
    ? PORTAL_ERRORS[resolvedSearchParams.portal]
    : undefined;
  const isNotice = resolvedSearchParams?.portal === "not_configured";

  return (
    <div className="mx-auto max-w-3xl space-y-2xl">
      <div>
        <div className="flex items-center gap-sm">
          <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
            요금제
          </h2>
          <PlanBadge plan={plan} />
        </div>
        <p className="mt-xs text-sm leading-relaxed text-text-muted">
          지금 쓰고 있는 플랜과 Pro에서 열리는 기능을 비교해 보세요.
        </p>
      </div>

      {portalError ? (
        <Card
          role={isNotice ? "status" : "alert"}
          className={
            isNotice
              ? "border-blue-200 bg-brand-point"
              : "border-red-200 bg-status-overdue-bg"
          }
        >
          <p
            className={
              isNotice
                ? "text-sm leading-relaxed text-brand-primary"
                : "text-sm leading-relaxed text-red-700"
            }
          >
            {portalError}
          </p>
        </Card>
      ) : null}

      <PlanComparison plan={plan} />

      <ScrollHint />

      <ProFeatureShowcase />
    </div>
  );
}
