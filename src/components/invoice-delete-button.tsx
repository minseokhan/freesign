"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteInvoice } from "@/app/(dashboard)/invoices/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function InvoiceDeleteButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        type="button"
        variant="danger"
        className="bg-red-50 hover:bg-red-100"
        onClick={() => setOpen(true)}
      >
        삭제
      </Button>
      <ConfirmDialog
        open={open}
        title="인보이스를 삭제할까요?"
        description="목록에서 사라지며, 이 작업은 되돌릴 수 없습니다."
        isPending={isPending}
        error={error}
        onConfirm={() => {
          setError(null);
          startTransition(async () => {
            const result = await deleteInvoice(invoiceId);

            if (!result.ok) {
              setError(result.error);
              return;
            }

            router.push("/invoices");
            router.refresh();
          });
        }}
        onCancel={() => {
          if (isPending) {
            return;
          }

          setOpen(false);
          setError(null);
        }}
      />
    </>
  );
}
