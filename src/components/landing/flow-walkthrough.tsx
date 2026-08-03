"use client";

import { useRef, useState } from "react";

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

// 손글씨 서명 궤적. pathLength=1 정규화로 stroke-dashoffset 1→0 그리기 애니메이션에 사용.
const SIGNATURE_PATH =
  "M6 42 C 18 8 30 8 34 36 C 37 56 47 54 53 30 C 58 10 68 12 72 36 C 76 56 86 52 94 28 C 100 10 112 14 116 38 C 120 56 132 54 144 32 C 154 14 172 12 196 26";

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
          <span className="inline-block animate-flow-pop [animation-delay:1.5s]">
            <Badge variant="neutral">초안</Badge>
          </span>
        </div>
        <div className="flex items-center gap-sm text-xs text-text-muted">
          <span className="flex gap-1" aria-hidden="true">
            <span className="size-1.5 animate-flow-typing rounded-full bg-brand-primary" />
            <span className="size-1.5 animate-flow-typing rounded-full bg-brand-primary [animation-delay:0.2s]" />
            <span className="size-1.5 animate-flow-typing rounded-full bg-brand-primary [animation-delay:0.4s]" />
          </span>
          AI가 조항을 작성하고 있어요
        </div>
        <div className="space-y-sm">
          <p className="animate-flow-rise text-xs leading-relaxed text-text-body [animation-delay:0.2s]">
            <span className="font-semibold text-text-primary">
              제1조 (업무 범위)
            </span>{" "}
            브랜드A의 SNS 채널 콘텐츠 기획·제작을 수행한다.
          </p>
          <p className="animate-flow-rise text-xs leading-relaxed text-text-body [animation-delay:0.7s]">
            <span className="font-semibold text-text-primary">
              제2조 (대금)
            </span>{" "}
            총 3,000,000원을 인보이스 지급기한까지 입금한다.
          </p>
          <p className="animate-flow-rise text-xs leading-relaxed text-text-body [animation-delay:1.2s]">
            <span className="font-semibold text-text-primary">
              제3조 (기간)
            </span>{" "}
            2026-07-01부터 2026-07-21까지 유효하다.
            <span className="ml-0.5 inline-block animate-flow-caret font-semibold text-brand-primary">
              ▍
            </span>
          </p>
        </div>
        <p className="animate-flow-rise rounded-md bg-status-waiting-bg px-md py-sm text-xs text-amber-700 [animation-delay:1.7s]">
          AI 초안이며 법적 자문이 아닙니다. 전문가 검토를 권장합니다.
        </p>
      </div>
    ),
  },
  {
    key: "sign",
    label: "서명",
    title: "전자 서명으로 계약을 매듭짓기",
    description:
      "서명이 완료되면 계약이 매듭지어지고, 문서 해시가 기록되어 위·변조를 방지합니다. 계약 상태와 PDF를 한 화면에서 관리하세요.",
    preview: (
      <div className="space-y-md">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text-primary">
            서명 진행 중
          </span>
          <span className="inline-block animate-flow-pop [animation-delay:1.9s]">
            <Badge variant="success">서명됨</Badge>
          </span>
        </div>
        <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-surface-border-strong bg-surface-page px-lg">
          <svg
            viewBox="0 0 208 60"
            className="h-16 w-full"
            fill="none"
            role="img"
            aria-label="실시간으로 그려지는 서명"
          >
            <path
              d={SIGNATURE_PATH}
              pathLength={1}
              stroke="#2b3587"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-flow-draw [stroke-dasharray:1]"
            />
            <circle r={3.5} fill="#2b3587" aria-hidden="true">
              <animateMotion
                dur="2.4s"
                repeatCount="indefinite"
                calcMode="linear"
                keyPoints="0;1;1"
                keyTimes="0;0.7;1"
                path={SIGNATURE_PATH}
              />
            </circle>
          </svg>
        </div>
        <div className="flex animate-flow-rise items-center gap-xs text-xs text-text-muted [animation-delay:2s]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="size-3.5 text-brand-primary"
            aria-hidden="true"
          >
            <path
              d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          문서 해시{" "}
          <span className="font-mono text-text-body">3f9a…c21</span> 기록됨
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
      <div className="space-y-md">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text-primary">
            인보이스 #024
          </span>
          <span className="inline-block animate-flow-pop [animation-delay:0.6s]">
            <Badge variant="neutral">자동 계산</Badge>
          </span>
        </div>
        <div className="space-y-sm text-sm">
          <div className="flex animate-flow-rise justify-between [animation-delay:0.1s]">
            <span className="text-text-muted">공급가액</span>
            <span className="tabular-nums text-text-primary">₩1,000,000</span>
          </div>
          <div className="flex animate-flow-rise justify-between [animation-delay:0.3s]">
            <span className="text-text-muted">원천징수 (3.3%)</span>
            <span className="tabular-nums text-red-600">−₩33,000</span>
          </div>
          <div className="flex animate-flow-rise justify-between border-t border-surface-border pt-sm font-semibold [animation-delay:0.5s]">
            <span className="text-text-primary">실지급액</span>
            <span className="tabular-nums text-text-primary">₩967,000</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    key: "payment",
    label: "입금",
    title: "미수·지연은 붉게, 입금은 토글 한 번으로",
    description:
      "미수·지연 인보이스는 대시보드에서 붉은색으로 바로 눈에 띄고, 입금이 확인되면 토글 한 번으로 즉시 반영됩니다.",
    preview: (
      <div className="space-y-sm">
        <div className="flex animate-flow-rise items-center justify-between rounded-md bg-status-overdue-bg px-md py-sm [animation-delay:0.1s]">
          <div className="flex items-center gap-sm">
            <Badge variant="danger">지연</Badge>
            <span className="text-sm text-text-primary">1월 인보이스 #018</span>
          </div>
          <span className="tabular-nums text-sm font-semibold text-red-700">
            ₩1,200,000
          </span>
        </div>
        <div className="flex animate-flow-rise items-center justify-between rounded-md bg-status-paid-bg px-md py-sm [animation-delay:0.3s]">
          <div className="flex items-center gap-sm">
            <Badge variant="success">입금완료</Badge>
            <span className="text-sm text-text-primary">2월 인보이스 #024</span>
          </div>
          <span
            className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-green-500 px-0.5"
            aria-hidden="true"
          >
            <span className="size-4 animate-flow-toggle rounded-full bg-white shadow-sm" />
          </span>
        </div>
        <div className="flex animate-flow-rise items-center justify-between border-t border-surface-border pt-sm [animation-delay:0.5s]">
          <span className="text-xs text-text-muted">미수금 합계</span>
          <span className="tabular-nums text-sm font-semibold text-red-700">
            ₩1,200,000
          </span>
        </div>
      </div>
    ),
  },
  {
    key: "tax",
    label: "세금",
    title: "연말 세금 정리는 엑셀 한 번으로",
    description:
      "입금 기준·발행 기준을 명시한 연도별 엑셀 파일을 한 번에 내보냅니다. 증빙 체인이 그대로 남아 세무 대응이 쉬워요.",
    preview: (
      <div className="space-y-md">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-text-primary">
            2025년 · 입금 기준
          </span>
          <span className="inline-flex animate-flow-pop items-center gap-1 rounded-md bg-brand-point px-md py-1 text-xs font-medium text-brand-primary [animation-delay:0.8s]">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="size-3.5"
              aria-hidden="true"
            >
              <path
                d="M12 3v10m0 0 3.5-3.5M12 13 8.5 9.5M5 17v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Excel 내보내기
          </span>
        </div>
        <div className="space-y-sm text-sm">
          <div className="flex animate-flow-rise justify-between [animation-delay:0.1s]">
            <span className="text-text-muted">총 청구액</span>
            <span className="tabular-nums text-text-primary">₩5,000,000</span>
          </div>
          <div className="flex animate-flow-rise justify-between [animation-delay:0.3s]">
            <span className="text-text-muted">원천징수 합계</span>
            <span className="tabular-nums text-red-600">−₩165,000</span>
          </div>
          <div className="flex animate-flow-rise items-center justify-between border-t border-surface-border pt-sm [animation-delay:0.5s]">
            <span className="font-semibold text-text-primary">실지급액</span>
            <span className="tabular-nums text-lg font-bold text-green-700">
              ₩4,835,000
            </span>
          </div>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
          <div className="h-full animate-flow-fill rounded-full bg-brand-primary [animation-delay:0.6s]" />
        </div>
      </div>
    ),
  },
];

