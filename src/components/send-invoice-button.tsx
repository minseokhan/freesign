"use client";

import { useState, useTransition } from "react";

import { sendInvoice } from "@/app/(dashboard)/invoices/actions";
import { useAnnounceIssuedLink } from "@/components/invoice-issued-link";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type SendInvoiceButtonProps = {
  invoiceId: string;
  recipientEmail: string | null;
  // send: draft 최초 발행·발송 / resend: 이미 발행된 청구서의 링크 재발급·재발송
  mode: "send" | "resend";
};

/**
 * 청구서를 클라이언트에게 발송한다(0046).
 * 취소할 수 없는 외부 발송이므로 수신 주소를 확인 창에 띄운다(오발송 방지).
 */
export function SendInvoiceButton({
  invoiceId,
  recipientEmail,
  mode,
}: SendInvoiceButtonProps) {
  // 발급된 링크는 이 버튼 밖(provider)에서 보여준다 — 발송 직후 revalidatePath가
  // 이 버튼을 다른 카드로 옮겨 재마운트시키기 때문이다.
  const announceIssuedLink = useAnnounceIssuedLink();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const label = mode === "send" ? "청구서 발송" : "청구서 재발송";

  const description = [
    recipientEmail
      ? `${recipientEmail} 으로 청구 금액·지급기한과 청구서 링크가 발송됩니다.`
      : "클라이언트 이메일이 등록되어 있지 않아 메일은 보내지 않고 청구서 링크만 발급합니다. 발급된 링크를 직접 전달해 주세요.",
    mode === "resend"
      ? "새 링크가 발급되므로 이전 링크는 무효화됩니다."
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  function send() {
    setError(null);
    startTransition(async () => {
      const result = await sendInvoice(invoiceId);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setConfirmOpen(false);
      announceIssuedLink({
        url: result.shareUrl,
        emailed: result.emailed,
        recipientEmail,
      });
    });
  }

  return (
    <div className="grid gap-sm">
      <Button
        type="button"
        variant={mode === "send" ? "primary" : "secondary"}
        disabled={isPending}
        onClick={() => {
          setError(null);
          setConfirmOpen(true);
        }}
      >
        {label}
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        title={label}
        description={description}
        confirmLabel="발송"
        pendingLabel="발송 중"
        confirmVariant="primary"
        isPending={isPending}
        error={error}
        onConfirm={send}
        onCancel={() => {
          if (isPending) return;
          setConfirmOpen(false);
          setError(null);
        }}
      />
    </div>
  );
}
