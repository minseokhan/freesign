"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  clearDemoData,
  seedDemoData,
} from "@/app/(dashboard)/demo/actions";
import { Button } from "@/components/ui/button";

export function DemoDataButton({ hasDemoData }: { hasDemoData: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="grid gap-sm sm:justify-items-end">
      <Button
        type="button"
        variant={hasDemoData ? "danger" : "primary"}
        disabled={isPending}
        onClick={() => {
          if (hasDemoData) {
            const confirmed = window.confirm(
              "데모 데이터를 지울까요? 실제 계약과 인보이스는 삭제되지 않습니다.",
            );

            if (!confirmed) {
              return;
            }
          }

          setMessage(null);
          startTransition(async () => {
            const result = hasDemoData
              ? await clearDemoData()
              : await seedDemoData();

            if (!result.ok) {
              setMessage(result.error);
              return;
            }

            setMessage(
              hasDemoData
                ? "데모 데이터를 지웠습니다."
                : "데모 데이터를 채웠습니다.",
            );
            router.refresh();
          });
        }}
      >
        {isPending
          ? hasDemoData
            ? "지우는 중"
            : "채우는 중"
          : hasDemoData
            ? "데모 데이터 지우기"
            : "데모 데이터 채우기"}
      </Button>
      {message ? (
        <p
          aria-live="polite"
          className={hasDemoData ? "text-xs text-red-600" : "text-xs text-brand-primary"}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
