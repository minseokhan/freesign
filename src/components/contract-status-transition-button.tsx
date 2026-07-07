"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { transitionContractStatus } from "@/app/(dashboard)/contracts/actions";
import type { ContractStatus } from "@/lib/contract-status";

type ContractStatusTransitionButtonProps = {
  contractId: string;
  status: ContractStatus;
  label: string;
  variant: "primary" | "danger";
};

function getButtonClassName(
  variant: ContractStatusTransitionButtonProps["variant"],
) {
  if (variant === "danger") {
    return "inline-flex min-h-11 items-center justify-center rounded-md border border-surface-border bg-white px-lg py-sm text-sm font-medium text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";
  }

  return "inline-flex min-h-11 items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";
}

export function ContractStatusTransitionButton({
  contractId,
  status,
  label,
  variant,
}: ContractStatusTransitionButtonProps) {
  const router = useRouter();
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="grid gap-sm">
      <button
        type="button"
        className={getButtonClassName(variant)}
        disabled={isPending}
        onClick={() => {
          setMessage(null);
          startTransition(async () => {
            const result = await transitionContractStatus(contractId, status);

            if (!result.ok) {
              setMessage({ type: "error", text: result.error });
              return;
            }

            setMessage({
              type: "success",
              text: "계약 상태를 변경했습니다.",
            });
            router.refresh();
          });
        }}
      >
        {isPending ? "변경 중" : label}
      </button>
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
