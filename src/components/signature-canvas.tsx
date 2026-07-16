"use client";

// signature-pad.tsx에서 추출한 순수 캔버스 드로잉 컴포넌트.
// auth·계약 데이터 의존성이 없어 공개 서명 페이지에서도 재사용할 수 있다.
// 값(PNG data URL)은 onChange 콜백으로만 흘러 나간다(그리기 종료 시 갱신, 지우기 시 null).

import {
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent,
  type Ref,
} from "react";

export type SignatureCanvasHandle = {
  clear: () => void;
};

type SignatureCanvasProps = {
  id?: string;
  className?: string;
  "aria-label"?: string;
  onChange: (dataUrl: string | null) => void;
  ref?: Ref<SignatureCanvasHandle>;
};

export function SignatureCanvas({
  id,
  className,
  "aria-label": ariaLabel = "서명 입력 캔버스",
  onChange,
  ref,
}: SignatureCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useImperativeHandle(ref, () => ({
    clear() {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");

      if (!canvas || !context) return;

      context.clearRect(0, 0, canvas.width, canvas.height);
      onChange(null);
    },
  }));

  function getPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();

    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
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
    onChange(canvas.toDataURL("image/png"));
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!isDrawing) return;

    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");

    if (!context) return;

    const point = getPoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function stopDrawing(event: PointerEvent<HTMLCanvasElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (isDrawing) {
      onChange(event.currentTarget.toDataURL("image/png"));
    }

    setIsDrawing(false);
  }

  return (
    <canvas
      id={id}
      ref={canvasRef}
      width={720}
      height={240}
      role="img"
      aria-label={ariaLabel}
      className={className}
      onPointerDown={startDrawing}
      onPointerMove={draw}
      onPointerUp={stopDrawing}
      onPointerCancel={stopDrawing}
    />
  );
}
