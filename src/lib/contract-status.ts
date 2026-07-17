import type { Database } from "@/types/database";

export type ContractStatus = Database["public"]["Enums"]["contract_status"];

export type ContractStatusTransition = {
  allowed: boolean;
  resetSignatureArtifacts: boolean;
};

export type ContractStatusTransitionContext = {
  hasCounterpartySignature?: boolean;
};

export const CONTRACT_STATUSES = [
  "draft",
  "sent",
  "signed",
  "active",
  "done",
  "canceled",
] as const satisfies readonly ContractStatus[];

const forwardTransitions: Partial<Record<ContractStatus, ContractStatus[]>> = {
  draft: ["signed", "sent", "canceled"],
  // sent→draft는 일반 전이가 아니라 철회 RPC(요청 revoke + 아티팩트 리셋) 전용.
  sent: ["signed", "canceled"],
  signed: ["active", "draft", "canceled"],
  active: ["done", "canceled"],
};

export function getContractStatusTransition(
  from: ContractStatus,
  to: ContractStatus,
  ctx: ContractStatusTransitionContext = {},
): ContractStatusTransition {
  const allowed =
    (forwardTransitions[from]?.includes(to) ?? false) &&
    !(to === "draft" && ctx.hasCounterpartySignature === true);

  return {
    allowed,
    resetSignatureArtifacts: allowed && to === "draft",
  };
}

export function canTransitionContractStatus(
  from: ContractStatus,
  to: ContractStatus,
  ctx?: ContractStatusTransitionContext,
): boolean {
  return getContractStatusTransition(from, to, ctx).allowed;
}

export function getAvailableContractStatusTransitions(
  from: ContractStatus,
  ctx: ContractStatusTransitionContext = {},
): ContractStatus[] {
  return (forwardTransitions[from] ?? []).filter(
    (status) =>
      status !== "signed" &&
      status !== "sent" &&
      // 맞서명 완료 계약은 초안 복귀 불가(0019 DB 가드와 동일) — 버튼도 숨긴다.
      !(status === "draft" && ctx.hasCounterpartySignature === true),
  );
}
