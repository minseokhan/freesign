"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  deleteRecurringSchedule,
  setRecurringActive,
} from "@/app/(dashboard)/invoices/recurring/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatKRW } from "@/lib/metrics";

export type RecurringScheduleItem = {
  id: string;
  contractTitle: string;
  clientName: string;
  amount: number;
  netAmount: number;
  intervalKind: "weekly" | "monthly";
  nextRunAt: string;
  active: boolean;
};

const intervalLabel: Record<RecurringScheduleItem["intervalKind"], string> = {
  weekly: "매주",
  monthly: "매월",
};

export function RecurringScheduleList({ schedules }: { schedules: RecurringScheduleItem[] }) {
  if (schedules.length === 0) {
    return (
      <Card>
        <p className="text-sm text-text-muted">조건에 맞는 반복 스케줄이 없습니다.</p>
      </Card>
    );
  }

  return (
    <ul
      aria-label="반복 스케줄"
      className="grid gap-md sm:grid-cols-2 lg:grid-cols-3"
    >
      {schedules.map((schedule) => (
        <RecurringScheduleCard key={schedule.id} schedule={schedule} />
      ))}
    </ul>
  );
}

function RecurringScheduleCard({ schedule }: { schedule: RecurringScheduleItem }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await setRecurringActive(schedule.id, !schedule.active);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteRecurringSchedule(schedule.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <li>
      <Card
        className={
          schedule.active
            ? "flex h-full flex-col gap-lg"
            : "flex h-full flex-col gap-lg opacity-70"
        }
      >
        <div className="min-w-0">
          <Badge variant={schedule.active ? "success" : "neutral"}>
            {schedule.active ? "활성" : "일시중지"}
          </Badge>
          <h3 className="mt-sm break-words text-base font-semibold text-text-primary">
            {schedule.contractTitle}
          </h3>
          <p className="mt-xs text-sm text-text-muted">{schedule.clientName}</p>
        </div>

        <dl className="grid gap-sm text-sm">
          <div className="flex items-baseline justify-between gap-sm">
            <dt className="text-text-muted">청구 금액</dt>
            <dd className="font-semibold tabular-nums text-text-primary">
              {formatKRW(schedule.amount)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-sm">
            <dt className="text-text-muted">실수령</dt>
            <dd className="tabular-nums text-text-body">
              {formatKRW(schedule.netAmount)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-sm">
            <dt className="text-text-muted">주기</dt>
            <dd className="text-text-body">
              {intervalLabel[schedule.intervalKind]}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-sm">
            <dt className="text-text-muted">다음 생성일</dt>
            <dd className="tabular-nums text-text-body">{schedule.nextRunAt}</dd>
          </div>
        </dl>

        {error ? (
          <p className="text-xs text-red-600" role="alert">{error}</p>
        ) : null}

        {/* mt-auto로 카드 높이가 달라도 버튼 줄은 항상 카드 하단에 붙는다. */}
        <div className="mt-auto flex flex-wrap justify-end gap-sm border-t border-surface-border pt-md">
          <Button type="button" variant="secondary" disabled={isPending} onClick={toggle}>
            {schedule.active ? "일시중지" : "재개"}
          </Button>
          <Button
            type="button"
            variant="danger"
            className="bg-red-50 hover:bg-red-100"
            disabled={isPending}
            onClick={() => setConfirmOpen(true)}
          >
            삭제
          </Button>
        </div>
      </Card>
      <ConfirmDialog
        open={confirmOpen}
        title="반복 스케줄을 삭제할까요?"
        description="이후 주기의 인보이스 초안이 더 이상 생성되지 않습니다. 이미 생성된 인보이스는 유지됩니다. 되돌릴 수 없습니다."
        isPending={isPending}
        error={error}
        onConfirm={remove}
        onCancel={() => {
          if (isPending) {
            return;
          }

          setConfirmOpen(false);
          setError(null);
        }}
      />
    </li>
  );
}
