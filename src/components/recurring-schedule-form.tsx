"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createRecurringSchedule } from "@/app/(dashboard)/invoices/recurring/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type ContractOption = { id: string; title: string };

const fieldClass =
  "min-h-11 rounded-sm border border-surface-border-strong bg-white px-md py-sm text-sm text-text-body focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30 disabled:opacity-50";
const labelClass =
  "text-xs font-medium uppercase tracking-wide text-text-muted";

export function RecurringScheduleForm({ contracts }: { contracts: ContractOption[] }) {
  const router = useRouter();
  const [contractId, setContractId] = useState(contracts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [withholdingType, setWithholdingType] = useState("wt_3_3");
  const [intervalKind, setIntervalKind] = useState("monthly");
  const [nextRunAt, setNextRunAt] = useState("");
  const [dueOffsetDays, setDueOffsetDays] = useState("14");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (isPending) return;
    setMessage(null);
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
        setMessage({ type: "error", text: result.error });
        return;
      }

      setAmount("");
      setNextRunAt("");
      setMessage({ type: "success", text: "반복 스케줄을 만들었습니다." });
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
      <h3 className="text-lg font-semibold text-text-primary">새 반복 스케줄</h3>
      <p className="mt-xs text-sm leading-relaxed text-text-muted">
        매 주기마다 인보이스 초안이 자동 생성됩니다. 초안은 검토 후 직접 발행해야 청구가 시작됩니다.
      </p>

      <div className="mt-lg grid gap-md sm:grid-cols-2">
        <div className="grid gap-xs sm:col-span-2">
          <label htmlFor="rec-contract" className={labelClass}>계약</label>
          <select id="rec-contract" value={contractId} disabled={isPending} onChange={(e) => setContractId(e.target.value)} className={fieldClass}>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-xs">
          <label htmlFor="rec-amount" className={labelClass}>청구 금액(원)</label>
          <input id="rec-amount" type="number" min={1} value={amount} disabled={isPending} onChange={(e) => setAmount(e.target.value)} className={fieldClass} />
        </div>

        <div className="grid gap-xs">
          <label htmlFor="rec-withholding" className={labelClass}>원천징수</label>
          <select id="rec-withholding" value={withholdingType} disabled={isPending} onChange={(e) => setWithholdingType(e.target.value)} className={fieldClass}>
            <option value="wt_3_3">3.3%</option>
            <option value="wt_8_8">8.8%</option>
            <option value="none">없음</option>
          </select>
        </div>

        <div className="grid gap-xs">
          <label htmlFor="rec-interval" className={labelClass}>주기</label>
          <select id="rec-interval" value={intervalKind} disabled={isPending} onChange={(e) => setIntervalKind(e.target.value)} className={fieldClass}>
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

      {message ? (
        <p className={message.type === "error" ? "mt-md text-xs text-red-600" : "mt-md text-xs text-green-700"} role={message.type === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}

      <div className="mt-lg">
        <Button type="button" disabled={isPending || !contractId || !amount || !nextRunAt} onClick={submit}>
          {isPending ? "만드는 중" : "반복 스케줄 만들기"}
        </Button>
      </div>
    </Card>
  );
}
