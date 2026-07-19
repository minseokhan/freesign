"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  resendSignatureRequestEmail,
  revokeSignatureRequest,
} from "@/app/(dashboard)/contracts/signature-actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type SignatureRequestControlsProps = {
  contractId: string;
};

// sent 계약의 서명 요청 현황 카드 액션: 재발송(신규 토큰 재발급) + 철회(sent→draft).
export function SignatureRequestControls({
  contractId,
}: SignatureRequestControlsProps) {
  const router = useRouter();
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="grid gap-sm">
      <div className="flex flex-wrap gap-sm">
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          onClick={() => {
            setMessage(null);
            startTransition(async () => {
              const result = await resendSignatureRequestEmail({ contractId });

              if (!result.ok) {
                setMessage({ type: "error", text: result.error });
                return;
              }

              setMessage({
                type: "success",
                text: "새 서명 링크로 요청 이메일을 다시 보냈습니다. 이전 링크는 무효화되었습니다.",
              });
              router.refresh();
            });
          }}
        >
          {isPending ? "처리 중" : "재발송"}
        </Button>
        <Button
          type="button"
          variant="danger"
          className="bg-red-50 hover:bg-red-100"
          disabled={isPending}
          onClick={() => {
            setMessage(null);
            setRevokeOpen(true);
          }}
        >
          철회
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
      <ConfirmDialog
        open={revokeOpen}
        title="서명 요청을 철회할까요?"
        description="철회하면 계약이 초안으로 돌아가고, 상대방에게 보낸 서명 링크는 즉시 무효화됩니다."
        confirmLabel="철회"
        pendingLabel="철회 중"
        isPending={isPending}
        error={revokeError}
        onConfirm={() => {
          setRevokeError(null);
          startTransition(async () => {
            const result = await revokeSignatureRequest({ contractId });

            if (!result.ok) {
              setRevokeError(result.error);
              return;
            }

            setRevokeOpen(false);
            router.refresh();
          });
        }}
        onCancel={() => {
          if (isPending) {
            return;
          }

          setRevokeOpen(false);
          setRevokeError(null);
        }}
      />
    </div>
  );
}
