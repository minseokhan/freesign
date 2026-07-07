import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

export type ContractStatus = Database["public"]["Enums"]["contract_status"];

export const CONTRACT_STATUSES = [
  "draft",
  "signed",
  "active",
  "done",
  "canceled",
] as const satisfies readonly ContractStatus[];

export const CONTRACT_STATUS_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "draft", label: "초안" },
  { value: "signed", label: "서명완료" },
  { value: "active", label: "진행중" },
  { value: "done", label: "완료" },
  { value: "canceled", label: "취소" },
] as const;

type ContractStatusMeta = {
  label: string;
  variant: BadgeVariant;
  className: string;
};

const contractStatusMeta: Record<ContractStatus, ContractStatusMeta> = {
  draft: {
    label: "초안",
    variant: "neutral",
    className: "bg-status-neutral-bg text-slate-600",
  },
  signed: {
    label: "서명완료",
    variant: "warning",
    className: "bg-status-waiting-bg text-amber-700",
  },
  active: {
    label: "진행중",
    variant: "warning",
    className: "bg-status-waiting-bg text-amber-700",
  },
  done: {
    label: "완료",
    variant: "success",
    className: "bg-status-paid-bg text-green-700",
  },
  canceled: {
    label: "취소",
    variant: "neutral",
    className: "bg-status-neutral-bg text-slate-600",
  },
};

export function getContractStatusMeta(status: string): ContractStatusMeta {
  if (status in contractStatusMeta) {
    return contractStatusMeta[status as ContractStatus];
  }

  return contractStatusMeta.draft;
}

export function ContractStatusBadge({ status }: { status: string }) {
  const meta = getContractStatusMeta(status);

  return (
    <Badge
      variant={meta.variant}
      className={cn("whitespace-nowrap", meta.className)}
    >
      {meta.label}
    </Badge>
  );
}
