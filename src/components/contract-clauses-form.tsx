"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  updateContractClauses,
  type ContractActionResult,
} from "@/app/(dashboard)/contracts/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ContractClauseInput } from "@/lib/validation/contract";

type ContractClausesFormProps = {
  contractId: string;
  clauses: ContractClauseInput[];
};

function hasReviewMarker(clause: ContractClauseInput) {
  return (
    clause.needs_review ||
    clause.body.includes("[검토 필요]") ||
    clause.plain_summary.includes("[검토 필요]")
  );
}

function getFieldError(
  result: ContractActionResult | null,
  field: "clauses",
) {
  if (!result || result.ok) {
    return null;
  }

  return result.fieldErrors?.[field]?.[0] ?? null;
}

export function ContractClausesForm({
  contractId,
  clauses: initialClauses,
}: ContractClausesFormProps) {
  const router = useRouter();
  const [clauses, setClauses] = useState(initialClauses);
  const [result, setResult] = useState<ContractActionResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const clausesError = getFieldError(result, "clauses");

  const updateClause = (
    index: number,
    patch: Partial<ContractClauseInput>,
  ) => {
    setClauses((current) =>
      current.map((clause, clauseIndex) =>
        clauseIndex === index ? { ...clause, ...patch } : clause,
      ),
    );
  };

  const save = () => {
    startTransition(async () => {
      const response = await updateContractClauses(contractId, { clauses });
      setResult(response);

      if (response.ok) {
        router.push(`/contracts/${response.id}`);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-xl">
      <div className="rounded-md border border-amber-200 bg-status-waiting-bg px-md py-sm text-xs leading-relaxed text-amber-800">
        AI 초안이며 법적 자문이 아닙니다. 계약 확정 전 전문가 검토를
        권장합니다.
      </div>

      {result && !result.ok ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-md py-sm text-sm text-red-700">
          {clausesError ?? result.error}
        </p>
      ) : null}

      <div className="space-y-lg">
        {clauses.map((clause, index) => {
          const needsReview = hasReviewMarker(clause);

          return (
            <Card
              key={clause.title}
              className={cn(
                needsReview && "border-amber-200 bg-amber-50/40",
              )}
            >
              <div className="flex flex-col gap-sm border-b border-surface-border pb-lg sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    조항 {index + 1}
                  </p>
                  <h3 className="mt-xs text-lg font-semibold text-text-primary">
                    {clause.title}
                  </h3>
                </div>
                {needsReview ? (
                  <Badge variant="warning">검토 필요</Badge>
                ) : null}
              </div>

              <div className="mt-xl grid gap-lg">
                <div className="grid gap-sm">
                  <label
                    htmlFor={`clause-body-${index}`}
                    className="text-sm font-medium text-text-body"
                  >
                    조항 본문
                  </label>
                  <textarea
                    id={`clause-body-${index}`}
                    rows={6}
                    value={clause.body}
                    onChange={(event) =>
                      updateClause(index, { body: event.target.value })
                    }
                    className="rounded-sm border border-slate-300 bg-white px-md py-sm text-sm leading-relaxed text-text-primary focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30"
                    aria-describedby={
                      needsReview ? `clause-review-${index}` : undefined
                    }
                  />
                </div>

                <div className="grid gap-sm">
                  <label
                    htmlFor={`clause-summary-${index}`}
                    className="text-sm font-medium text-text-body"
                  >
                    평문요약
                  </label>
                  <textarea
                    id={`clause-summary-${index}`}
                    rows={3}
                    value={clause.plain_summary}
                    onChange={(event) =>
                      updateClause(index, {
                        plain_summary: event.target.value,
                      })
                    }
                    className="rounded-sm border border-slate-300 bg-white px-md py-sm text-sm leading-relaxed text-text-primary focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30"
                  />
                </div>

                <label className="flex min-h-11 items-center gap-sm text-sm font-medium text-text-body">
                  <input
                    type="checkbox"
                    checked={clause.needs_review}
                    onChange={(event) =>
                      updateClause(index, {
                        needs_review: event.target.checked,
                      })
                    }
                    className="size-4 rounded border-slate-300 text-brand-primary focus:ring-brand-ring"
                  />
                  검토 필요로 표시
                </label>

                {needsReview ? (
                  <p
                    id={`clause-review-${index}`}
                    className="rounded-md border border-amber-200 bg-status-waiting-bg px-md py-sm text-xs leading-relaxed text-amber-800"
                  >
                    이 조항에 검토 필요 표시가 있습니다. 본문과 요약을 확인한
                    뒤 필요하면 체크를 해제하세요.
                  </p>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-col-reverse gap-sm sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          onClick={() => router.push(`/contracts/${contractId}`)}
        >
          취소
        </Button>
        <Button type="button" disabled={isPending} onClick={save}>
          {isPending ? "저장 중" : "조항 저장"}
        </Button>
      </div>
    </div>
  );
}
