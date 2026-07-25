"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { publishDraftInvoice } from "@/app/(dashboard)/invoices/actions";
import { Button } from "@/components/ui/button";

// 반복 인보이스가 만든 draft를 소유자가 검토 후 발행(draft→unpaid)한다.
export function PublishDraftButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function publish() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await publishDraftInvoice(invoiceId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="grid gap-xs">
      <Button type="button" disabled={isPending} onClick={publish}>
        {isPending ? "발행 중" : "이 초안 발행"}
      </Button>
      {error ? (
        <p className="text-xs text-red-600" role="alert">{error}</p>
      ) : null}
    </div>
  );
}