export function FlowWalkthrough() {
  const [active, setActive] = useState(0);
  const activeStep = STEPS[active]!;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function focusTab(index: number) {
    setActive(index);
    tabRefs.current[index]?.focus();
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const last = STEPS.length - 1;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        focusTab(active === last ? 0 : active + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        focusTab(active === 0 ? last : active - 1);
        break;
      case "Home":
        event.preventDefault();
        focusTab(0);
        break;
      case "End":
        event.preventDefault();
        focusTab(last);
        break;
    }
  }

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
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`flow-tab-${step.key}`}
              aria-selected={isActive}
              aria-controls={`flow-panel-${step.key}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={handleTabKeyDown}
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

      <div
        role="tabpanel"
        id={`flow-panel-${activeStep.key}`}
        aria-labelledby={`flow-tab-${activeStep.key}`}
        tabIndex={0}
        className="grid gap-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2 md:grid-cols-2 md:items-start"
      >
        <div>
          <h3 className="text-xl font-semibold tracking-tight text-text-primary">
            {activeStep.title}
          </h3>
          <p className="mt-md text-sm leading-relaxed text-text-body">
            {activeStep.description}
          </p>
        </div>
        <Card key={activeStep.key}>{activeStep.preview}</Card>
      </div>
    </div>
  );
}
