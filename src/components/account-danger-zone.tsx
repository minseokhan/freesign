"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteAccount } from "@/app/(dashboard)/settings/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ACCOUNT_DELETE_CONFIRM_PHRASE } from "@/lib/validation/account";

const DELETED_ITEMS = [
  "프로필과 입금 계좌 정보",
  "클라이언트, 계약, 인보이스와 모든 상태 변경 이력",
  "서명 요청·서명 기록과 업로드한 계약 PDF·서명 이미지",
  "반복 인보이스 설정, 미수금 독촉 초안, AI 계약 인사이트",
] as const;

export function AccountDangerZone({
  hasActiveSubscription,
}: {
  hasActiveSubscription: boolean;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const canDelete = confirm === ACCOUNT_DELETE_CONFIRM_PHRASE;

  function onDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteAccount({ confirm });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      // 세션은 서버에서 이미 끊었다. 캐시된 대시보드가 잠깐 보이지 않도록 교체 이동한다.
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <Card className="space-y-lg border-red-200">
      <div className="space-y-xs">
        <h3 className="text-base font-semibold text-red-600">계정 삭제</h3>
        <p className="text-sm leading-relaxed text-text-body">
          계정과 모든 데이터를 즉시 삭제합니다.{" "}
          <strong>되돌릴 수 없습니다.</strong>
        </p>
      </div>

      <div className="space-y-sm rounded-md bg-surface-muted px-md py-sm">
        <p className="text-sm font-medium text-text-primary">
          삭제되는 데이터
        </p>
        <ul className="list-disc space-y-xs pl-lg text-sm text-text-body">
          {DELETED_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="text-xs text-text-muted">
          전자상거래법에 따라 결제 기록은 개인을 식별할 수 없는 형태로 5년간
          보존됩니다.
        </p>
      </div>

      <p className="text-sm text-text-body">
        삭제하기 전에{" "}
        <Link
          href="/api/account/export"
          className="text-brand-primary underline underline-offset-2"
        >
          내 데이터 내보내기
        </Link>
        로 기록을 먼저 내려받는 것을 권합니다.
      </p>

      {hasActiveSubscription ? (
        <div className="space-y-sm rounded-md border border-status-waiting-fg/30 bg-status-waiting-bg px-md py-sm">
          <p className="text-sm text-text-body">
            유료 구독이 활성 상태입니다. 계정을 먼저 지우면 결제가 계속될 수
            있어, 구독을 해지한 뒤에 삭제할 수 있습니다.
          </p>
          <Link
            href="/billing"
            className="inline-block text-sm font-medium text-brand-primary underline underline-offset-2"
          >
            구독 해지하러 가기
          </Link>
        </div>
      ) : (
        <div className="space-y-md">
          <Input
            label={`확인 문구 — "${ACCOUNT_DELETE_CONFIRM_PHRASE}"를 그대로 입력해 주세요`}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="off"
          />

          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <Button
            variant="danger"
            // 계약·인보이스 삭제 버튼과 같은 형태(연한 붉은 배경)로 맞춘다.
            className="bg-red-50 hover:bg-red-100"
            onClick={onDelete}
            disabled={!canDelete || isPending}
          >
            계정 삭제
          </Button>
        </div>
      )}
    </Card>
  );
}
