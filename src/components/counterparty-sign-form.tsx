"use client";

// 상대방(counterparty) 비로그인 서명 폼 — 공개 서명 페이지(/sign/[token])에서 사용한다.
// 제출은 anon API(POST /api/sign/[token])로만 흐르고, 성공 시 RSC를 갱신해
// 완료 화면(다운로드 링크)으로 전환한다.

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  SignatureCanvas,
  type SignatureCanvasHandle,
} from "@/components/signature-canvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// 서버 라우트의 zod allowlist와 정합하는 클라이언트 스키마.
// consent는 서버에서 z.literal(true)로 재검증된다(전자서명법 3조 2항 — 명시적 동의 캡처).
const counterpartySignFormSchema = z.object({
  signerName: z
    .string()
    .trim()
    .min(1, "서명자 이름을 입력해 주세요.")
    .max(120, "이름이 너무 깁니다."),
  signatureDataUrl: z.string().min(1, "서명을 먼저 입력해 주세요."),
  consentElectronicSignature: z
    .boolean()
    .refine((value) => value === true, "전자서명 사용에 동의해야 서명할 수 있습니다."),
  consentPrivacy: z
    .boolean()
    .refine(
      (value) => value === true,
      "개인정보 수집·이용에 동의해야 서명할 수 있습니다.",
    ),
});

type CounterpartySignFormValues = z.infer<typeof counterpartySignFormSchema>;

type CounterpartySignFormProps = {
  token: string;
};

const STATUS_FALLBACK_MESSAGES: Record<number, string> = {
  400: "서명 데이터를 확인해 주세요.",
  404: "유효하지 않은 서명 링크입니다.",
  409: "이미 완료되었거나 계약 내용이 변경된 요청입니다. 페이지를 새로고침해 주세요.",
  410: "서명 링크가 만료되었거나 철회되었습니다. 보낸 분에게 재발송을 요청해 주세요.",
  429: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
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

export function CounterpartySignForm({ token }: CounterpartySignFormProps) {
  const router = useRouter();
  const canvasRef = useRef<SignatureCanvasHandle>(null);
  const [isPending, startTransition] = useTransition();
  const {
    formState: { errors },
    handleSubmit,
    register,
    setError,
    setValue,
  } = useForm<CounterpartySignFormValues>({
    defaultValues: {
      signerName: "",
      signatureDataUrl: "",
      consentElectronicSignature: false,
      consentPrivacy: false,
    },
    resolver: zodResolver(counterpartySignFormSchema),
  });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/sign/${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            signerName: values.signerName,
            signatureDataUrl: values.signatureDataUrl,
            consentElectronicSignature: true,
            consentPrivacy: true,
          }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as {
            error?: string;
          } | null;

          setError("root", {
            message:
              body?.error ??
              STATUS_FALLBACK_MESSAGES[response.status] ??
              "서명 처리 중 오류가 발생했습니다.",
          });
          return;
        }

        // 성공: RSC 재조회로 완료 화면(다운로드 링크)으로 전환한다.
        router.refresh();
      } catch {
        setError("root", {
          message: "네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
        });
      }
    });
  });

  return (
    <form className="space-y-lg" onSubmit={onSubmit} noValidate>
      <Input
        label="서명자 이름"
        placeholder="예: 김담당"
        autoComplete="name"
        error={errors.signerName?.message}
        {...register("signerName")}
      />

      <div>
        <label
          htmlFor="counterparty-sign-canvas"
          className="text-sm font-medium text-text-body"
        >
          서명 입력
        </label>
        <SignatureCanvas
          id="counterparty-sign-canvas"
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
          id="counterparty-consent-electronic-signature"
          label="전자서명 사용 동의(필수)"
          description="위 캔버스 서명을 나의 서명으로 사용하고, 양 당사자가 전자서명으로 이 계약을 체결하는 데 동의합니다."
          error={errors.consentElectronicSignature?.message}
          inputProps={register("consentElectronicSignature")}
        />
        <ConsentCheckbox
          id="counterparty-consent-privacy"
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
          {isPending ? "서명 처리 중" : "동의하고 서명 완료"}
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
