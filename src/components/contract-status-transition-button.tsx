"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { transitionContractStatus } from "@/app/(dashboard)/contracts/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ContractStatus } from "@/lib/contract-status";

type ContractStatusTransitionButtonProps = {
  contractId: string;
  status: ContractStatus;
  label: string;
  variant: "primary" | "danger";
  // 지정 시 버튼 클릭이 바로 전이하지 않고 확인 모달을 먼저 띄운다(계약 취소 등 되돌리기 힘든 전이).
  confirm?: { title: string; description: string };
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
  confirm,
}: ContractStatusTransitionButtonProps) {
  const router = useRouter();
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const runTransition = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await transitionContractStatus(contractId, status);

      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        setOpen(false);
        return;
      }

      setOpen(false);
      setMessage({
        type: "success",
        text: "계약 상태를 변경했습니다.",
      });
      router.refresh();
    });
  };

  return (
    <div className="grid gap-sm">
      <button
        type="button"
        className={getButtonClassName(variant)}
        disabled={isPending}
        onClick={() => {
          if (confirm) {
            setOpen(true);
            return;
          }

          runTransition();
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
      {confirm ? (
        <ConfirmDialog
          open={open}
          title={confirm.title}
          description={confirm.description}
          confirmLabel={label}
          pendingLabel="처리 중"
          isPending={isPending}
          onConfirm={runTransition}
          onCancel={() => {
            if (!isPending) {
              setOpen(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}
