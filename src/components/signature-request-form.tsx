"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  sendSignatureRequest,
  type SignatureActionResult,
} from "@/app/(dashboard)/contracts/signature-actions";
import {
  SignatureCanvas,
  type SignatureCanvasHandle,
} from "@/components/signature-canvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// signature-actions.ts의 sendSignatureRequest allowlist와 정합하는 클라이언트 스키마.
// consent는 서버에서 z.literal(true)로 재검증된다(전자서명법 3조 2항 — 명시적 동의 캡처).
const signatureRequestFormSchema = z.object({
  recipientEmail: z
    .string()
    .trim()
    .min(1, "수신자 이메일을 입력해 주세요.")
    .email("올바른 이메일 형식이 아닙니다.")
    .max(254, "이메일이 너무 깁니다."),
  recipientName: z.string().trim().max(100, "이름이 너무 깁니다.").optional(),
  signatureDataUrl: z.string().min(1, "서명을 먼저 입력해 주세요."),
  consentElectronicSignature: z
    .boolean()
    .refine(
      (value) => value === true,
      "전자서명 사용에 동의해야 요청을 보낼 수 있습니다.",
    ),
  consentPrivacy: z
    .boolean()
    .refine(
      (value) => value === true,
      "개인정보 수집·이용에 동의해야 요청을 보낼 수 있습니다.",
    ),
});

type SignatureRequestFormValues = z.infer<typeof signatureRequestFormSchema>;
type SignatureRequestFieldErrors = NonNullable<
  Extract<SignatureActionResult, { ok: false }>["fieldErrors"]
>;

type SignatureRequestFormProps = {
  contractId: string;
};

function ConsentCheckbox({
  id,
  error,
  label,
  description,
  inputProps,
}: {
  id: string;
  error?: string;
  label: string;
  description: string;
  inputProps: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  return (
    <div className="grid gap-xs">
      <label htmlFor={id} className="flex items-start gap-sm">
        <input
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="mt-1 size-4 shrink-0 rounded-sm border-slate-300 accent-brand-primary"
          {...inputProps}
        />
        <span className="text-sm leading-relaxed text-text-body">
          <span className="font-medium">{label}</span>{" "}
          <span className="text-text-muted">{description}</span>
        </span>
      </label>
      {error ? (
        <p id={`${id}-error`} className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SignatureRequestForm({ contractId }: SignatureRequestFormProps) {
  const router = useRouter();
  const canvasRef = useRef<SignatureCanvasHandle>(null);
  const [isPending, startTransition] = useTransition();
  const {
    formState: { errors },
    handleSubmit,
    register,
    setError,
    setValue,
  } = useForm<SignatureRequestFormValues>({
    defaultValues: {
      recipientEmail: "",
      recipientName: "",
      signatureDataUrl: "",
      consentElectronicSignature: false,
      consentPrivacy: false,
    },
    resolver: zodResolver(signatureRequestFormSchema),
  });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await sendSignatureRequest({
        contractId,
        recipientEmail: values.recipientEmail,
        recipientName: values.recipientName || undefined,
        signatureDataUrl: values.signatureDataUrl,
        consentElectronicSignature: true,
        consentPrivacy: true,
      });

      if (!result.ok) {
        if (result.fieldErrors) {
          const fieldErrors = result.fieldErrors as SignatureRequestFieldErrors;

          (
            Object.keys(fieldErrors) as Array<keyof SignatureRequestFormValues>
          ).forEach((field) => {
            const message = fieldErrors[field]?.[0];

            if (message) {
              setError(field, { message });
            }
          });
        }

        setError("root", { message: result.error });
        return;
      }

      router.refresh();
    });
  });

  return (
    <form className="space-y-lg" onSubmit={onSubmit} noValidate>
      <div className="rounded-md border border-amber-200 bg-status-waiting-bg px-md py-sm text-xs leading-relaxed text-amber-800">
        내 서명과 함께 상대방에게 서명 요청 이메일을 보냅니다. 발송 후에는
        조항을 수정할 수 없으며, 상대방이 서명하면 계약이 서명완료 상태가
        됩니다.
      </div>

      <Input
        label="수신자 이메일"
        type="email"
        placeholder="client@example.com"
        autoComplete="email"
        error={errors.recipientEmail?.message}
        {...register("recipientEmail")}
      />

      <Input
        label="수신자 이름 (선택)"
        placeholder="예: 김담당"
        autoComplete="name"
        error={errors.recipientName?.message}
        {...register("recipientName")}
      />

      <div>
        <label
          htmlFor="signature-request-canvas"
          className="text-sm font-medium text-text-body"
        >
          내 서명 입력
        </label>
        <SignatureCanvas
          id="signature-request-canvas"
          ref={canvasRef}
          className="mt-sm h-48 w-full touch-none rounded-sm border border-surface-border-strong bg-white"
          onChange={(dataUrl) =>
            setValue("signatureDataUrl", dataUrl ?? "", {
              shouldValidate: dataUrl != null,
            })
          }
        />
        {errors.signatureDataUrl?.message ? (
          <p className="mt-xs text-xs text-red-600" role="alert">
            {errors.signatureDataUrl.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-sm">
        <ConsentCheckbox
          id="consent-electronic-signature"
          label="전자서명 사용 동의(필수)"
          description="위 캔버스 서명을 나의 서명으로 사용하고, 양 당사자가 전자서명으로 이 계약을 체결하는 데 동의합니다."
          error={errors.consentElectronicSignature?.message}
          inputProps={register("consentElectronicSignature")}
        />
        <ConsentCheckbox
          id="consent-privacy"
          label="개인정보 수집·이용 동의(필수)"
          description="서명 이미지·이메일·IP·기기 정보가 계약 증빙 목적으로 수집·보관되는 데 동의합니다."
          error={errors.consentPrivacy?.message}
          inputProps={register("consentPrivacy")}
        />
      </div>

      {errors.root?.message ? (
        <p
          className="rounded-md border border-red-200 bg-red-50 px-md py-sm text-sm text-red-700"
          role="alert"
        >
          {errors.root.message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-sm">
        <Button type="submit" disabled={isPending}>
          {isPending ? "보내는 중" : "서명하고 요청 보내기"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          onClick={() => canvasRef.current?.clear()}
        >
          서명 지우기
        </Button>
      </div>
    </form>
  );
}
