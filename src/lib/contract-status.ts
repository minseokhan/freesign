import type { Database } from "@/types/database";

export type ContractStatus = Database["public"]["Enums"]["contract_status"];

export type ContractStatusTransition = {
  allowed: boolean;
  resetSignatureArtifacts: boolean;
};

export const CONTRACT_STATUSES = [
  "draft",
  "signed",
  "active",
  "done",
  "canceled",
] as const satisfies readonly ContractStatus[];

const forwardTransitions: Partial<Record<ContractStatus, ContractStatus[]>> = {
  draft: ["signed", "canceled"],
  signed: ["active", "draft", "canceled"],
  active: ["done", "draft", "canceled"],
};

export function getContractStatusTransition(
  from: ContractStatus,
  to: ContractStatus,
): ContractStatusTransition {
  const allowed = forwardTransitions[from]?.includes(to) ?? false;

  return {
    allowed,
    resetSignatureArtifacts: allowed && to === "draft",
  };
}

export function canTransitionContractStatus(
  from: ContractStatus,
  to: ContractStatus,
): boolean {
  return getContractStatusTransition(from, to).allowed;
}

export function getAvailableContractStatusTransitions(
  from: ContractStatus,
): ContractStatus[] {
  return forwardTransitions[from] ?? [];
}
