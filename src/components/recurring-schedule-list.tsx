"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  deleteRecurringSchedule,
  setRecurringActive,
} from "@/app/(dashboard)/invoices/recurring/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
        <p className="text-sm text-text-muted">아직 만든 반복 스케줄이 없습니다.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-md">
      {schedules.map((schedule) => (
        <RecurringScheduleRow key={schedule.id} schedule={schedule} />
      ))}
    </div>
  );
}

function RecurringScheduleRow({ schedule }: { schedule: RecurringScheduleItem }) {
  const router = useRouter();
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
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteRecurringSchedule(schedule.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card className={schedule.active ? undefined : "opacity-70"}>
      <div className="flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-sm">
            <h3 className="break-words text-base font-semibold text-text-primary">
              {schedule.contractTitle}
            </h3>
            <span
              className={
                schedule.active
                  ? "rounded-full bg-green-100 px-sm py-0.5 text-xs font-medium text-green-800"
                  : "rounded-full bg-surface-muted px-sm py-0.5 text-xs font-medium text-text-muted"
              }
            >
              {schedule.active ? "활성" : "일시중지"}
            </span>
          </div>
          <p className="mt-xs text-sm text-text-muted">{schedule.clientName}</p>
          <dl className="mt-md grid gap-x-lg gap-y-xs text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-sm sm:justify-start">
              <dt className="text-text-muted">청구 금액</dt>
              <dd className="tabular-nums text-text-body">{formatKRW(schedule.amount)}</dd>
            </div>
            <div className="flex justify-between gap-sm sm:justify-start">
              <dt className="text-text-muted">실수령</dt>
              <dd className="tabular-nums text-text-body">{formatKRW(schedule.netAmount)}</dd>
            </div>
            <div className="flex justify-between gap-sm sm:justify-start">
              <dt className="text-text-muted">주기</dt>
              <dd className="text-text-body">{intervalLabel[schedule.intervalKind]}</dd>
            </div>
            <div className="flex justify-between gap-sm sm:justify-start">
              <dt className="text-text-muted">다음 생성일</dt>
              <dd className="tabular-nums text-text-body">{schedule.nextRunAt}</dd>
            </div>
          </dl>
        </div>
        <div className="flex shrink-0 flex-wrap gap-sm">
          <Button type="button" variant="secondary" disabled={isPending} onClick={toggle}>
            {schedule.active ? "일시중지" : "재개"}
          </Button>
          <Button type="button" variant="danger" disabled={isPending} onClick={remove}>
            삭제
          </Button>
        </div>
      </div>
      {error ? (
        <p className="mt-md text-xs text-red-600" role="alert">{error}</p>
      ) : null}
    </Card>
  );
}
