"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Step = {
  key: string;
  label: string;
  title: string;
  description: string;
  preview: React.ReactNode;
};

const STEPS: Step[] = [
  {
    key: "contract",
    label: "계약",
    title: "구조화 입력으로 계약 초안을 빠르게",
    description:
      "클라이언트·금액·기간만 입력하면 AI가 계약 초안을 만들어 줍니다. 초안은 언제든 조항 단위로 편집·확정할 수 있어요.",
    preview: (
      <div className="space-y-md">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text-primary">
            브랜드A 마케팅 대행 계약
          </span>
          <Badge variant="neutral">초안</Badge>
        </div>
        <div className="h-2 w-3/4 rounded-full bg-surface-muted" />
        <div className="h-2 w-full rounded-full bg-surface-muted" />
        <div className="h-2 w-5/6 rounded-full bg-surface-muted" />
        <p className="rounded-md bg-status-waiting-bg px-md py-sm text-xs text-amber-700">
          AI 초안이며 법적 자문이 아닙니다. 전문가 검토를 권장합니다.
        </p>
      </div>
    ),
  },
  {
    key: "sign",
    label: "서명",
    title: "전자 서명으로 계약을 확정",
    description:
      "서명이 완료되면 문서 해시가 기록되어 위·변조를 방지합니다. 계약 상태와 PDF를 한 화면에서 관리하세요.",
    preview: (
      <div className="space-y-md">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text-primary">
            서명 완료
          </span>
          <Badge variant="success">서명됨</Badge>
        </div>
        <div className="flex h-20 items-center justify-center rounded-md border border-dashed border-surface-border-strong text-sm text-text-muted">
          ✍️ 서명 캔버스
        </div>
      </div>
    ),
  },
  {
    key: "invoice",
    label: "청구",
    title: "원천징수까지 자동 계산되는 인보이스",
    description:
      "원천징수 유형을 고르면 소득세·지방세·실지급액이 자동으로 펼쳐집니다. 계좌가 비어 있으면 인라인으로 안내해요.",
    preview: (
      <div className="space-y-sm text-sm">
        <div className="flex justify-between">
          <span className="text-text-muted">공급가액</span>
          <span className="tabular-nums text-text-primary">₩1,000,000</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">원천징수 (3.3%)</span>
          <span className="tabular-nums text-red-600">−₩33,000</span>
        </div>
        <div className="flex justify-between border-t border-surface-border pt-sm font-semibold">
          <span className="text-text-primary">실지급액</span>
          <span className="tabular-nums text-text-primary">₩967,000</span>
        </div>
      </div>
    ),
  },
  {
    key: "payment",
    label: "입금",
    title: "입금 상태를 한 번의 토글로",
    description:
      "입금이 확인되면 토글 한 번으로 즉시 반영됩니다. 미수·지연은 붉은색으로 대시보드에서 바로 눈에 띕니다.",
    preview: (
      <div className="space-y-md">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text-primary">
            2월 인보이스 #024
          </span>
          <Badge variant="success">입금완료</Badge>
        </div>
        <div className="flex items-center justify-between rounded-md bg-status-paid-bg px-md py-sm">
          <span className="text-sm text-green-700">입금 확인</span>
          <span className="tabular-nums text-sm font-semibold text-green-700">
            ₩967,000
          </span>
        </div>
      </div>
    ),
  },
  {
    key: "tax",
    label: "세금",
    title: "연말 세금 정리는 CSV 한 번으로",
    description:
      "입금 기준·발행 기준을 명시한 연도별 CSV를 한 번에 내보냅니다. 증빙 체인이 그대로 남아 세무 대응이 쉬워요.",
    preview: (
      <div className="space-y-sm text-sm">
        <div className="flex items-center justify-between">
          <span className="text-text-muted">2025년 · 입금 기준</span>
          <span className="rounded-md bg-brand-point px-md py-1 text-xs font-medium text-brand-primary">
            CSV 내보내기
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-surface-muted" />
        <div className="h-2 w-2/3 rounded-full bg-surface-muted" />
      </div>
    ),
  },
];

export function FlowWalkthrough() {
  const [active, setActive] = useState(0);
  const activeStep = STEPS[active]!;

  return (
    <div className="space-y-xl">
      <div
        role="tablist"
        aria-label="정산 흐름 단계"
        className="flex flex-wrap items-center gap-sm"
      >
        {STEPS.map((step, index) => {
          const isActive = index === active;
          const isDone = index < active;

          return (
            <button
              key={step.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(index)}
              className={cn(
                "flex min-h-11 items-center gap-sm rounded-full border px-lg py-sm text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2",
                isActive
                  ? "border-brand-primary bg-brand-primary text-white"
                  : "border-surface-border bg-white text-text-muted hover:bg-surface-muted",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-5 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                  isActive
                    ? "bg-white/20 text-white"
                    : isDone
                      ? "bg-status-paid-bg text-green-700"
                      : "bg-surface-muted text-text-muted",
                )}
              >
                {isDone ? "✓" : index + 1}
              </span>
              {step.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-xl md:grid-cols-2 md:items-center">
        <div>
          <h3 className="text-xl font-semibold tracking-tight text-text-primary">
            {activeStep.title}
          </h3>
          <p className="mt-md text-sm leading-relaxed text-text-body">
            {activeStep.description}
          </p>
        </div>
        <Card>{activeStep.preview}</Card>
      </div>
    </div>
  );
}
