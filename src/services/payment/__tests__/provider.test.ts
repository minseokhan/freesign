import { describe, expect, it, vi } from "vitest";

import {
  createV1PaymentProvider,
  type PaymentStatus,
} from "@/services/payment/provider";
import { Constants, type Database } from "@/types/database";

type DatabasePaymentStatus = Database["public"]["Enums"]["payment_status"];

describe("V1PaymentProvider.applyTransition", () => {
  it("marks an unpaid invoice as paid without generating server field values", () => {
    const provider = createV1PaymentProvider();

    expect(provider.applyTransition("unpaid", "mark_paid")).toEqual({
      provider: "v1",
      from: "unpaid",
      next: "paid",
      setPaidAt: true,
      clearPaidAt: false,
      setPaymentMethod: true,
      clearPaymentMethod: false,
    });
  });

  it("allows reverting a paid invoice to unpaid and clears payment server fields", () => {
    const provider = createV1PaymentProvider();

    expect(provider.applyTransition("paid", "mark_unpaid")).toEqual({
      provider: "v1",
      from: "paid",
      next: "unpaid",
      setPaidAt: false,
      clearPaidAt: true,
      setPaymentMethod: false,
      clearPaymentMethod: true,
    });
  });

  it.each([
    ["paid", "mark_paid"],
    ["unpaid", "mark_unpaid"],
    ["draft", "mark_paid"],
    ["draft", "mark_unpaid"],
  ] as const)("rejects %s --%s--> as an undefined transition", (current, action) => {
    const provider = createV1PaymentProvider();

    expect(() => provider.applyTransition(current, action)).toThrow(
      `Payment transition is not allowed: ${current} -> ${action}`,
    );
  });

  it("is pure and deterministic for the same current status and action", () => {
    const provider = createV1PaymentProvider();
    const first = provider.applyTransition("unpaid", "mark_paid");

    expect(provider.applyTransition("unpaid", "mark_paid")).toEqual(first);
    expect(provider.applyTransition("unpaid", "mark_paid")).toEqual(first);
  });

  it("does not call Date or Date.now while calculating a transition", () => {
    const provider = createV1PaymentProvider();
    const DateStub = vi.fn(() => {
      throw new Error("Date must be injected by the Server Action");
    });

    vi.stubGlobal("Date", Object.assign(DateStub, { now: DateStub }));

    expect(provider.applyTransition("unpaid", "mark_paid")).toMatchObject({
      next: "paid",
      setPaidAt: true,
    });

    expect(DateStub).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("matches the generated database payment_status enum and excludes overdue", () => {
    const databaseStatuses = Constants.public.Enums.payment_status;
    const provider = createV1PaymentProvider();
    const returnedStatuses: PaymentStatus[] = [
      provider.applyTransition("unpaid", "mark_paid").next,
      provider.applyTransition("paid", "mark_unpaid").next,
    ];

    expect(databaseStatuses).toEqual(["draft", "unpaid", "paid"]);
    expect(databaseStatuses).not.toContain("overdue");
    expect(returnedStatuses.every((status) => databaseStatuses.includes(status))).toBe(
      true,
    );

    const typedStatus: DatabasePaymentStatus = returnedStatuses[0];
    expect(typedStatus).toBe("paid");
  });
});
