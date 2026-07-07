import { describe, expect, it } from "vitest";

import {
  canTransitionContractStatus,
  getContractStatusTransition,
} from "@/lib/contract-status";

describe("contract status transitions", () => {
  it("allows the forward contract lifecycle transitions", () => {
    expect(canTransitionContractStatus("draft", "signed")).toBe(true);
    expect(canTransitionContractStatus("signed", "active")).toBe(true);
    expect(canTransitionContractStatus("active", "done")).toBe(true);
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

  it("marks draft rollback transitions as requiring signature artifact reset", () => {
    expect(getContractStatusTransition("signed", "draft")).toEqual({
      allowed: true,
      resetSignatureArtifacts: true,
    });
    expect(getContractStatusTransition("active", "draft")).toEqual({
      allowed: true,
      resetSignatureArtifacts: true,
    });
    expect(getContractStatusTransition("draft", "signed")).toEqual({
      allowed: true,
      resetSignatureArtifacts: false,
    });
  });
});
