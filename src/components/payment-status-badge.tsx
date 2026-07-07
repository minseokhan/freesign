import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

export type PaymentStatus = Database["public"]["Enums"]["payment_status"];

export const PAYMENT_STATUSES = [
  "draft",
  "unpaid",
  "paid",
] as const satisfies readonly PaymentStatus[];

export const PAYMENT_STATUS_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "draft", label: "초안" },
  { value: "unpaid", label: "미수" },
  { value: "paid", label: "입금완료" },
] as const;

type PaymentStatusMeta = {
  label: string;
  variant: BadgeVariant;
  className: string;
};

const paymentStatusMeta: Record<PaymentStatus, PaymentStatusMeta> = {
  draft: {
    label: "초안",
    variant: "neutral",
    className: "bg-status-neutral-bg text-slate-600",
  },
  unpaid: {
    label: "미수",
    variant: "warning",
    className: "bg-status-waiting-bg text-amber-700",
  },
  paid: {
    label: "입금완료",
    variant: "success",
    className: "bg-status-paid-bg text-green-700",
  },
};

const overdueMeta: PaymentStatusMeta = {
  label: "지연",
  variant: "danger",
  className: "bg-status-overdue-bg text-red-700",
};

export function getPaymentStatusMeta(
  status: string,
  overdue = false,
): PaymentStatusMeta {
  if (overdue && status === "unpaid") {
    return overdueMeta;
  }

  if (status in paymentStatusMeta) {
    return paymentStatusMeta[status as PaymentStatus];
  }

  return paymentStatusMeta.draft;
}

export function PaymentStatusBadge({
  status,
  overdue = false,
}: {
  status: string;
  overdue?: boolean;
}) {
  const meta = getPaymentStatusMeta(status, overdue);

  return (
    <Badge
      variant={meta.variant}
      className={cn("whitespace-nowrap", meta.className)}
    >
      {meta.label}
    </Badge>
  );
}
