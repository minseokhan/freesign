"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  SignatureCanvas,
  type SignatureCanvasHandle,
} from "@/components/signature-canvas";

type SignaturePadProps = {
  contractId: string;
};

export function SignaturePad({ contractId }: SignaturePadProps) {
  const router = useRouter();
  const canvasRef = useRef<SignatureCanvasHandle>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function clearSignature() {
    canvasRef.current?.clear();
    setError(null);
  }

  async function submitSignature() {
    if (!signatureDataUrl) {
      setError("서명을 먼저 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const response = await fetch(`/api/contracts/${contractId}/sign`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        signatureDataUrl,
      }),
    });

    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setError(result?.error ?? "서명을 저장하지 못했습니다.");
      setIsSubmitting(false);
      return;
    }

    router.refresh();
  }

  return (
    <div className="space-y-lg">
      <div className="rounded-md border border-amber-200 bg-status-waiting-bg px-md py-sm text-xs leading-relaxed text-amber-800">
        v1 간이 서명은 기록용 서명입니다. 문서 해시와 서버 기록으로
        무결성 확인 원리만 재현하며, 강한 법적 증거가 필요하면 인증
        서명이 필요합니다.
      </div>
      <div>
        <label
          htmlFor="signature-canvas"
          className="text-sm font-medium text-text-body"
        >
          서명 입력
        </label>
        <SignatureCanvas
          id="signature-canvas"
          ref={canvasRef}
          className="mt-sm h-48 w-full touch-none rounded-sm border border-surface-border-strong bg-white"
          onChange={setSignatureDataUrl}
        />
      </div>
      {error ? (
        <p className="text-sm leading-relaxed text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-sm">
        <button
          type="button"
          onClick={submitSignature}
          disabled={isSubmitting}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
        >
          {isSubmitting ? "저장 중" : "서명 완료"}
        </button>
        <button
          type="button"
          onClick={clearSignature}
          disabled={isSubmitting}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-surface-border bg-white px-lg py-sm text-sm font-medium text-text-body transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
        >
          지우기
        </button>
      </div>
    </div>
  );
}
