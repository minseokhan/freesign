"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteClient } from "@/app/(dashboard)/clients/actions";
import { Button } from "@/components/ui/button";

export function ClientDeleteButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="grid gap-sm sm:justify-items-end">
      <Button
        type="button"
        variant="danger"
        disabled={isPending}
        onClick={() => {
          const confirmed = window.confirm(
            "이 클라이언트를 삭제할까요? 계약과 인보이스 기록은 보존됩니다."
          );

          if (!confirmed) {
            return;
          }

          setError(null);
          startTransition(async () => {
            const result = await deleteClient(clientId);

            if (!result.ok) {
              setError(result.error);
              return;
            }

            router.push("/clients");
            router.refresh();
          });
        }}
      >
        {isPending ? "삭제 중" : "삭제"}
      </Button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
