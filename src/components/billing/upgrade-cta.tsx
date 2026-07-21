import { Badge } from "@/components/ui/badge";
import { buttonBaseClass, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Polar checkout/portal은 서버 라우트가 상품·고객을 해석하므로 클라이언트는 링크만 건다.
// 외부 리다이렉트가 필요하므로 next/link가 아닌 전체 내비게이션(<a>)을 쓴다.
export const CHECKOUT_URL = "/api/billing/checkout";
export const PORTAL_URL = "/api/billing/portal";

export function UpgradeButton({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <a
      href={CHECKOUT_URL}
      className={cn(buttonBaseClass, buttonVariants.primary, className)}
    >
      {children ?? "Pro로 업그레이드"}
    </a>
  );
}

export function ManageSubscriptionButton({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <a
      href={PORTAL_URL}
      className={cn(buttonBaseClass, buttonVariants.secondary, className)}
    >
      {children ?? "구독 관리"}
    </a>
  );
}

// Pro 전용 섹션을 무료 사용자에게 대체 노출하는 업셀 카드.
export function UpgradeCard({
  title,
  description,
  className,
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "flex flex-col items-start gap-md border-dashed",
        className,
      )}
    >
      <Badge variant="success">Pro</Badge>
      <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
      <p className="text-sm leading-relaxed text-text-muted">{description}</p>
      <UpgradeButton className="mt-sm" />
    </Card>
  );
}
