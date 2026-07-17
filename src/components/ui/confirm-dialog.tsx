"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  pendingLabel?: string;
  isPending?: boolean;
  error?: string | null;
  // 실행 불가 안내 모드 — 위험 버튼·취소 버튼을 숨기고 중립 "확인" 버튼 하나만 노출한다.
  confirmOnly?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "삭제",
  cancelLabel = "취소",
  pendingLabel = "삭제 중",
  isPending = false,
  error = null,
  confirmOnly = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isPending) {
        onCancel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, isPending, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-lg">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/60"
        onClick={() => {
          if (!isPending) {
            onCancel();
          }
        }}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative w-full max-w-sm rounded-lg bg-white p-xl shadow-lg"
      >
        <h2
          id="confirm-dialog-title"
          className="text-lg font-semibold text-text-primary"
        >
          {title}
        </h2>
        {description ? (
          <div className="mt-sm space-y-xs text-sm leading-relaxed text-text-muted">
            {description
              .split(/(?<=\.)\s+/)
              .filter((sentence) => sentence.length > 0)
              .map((sentence, index) => (
                <p key={index}>{sentence}</p>
              ))}
          </div>
        ) : null}
        {error ? <p className="mt-sm text-sm text-red-600">{error}</p> : null}
        <div className="mt-xl flex justify-end gap-sm">
          {confirmOnly ? (
            <Button type="button" variant="primary" onClick={onConfirm}>
              {confirmLabel}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={isPending}
                onClick={onCancel}
              >
                {cancelLabel}
              </Button>
              <Button
                type="button"
                variant="danger"
                className="bg-red-50 hover:bg-red-100"
                disabled={isPending}
                onClick={onConfirm}
              >
                {isPending ? pendingLabel : confirmLabel}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
