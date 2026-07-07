"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type SignaturePadProps = {
  contractId: string;
};

export function SignaturePad({ contractId }: SignaturePadProps) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function getPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();

    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function startDrawing(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");

    if (!context) return;

    const point = getPoint(event);
    canvas.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#0f172a";
    setIsDrawing(true);
    setIsDirty(true);
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing) return;

    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");

    if (!context) return;

    const point = getPoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function stopDrawing(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setIsDrawing(false);
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    setIsDirty(false);
    setError(null);
  }

  async function submitSignature() {
    const canvas = canvasRef.current;

    if (!canvas || !isDirty) {
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
        signatureDataUrl: canvas.toDataURL("image/png"),
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
        v1 간이 서명은 법적 효력이 없는 기록용 서명입니다. 문서 해시와
        서버 기록으로 무결성 확인 원리만 재현합니다.
      </div>
      <div>
        <label
          htmlFor="signature-canvas"
          className="text-sm font-medium text-text-body"
        >
          서명 입력
        </label>
        <canvas
          id="signature-canvas"
          ref={canvasRef}
          width={720}
          height={240}
          role="img"
          aria-label="서명 입력 캔버스"
          className="mt-sm h-48 w-full touch-none rounded-sm border border-surface-border-strong bg-white"
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerCancel={stopDrawing}
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
