"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteContract } from "@/app/(dashboard)/contracts/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function ContractDeleteButton({ contractId }: { contractId: string }) {
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
        title="계약을 삭제할까요?"
        description="목록에서 사라지며, 발행한 인보이스 기록은 보존됩니다."
        isPending={isPending}
        error={error}
        onConfirm={() => {
          setError(null);
          startTransition(async () => {
            const result = await deleteContract(contractId);

            if (!result.ok) {
              setError(result.error);
              return;
            }

            router.push("/contracts");
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
