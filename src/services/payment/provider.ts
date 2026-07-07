import type { Database } from "@/types/database";

export type PaymentStatus = Database["public"]["Enums"]["payment_status"];
export type PaymentAction = "mark_paid" | "mark_unpaid";

export interface PaymentTransition {
  provider: "v1";
  from: PaymentStatus;
  next: PaymentStatus;
  setPaidAt: boolean;
  clearPaidAt: boolean;
  setPaymentMethod: boolean;
  clearPaymentMethod: boolean;
}

export interface PaymentProvider {
  applyTransition(
    current: PaymentStatus,
    action: PaymentAction,
  ): PaymentTransition;
}

export function createV1PaymentProvider(): PaymentProvider {
  return {
    applyTransition(current, action) {
      const transition = V1_PAYMENT_TRANSITIONS[current]?.[action];

      if (!transition) {
        throw new Error(`Payment transition is not allowed: ${current} -> ${action}`);
      }

      return transition;
    },
  };
}

const V1_PAYMENT_TRANSITIONS: Partial<
  Record<PaymentStatus, Partial<Record<PaymentAction, PaymentTransition>>>
> = {
  unpaid: {
    mark_paid: {
      provider: "v1",
      from: "unpaid",
      next: "paid",
      setPaidAt: true,
      clearPaidAt: false,
      setPaymentMethod: true,
      clearPaymentMethod: false,
    },
  },
  paid: {
    mark_unpaid: {
      provider: "v1",
      from: "paid",
      next: "unpaid",
      setPaidAt: false,
      clearPaidAt: true,
      setPaymentMethod: false,
      clearPaymentMethod: true,
    },
  },
};
