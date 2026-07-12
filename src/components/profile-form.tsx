"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  updateProfile,
  type ProfileActionResult,
} from "@/app/(dashboard)/settings/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { profileInputSchema, type ProfileInput } from "@/lib/validation/profile";

const WITHHOLDING_OPTIONS = [
  { value: "wt_3_3", label: "3.3% (사업소득)" },
  { value: "wt_8_8", label: "8.8% (기타소득)" },
  { value: "none", label: "없음" },
] as const;

type ProfileFormProps = {
  defaultValues?: Partial<ProfileInput>;
};

type ProfileFormInput = z.input<typeof profileInputSchema>;
type ProfileFieldErrors = NonNullable<
  Extract<ProfileActionResult, { ok: false }>["fieldErrors"]
>;

function toFormDefaults(defaultValues?: Partial<ProfileInput>): ProfileFormInput {
  return {
    display_name: defaultValues?.display_name ?? "",
    default_withholding_type: defaultValues?.default_withholding_type ?? "none",
    bank_name: defaultValues?.bank_name ?? "",
    bank_account_number: defaultValues?.bank_account_number ?? "",
    bank_account_holder: defaultValues?.bank_account_holder ?? "",
  };
}

function firstError(fieldErrors: ProfileFieldErrors, field: keyof ProfileInput) {
  return fieldErrors?.[field]?.[0];
}

export function ProfileForm({ defaultValues }: ProfileFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const {
    formState: { errors, isSubmitSuccessful },
    handleSubmit,
    register,
    setError,
  } = useForm<ProfileFormInput, unknown, ProfileInput>({
    defaultValues: toFormDefaults(defaultValues),
    resolver: zodResolver(profileInputSchema),
  });

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await updateProfile(values);

      if (!result.ok) {
        if (result.fieldErrors) {
          const fieldErrors = result.fieldErrors;

          (Object.keys(fieldErrors) as Array<keyof ProfileInput>).forEach(
            (field) => {
              const message = firstError(fieldErrors, field);

              if (message) {
                setError(field, { message });
              }
            },
          );
        }

        setError("root", { message: result.error });
        return;
      }

      router.refresh();
    });
  });

  return (
    <Card>
      <form className="space-y-xl" onSubmit={onSubmit} noValidate>
        <div className="border-b border-surface-border pb-lg">
          <h3 className="text-lg font-semibold text-text-primary">프로필</h3>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            계약서와 인보이스에 표시할 기본 정보를 설정합니다.
          </p>
        </div>

        <div className="grid gap-lg">
          <Input
            label="표시 이름"
            placeholder="예: 홍길동"
            autoComplete="name"
            error={errors.display_name?.message}
            {...register("display_name")}
          />
          <p className="-mt-sm text-xs leading-relaxed text-text-muted">
            계약서 초안에 프리랜서 이름으로 사용됩니다.
          </p>

          <div className="grid gap-sm">
            <label
              htmlFor="profile-withholding-type"
              className="text-sm font-medium text-text-body"
            >
              기본 원천징수율
            </label>
            <select
              id="profile-withholding-type"
              className={cn(
                "min-h-11 rounded-sm border border-slate-300 bg-white px-md py-sm text-sm text-text-primary",
                "focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30",
                errors.default_withholding_type && "border-red-500",
              )}
              aria-invalid={errors.default_withholding_type ? true : undefined}
              aria-describedby={
                errors.default_withholding_type
                  ? "profile-withholding-type-error"
                  : undefined
              }
              {...register("default_withholding_type")}
            >
              {WITHHOLDING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {errors.default_withholding_type ? (
              <p
                id="profile-withholding-type-error"
                className="text-xs text-red-600"
              >
                {errors.default_withholding_type.message}
              </p>
            ) : (
              <p className="text-xs leading-relaxed text-text-muted">
                새 인보이스를 발행할 때 기본으로 선택됩니다.
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-lg border-t border-surface-border pt-lg">
          <div>
            <h3 className="text-lg font-semibold text-text-primary">입금 계좌</h3>
            <p className="mt-xs text-sm leading-relaxed text-text-muted">
              인보이스 상세와 PDF에 표시할 계좌 정보입니다.
            </p>
          </div>

          <Input
            label="은행"
            placeholder="예: 국민은행"
            error={errors.bank_name?.message}
            {...register("bank_name")}
          />

          <Input
            label="계좌번호"
            placeholder="예: 123-456-789012"
            error={errors.bank_account_number?.message}
            {...register("bank_account_number")}
          />

          <Input
            label="예금주"
            placeholder="예: 홍길동"
            error={errors.bank_account_holder?.message}
            {...register("bank_account_holder")}
          />
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
          <Button type="submit" disabled={isPending}>
            {isPending ? "저장 중" : "저장"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
