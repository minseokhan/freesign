"use client";

import { useState, useTransition } from "react";

import {
  approveAndSendDunning,
  dismissDunning,
} from "@/app/(dashboard)/invoices/dunning-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type DunningReviewPanelProps = {
  reminderId: string;
  draftSubject: string;
  draftBody: string;
  aiSource: string | null;
};

// 연체 인보이스의 미검토 독촉 초안을 소유자가 검토·수정 후 승인(클라이언트 발송)/무시하는 패널.
// 크론이 만든 초안이며 자동 발송되지 않는다는 점을 명시한다.
export function DunningReviewPanel({
  reminderId,
  draftSubject,
  draftBody,
  aiSource,
}: DunningReviewPanelProps) {
  const [subject, setSubject] = useState(draftSubject);
  const [body, setBody] = useState(draftBody);
  const [resolved, setResolved] = useState<"sent" | "dismissed" | null>(null);
  const [message, setMessage] = useState<{ type: "error"; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  if (resolved === "sent") {
    return (
      <Card className="border-green-200 bg-green-50">
        <p className="text-sm font-medium text-green-800">
          독촉 메일을 클라이언트에게 보냈습니다.
        </p>
      </Card>
    );
  }

  if (resolved === "dismissed") {
    return (
      <Card className="border-surface-border bg-surface-muted">
        <p className="text-sm text-text-muted">독촉 초안을 무시했습니다.</p>
      </Card>
    );
  }

  function approve() {
    if (isPending) return;
    setMessage(null);
    startTransition(async () => {
      const result = await approveAndSendDunning(reminderId, subject, body);
      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setResolved("sent");
    });
  }

  function dismiss() {
    if (isPending) return;
    setMessage(null);
    startTransition(async () => {
      const result = await dismissDunning(reminderId);
      if (!result.ok) {
        setMessage({ type: "error", text: result.error });
        return;
      }
      setResolved("dismissed");
    });
  }

  return (
    <Card className="border-amber-200 bg-status-waiting-bg">
      <div className="border-b border-amber-200 pb-lg">
        <div className="flex flex-wrap items-center gap-sm">
          <h3 className="text-lg font-semibold text-text-primary">
            독촉 초안 검토
          </h3>
          <span className="rounded-full bg-amber-100 px-sm py-0.5 text-xs font-medium text-amber-800">
            검토 대기
          </span>
        </div>
        <p className="mt-xs text-sm leading-relaxed text-amber-800">
          연체 인보이스에 대해 {aiSource === "ai" ? "AI가" : "기본 템플릿으로"} 생성된
          초안입니다. 자동 발송되지 않으니 내용을 확인·수정한 뒤 발송해 주세요.
        </p>
      </div>

      <div className="mt-lg grid gap-md">
        <div className="grid gap-xs">
          <label htmlFor="dunning-subject" className="text-xs font-medium uppercase tracking-wide text-text-muted">
            제목
          </label>
          <input
            id="dunning-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            disabled={isPending}
            className="min-h-11 rounded-sm border border-surface-border-strong bg-white px-md py-sm text-sm text-text-body focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30 disabled:opacity-50"
          />
        </div>
        <div className="grid gap-xs">
          <label htmlFor="dunning-body" className="text-xs font-medium uppercase tracking-wide text-text-muted">
            본문
          </label>
          <textarea
            id="dunning-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={isPending}
            rows={10}
            className="rounded-sm border border-surface-border-strong bg-white px-md py-sm text-sm leading-relaxed text-text-body focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30 disabled:opacity-50"
          />
        </div>
      </div>

      {message ? (
        <p className="mt-md text-xs text-red-600" role="alert">
          {message.text}
        </p>
      ) : null}

      <div className="mt-lg flex flex-wrap gap-sm">
        <Button
          type="button"
          variant="primary"
          disabled={isPending || !subject.trim() || !body.trim()}
          onClick={approve}
        >
          {isPending ? "처리 중" : "이 내용으로 발송"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          onClick={dismiss}
        >
          무시
        </Button>
      </div>
    </Card>
  );
}
