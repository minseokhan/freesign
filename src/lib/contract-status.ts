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
  sent: ["signed", "draft", "canceled"],
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
): ContractStatus[] {
  return (forwardTransitions[from] ?? []).filter(
    (status) => status !== "signed" && status !== "sent",
  );
}
