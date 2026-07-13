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
        description="이 계약과 서명·이력·PDF가 완전히 삭제됩니다. 연결된 인보이스는 유지됩니다. 되돌릴 수 없습니다."
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
