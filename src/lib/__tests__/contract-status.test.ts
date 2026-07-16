import { describe, expect, it } from "vitest";

import {
  canTransitionContractStatus,
  getAvailableContractStatusTransitions,
  getContractStatusTransition,
  type ContractStatus,
} from "@/lib/contract-status";

// TODO(signature-v2-step1): remove this cast after database types include "sent".
const sent = "sent" as ContractStatus;

describe("contract status transitions", () => {
  it("allows the forward contract lifecycle transitions", () => {
    expect(canTransitionContractStatus("draft", "signed")).toBe(true);
    expect(canTransitionContractStatus("draft", sent)).toBe(true);
    expect(canTransitionContractStatus("signed", "active")).toBe(true);
    expect(canTransitionContractStatus("active", "done")).toBe(true);
  });

  it("allows signature request transitions from sent only to signed, draft, or canceled", () => {
    expect(canTransitionContractStatus(sent, "signed")).toBe(true);
    expect(canTransitionContractStatus(sent, "draft")).toBe(true);
    expect(canTransitionContractStatus(sent, "canceled")).toBe(true);
    expect(canTransitionContractStatus(sent, "active")).toBe(false);
    expect(canTransitionContractStatus("active", sent)).toBe(false);
  });

  it("rejects skipped, repeated, and terminal transitions", () => {
    expect(canTransitionContractStatus("draft", "done")).toBe(false);
    expect(canTransitionContractStatus("signed", "done")).toBe(false);
    expect(canTransitionContractStatus("active", "active")).toBe(false);
    expect(canTransitionContractStatus("done", "draft")).toBe(false);
    expect(canTransitionContractStatus("done", "canceled")).toBe(false);
  });

  it("allows cancelation before done only", () => {
    expect(canTransitionContractStatus("draft", "canceled")).toBe(true);
    expect(canTransitionContractStatus("signed", "canceled")).toBe(true);
    expect(canTransitionContractStatus("active", "canceled")).toBe(true);
    expect(canTransitionContractStatus("done", "canceled")).toBe(false);
    expect(canTransitionContractStatus("canceled", "draft")).toBe(false);
  });

  it("allows draft rollback only before work starts and resets signature artifacts", () => {
    expect(getContractStatusTransition("signed", "draft")).toEqual({
      allowed: true,
      resetSignatureArtifacts: true,
    });
    // 진행 시작(active) 이후에는 초안으로 되돌릴 수 없다.
    expect(getContractStatusTransition("active", "draft")).toEqual({
      allowed: false,
      resetSignatureArtifacts: false,
    });
    expect(getContractStatusTransition("draft", "signed")).toEqual({
      allowed: true,
      resetSignatureArtifacts: false,
    });
  });

  it("blocks draft rollback when counterparty signature evidence exists", () => {
    expect(
      getContractStatusTransition("signed", "draft", {
        hasCounterpartySignature: true,
      }),
    ).toEqual({
      allowed: false,
      resetSignatureArtifacts: false,
    });
    expect(
      getContractStatusTransition(sent, "draft", {
        hasCounterpartySignature: true,
      }),
    ).toEqual({
      allowed: false,
      resetSignatureArtifacts: false,
    });
    expect(
      getContractStatusTransition("signed", "draft", {
        hasCounterpartySignature: false,
      }),
    ).toEqual({
      allowed: true,
      resetSignatureArtifacts: true,
    });
  });

  it("resets owner signature artifacts when revoking a sent request back to draft", () => {
    expect(getContractStatusTransition(sent, "draft")).toEqual({
      allowed: true,
      resetSignatureArtifacts: true,
    });
  });

  it("does not expose sent or signed entry transitions in user-selectable transitions", () => {
    expect(getAvailableContractStatusTransitions("draft")).toEqual([
      "canceled",
    ]);
    expect(getAvailableContractStatusTransitions(sent)).toEqual([
      "draft",
      "canceled",
    ]);
  });
});
