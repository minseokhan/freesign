"use client";

import { useEffect, useOptimistic, useState, useTransition } from "react";

import { setInvoicePayment } from "@/app/(dashboard)/invoices/actions";
import { type PaymentStatus } from "@/components/payment-status-badge";
import { Button } from "@/components/ui/button";

type InvoicePaymentToggleProps = {
  invoiceId: string;
  status: PaymentStatus;
};

export function InvoicePaymentToggle({
  invoiceId,
  status,
}: InvoicePaymentToggleProps) {
  const [confirmedStatus, setConfirmedStatus] = useState(status);
  const [paymentMethod, setPaymentMethod] = useState("계좌이체");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [optimisticStatus, setOptimisticStatus] = useOptimistic(
    confirmedStatus,
    (_current, nextStatus: PaymentStatus) => nextStatus,
  );

  useEffect(() => {
    setConfirmedStatus(status);
  }, [status]);

  const nextStatus: PaymentStatus | null =
    optimisticStatus === "unpaid"
      ? "paid"
      : optimisticStatus === "paid"
        ? "unpaid"
        : null;
  const isPaid = optimisticStatus === "paid";

  function submit() {
    if (!nextStatus || isPending) {
      return;
    }

    const previousStatus = confirmedStatus;
    const requestedStatus = nextStatus;

    setMessage(null);
    startTransition(async () => {
      setOptimisticStatus(requestedStatus);

      const result = await setInvoicePayment(invoiceId, requestedStatus, {
        payment_method: paymentMethod,
      });

      if (!result.ok) {
        setConfirmedStatus(previousStatus);
        setMessage({ type: "error", text: result.error });
        return;
      }

      setConfirmedStatus(requestedStatus);
      setMessage({
        type: "success",
        text:
          requestedStatus === "paid"
            ? "입금완료로 변경했습니다."
            : "미수 상태로 되돌렸습니다.",
      });
    });
  }

  return (
    <div className="grid gap-sm sm:justify-items-end">
      <div className="flex flex-wrap items-center justify-end gap-sm">
        {optimisticStatus === "unpaid" ? (
          <label className="sr-only" htmlFor="payment-method">
            입금 방식
          </label>
        ) : null}
        {optimisticStatus === "unpaid" ? (
          <input
            id="payment-method"
            value={paymentMethod}
            onChange={(event) => setPaymentMethod(event.target.value)}
            disabled={isPending}
            className="min-h-11 w-28 rounded-sm border border-surface-border-strong bg-white px-md py-sm text-sm text-text-body focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30 disabled:opacity-50"
          />
        ) : null}
        <Button
          type="button"
          variant={isPaid ? "danger" : "primary"}
          className={isPaid ? "bg-red-50 hover:bg-red-100" : undefined}
          disabled={!nextStatus || isPending}
          onClick={submit}
        >
          {isPending
            ? "변경 중"
            : isPaid
              ? "미수로 되돌리기"
              : "입금완료"}
        </Button>
      </div>
      {message ? (
        <p
          className={
            message.type === "error"
              ? "text-xs text-red-600"
              : "text-xs text-green-700"
          }
          role={message.type === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
