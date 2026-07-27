"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { createRecurringSchedule } from "@/app/(dashboard)/invoices/recurring/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatKRW } from "@/lib/metrics";
import { calcWithholding, type WithholdingType } from "@/lib/tax";

type ContractOption = { id: string; title: string };

const fieldClass =
  "min-h-11 rounded-sm border border-surface-border-strong bg-white px-md py-sm text-sm text-text-body focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30 disabled:opacity-50";
// select-caret(globals.css)이 네이티브 화살표를 대체하고, pr-2xl로 화살표 자리를 비운다.
const selectClass = `${fieldClass} select-caret pr-2xl`;
const labelClass =
  "text-xs font-medium uppercase tracking-wide text-text-muted";

export function RecurringScheduleForm({ contracts }: { contracts: ContractOption[] }) {
  const router = useRouter();
  const [contractId, setContractId] = useState(contracts[0]?.id ?? "");
  const [amount, setAmount] = useState("0");
  const [withholdingType, setWithholdingType] = useState("wt_3_3");
  const [intervalKind, setIntervalKind] = useState("monthly");
  const [nextRunAt, setNextRunAt] = useState("");
  const [dueOffsetDays, setDueOffsetDays] = useState("14");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 인보이스 발행 폼과 동일한 참고용 계산 — 저장되는 스냅샷은 Server Action이 다시 계산한다.
  // 금액이 비어 있어도 계산기를 숨기지 않고 0원으로 보여준다(calcWithholding은 양수만 받음).
  const preview = useMemo(() => {
    const parsedAmount = Number.parseInt(amount, 10);

    if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) {
      return { amount: 0, withholding: 0, net: 0 };
    }

    try {
      const { withholding, net } = calcWithholding(
        parsedAmount,
        withholdingType as WithholdingType,
      );

      return { amount: parsedAmount, withholding, net };
    } catch {
      return { amount: 0, withholding: 0, net: 0 };
    }
  }, [amount, withholdingType]);

  // 0원·빈 금액은 서버가 거부하므로(amount > 0 CHECK) 제출을 미리 잠근다.
  const canSubmit = Boolean(contractId) && preview.amount > 0 && Boolean(nextRunAt);

  function submit() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await createRecurringSchedule({
        contract_id: contractId,
        amount,
        withholding_type: withholdingType,
        interval_kind: intervalKind,
        next_run_at: nextRunAt,
        due_offset_days: dueOffsetDays,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      router.push("/invoices/recurring");
      router.refresh();
    });
  }

  if (contracts.length === 0) {
    return (
      <Card>
        <p className="text-sm text-text-muted">
          반복 인보이스를 만들려면 먼저 계약이 필요합니다.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <p className="text-sm leading-relaxed text-text-muted">
        매 주기마다 인보이스 초안이 자동 생성됩니다. 초안은 검토 후 직접 발행해야 청구가 시작됩니다.
      </p>

      <div className="mt-lg grid gap-md sm:grid-cols-2">
        <div className="grid gap-xs sm:col-span-2">
          <label htmlFor="rec-contract" className={labelClass}>계약</label>
          <select id="rec-contract" value={contractId} disabled={isPending} onChange={(e) => setContractId(e.target.value)} className={selectClass}>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-xs sm:col-span-2">
          <label htmlFor="rec-amount" className={labelClass}>청구 금액(원)</label>
          <input id="rec-amount" type="number" min={1} value={amount} disabled={isPending} onChange={(e) => setAmount(e.target.value)} className={fieldClass} />
        </div>

        <div className="grid gap-xs">
          <label htmlFor="rec-withholding" className={labelClass}>원천징수</label>
          <select id="rec-withholding" value={withholdingType} disabled={isPending} onChange={(e) => setWithholdingType(e.target.value)} className={selectClass}>
            <option value="wt_3_3">3.3%</option>
            <option value="wt_8_8">8.8%</option>
            <option value="none">없음</option>
          </select>
        </div>

        <div className="grid gap-xs">
          <label htmlFor="rec-interval" className={labelClass}>주기</label>
          <select id="rec-interval" value={intervalKind} disabled={isPending} onChange={(e) => setIntervalKind(e.target.value)} className={selectClass}>
            <option value="monthly">매월</option>
            <option value="weekly">매주</option>
          </select>
        </div>

        <div className="grid gap-xs">
          <label htmlFor="rec-next" className={labelClass}>다음 생성일</label>
          <input id="rec-next" type="date" value={nextRunAt} disabled={isPending} onChange={(e) => setNextRunAt(e.target.value)} className={fieldClass} />
        </div>

        <div className="grid gap-xs">
          <label htmlFor="rec-due" className={labelClass}>지급기한(생성일로부터 일수)</label>
          <input id="rec-due" type="number" min={0} value={dueOffsetDays} disabled={isPending} onChange={(e) => setDueOffsetDays(e.target.value)} className={fieldClass} />
        </div>
      </div>

      <div
        role="group"
        aria-labelledby="rec-preview-title"
        className="mt-lg rounded-md border border-surface-border bg-surface-muted p-lg"
      >
        <p id="rec-preview-title" className={labelClass}>미리보기</p>
        <dl className="mt-md grid gap-md sm:grid-cols-3">
          <div>
            <dt className="text-xs text-text-muted">청구 금액</dt>
            <dd className="mt-xs font-semibold tabular-nums text-text-primary">
              {formatKRW(preview.amount)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">원천징수</dt>
            <dd className="mt-xs font-semibold tabular-nums text-text-primary">
              {formatKRW(preview.withholding)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">실수령액</dt>
            <dd className="mt-xs font-semibold tabular-nums text-text-primary">
              {formatKRW(preview.net)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-md rounded-md border border-amber-200 bg-status-waiting-bg px-md py-sm text-xs leading-relaxed text-amber-800">
        원천징수 계산은 참고용입니다. 저장되는 금액 스냅샷은 서버에서 다시 계산되어
        스케줄 생성 시점 기준으로 고정되고, 매 주기 초안에 그대로 복사됩니다.
      </div>

      {error ? (
        <p className="mt-md text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-lg flex flex-col-reverse gap-sm border-t border-surface-border pt-lg sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          onClick={() => router.back()}
        >
          취소
        </Button>
        <Button
          type="button"
          disabled={isPending || !canSubmit}
          onClick={submit}
        >
          {isPending ? "만드는 중" : "만들기"}
        </Button>
      </div>
    </Card>
  );
}
