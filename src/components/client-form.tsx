"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  createClient,
  updateClient,
  type ClientActionResult
} from "@/app/(dashboard)/clients/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { clientInputSchema, type ClientInput } from "@/lib/validation/client";

const CHANNEL_OPTIONS = [
  { value: "linkedin", label: "링크드인" },
  { value: "instagram", label: "인스타그램" },
  { value: "youtube", label: "유튜브" },
  { value: "direct", label: "직거래" },
  { value: "kmong", label: "크몽" },
  { value: "referral", label: "추천" },
  { value: "other", label: "기타" }
] as const;

type ClientFormProps = {
  clientId?: string;
  defaultValues?: Partial<ClientInput>;
  mode: "create" | "edit";
};

type ClientFormInput = z.input<typeof clientInputSchema>;
type ClientFieldErrors = NonNullable<
  Extract<ClientActionResult, { ok: false }>["fieldErrors"]
>;

function toFormDefaults(defaultValues?: Partial<ClientInput>): ClientFormInput {
  return {
    name: defaultValues?.name ?? "",
    channel: defaultValues?.channel ?? "direct",
    contact_email: defaultValues?.contact_email ?? "",
    contact_phone: defaultValues?.contact_phone ?? "",
    memo: defaultValues?.memo ?? ""
  };
}

function firstError(fieldErrors: ClientFieldErrors, field: keyof ClientInput) {
  return fieldErrors?.[field]?.[0];
}

export function ClientForm({ clientId, defaultValues, mode }: ClientFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const {
    formState: { errors, isSubmitSuccessful },
    handleSubmit,
    register,
    setError
  } = useForm<ClientFormInput, unknown, ClientInput>({
    defaultValues: toFormDefaults(defaultValues),
    resolver: zodResolver(clientInputSchema)
  });

  const isEdit = mode === "edit";

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result =
        isEdit && clientId
          ? await updateClient(clientId, values)
          : await createClient(values);

      if (!result.ok) {
        if (result.fieldErrors) {
          const fieldErrors = result.fieldErrors;

          (Object.keys(fieldErrors) as Array<keyof ClientInput>).forEach(
            (field) => {
              const message = firstError(fieldErrors, field);

              if (message) {
                setError(field, { message });
              }
            }
          );
        }

        setError("root", { message: result.error });
        return;
      }

      router.push(isEdit ? `/clients/${result.id}` : "/clients");
      router.refresh();
    });
  });

  return (
    <Card>
      <form className="space-y-xl" onSubmit={onSubmit} noValidate>
        <div className="border-b border-surface-border pb-lg">
          <h3 className="text-lg font-semibold text-text-primary">
            {isEdit ? "클라이언트 수정" : "클라이언트 만들기"}
          </h3>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            계약과 인보이스에 연결할 기본 정보를 입력합니다.
          </p>
        </div>

        <div className="grid gap-lg">
          <Input
            label="이름"
            placeholder="예: 홍길동 디자인 스튜디오"
            autoComplete="organization"
            error={errors.name?.message}
            {...register("name")}
          />

          <div className="grid gap-sm">
            <label
              htmlFor="client-channel"
              className="text-sm font-medium text-text-body"
            >
              채널
            </label>
            <select
              id="client-channel"
              className={cn(
                "min-h-11 rounded-sm border border-slate-300 bg-white px-md py-sm text-sm text-text-primary",
                "focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30",
                errors.channel && "border-red-500"
              )}
              aria-invalid={errors.channel ? true : undefined}
              aria-describedby={
                errors.channel ? "client-channel-error" : undefined
              }
              {...register("channel")}
            >
              {CHANNEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {errors.channel ? (
              <p id="client-channel-error" className="text-xs text-red-600">
                {errors.channel.message}
              </p>
            ) : null}
          </div>

          <Input
            label="이메일"
            type="email"
            placeholder="client@example.com"
            autoComplete="email"
            error={errors.contact_email?.message}
            {...register("contact_email")}
          />

          <Input
            label="전화번호"
            type="tel"
            placeholder="010-0000-0000"
            autoComplete="tel"
            error={errors.contact_phone?.message}
            {...register("contact_phone")}
          />

          <div className="grid gap-sm">
            <label
              htmlFor="client-memo"
              className="text-sm font-medium text-text-body"
            >
              메모
            </label>
            <textarea
              id="client-memo"
              rows={5}
              placeholder="계약 전 확인할 참고 사항을 적어두세요."
              className={cn(
                "rounded-sm border border-slate-300 bg-white px-md py-sm text-sm leading-relaxed text-text-primary",
                "focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30",
                errors.memo && "border-red-500"
              )}
              aria-invalid={errors.memo ? true : undefined}
              aria-describedby={errors.memo ? "client-memo-error" : undefined}
              {...register("memo")}
            />
            {errors.memo ? (
              <p id="client-memo-error" className="text-xs text-red-600">
                {errors.memo.message}
              </p>
            ) : null}
          </div>
        </div>

        {errors.root?.message ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-md py-sm text-sm text-red-700">
            {errors.root.message}
          </p>
        ) : null}

        {isSubmitSuccessful && !errors.root?.message ? (
          <p role="status" className="text-sm font-medium text-green-700">
            저장했습니다.
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-sm border-t border-surface-border pt-lg sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            disabled={isPending}
            onClick={() => router.back()}
          >
            취소
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "저장 중" : "저장"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
