"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteContract } from "@/app/(dashboard)/contracts/actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function ContractDeleteButton({
  contractId,
  blocked = false,
}: {
  contractId: string;
  // 맞서명이 완료돼 삭제 불가한 계약. 모달을 삭제 확인이 아니라 '삭제 불가 안내'로 연다.
  blocked?: boolean;
}) {
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
      {blocked ? (
        <ConfirmDialog
          open={open}
          title="삭제할 수 없는 계약입니다"
          description="맞서명이 완료된 계약은 삭제할 수 없습니다. 계약을 무효화하려면 '다음 단계'의 '계약 취소'를 사용하세요. 연결된 인보이스와 증빙 체인은 그대로 유지됩니다."
          confirmOnly
          confirmLabel="확인"
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      ) : (
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
      )}
    </>
  );
}
