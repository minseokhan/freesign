"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  createInvoice,
  type InvoiceActionResult,
} from "@/app/(dashboard)/invoices/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { calcWithholding, type WithholdingType } from "@/lib/tax";
import { cn } from "@/lib/utils";
import {
  invoiceInputSchema,
  type InvoiceInput,
} from "@/lib/validation/invoice";

type InvoiceFormProps = {
  contract: {
    id: string;
    title: string;
    amount: number;
    clientName: string;
    disabled?: boolean;
  };
  defaultIssueDate: string;
  defaultDueDate: string;
  defaultWithholdingType?: WithholdingType;
};

type InvoiceFormInput = z.input<typeof invoiceInputSchema>;
type InvoiceFieldErrors = NonNullable<
  Extract<InvoiceActionResult, { ok: false }>["fieldErrors"]
>;

const withholdingOptions = [
  { value: "wt_3_3", label: "3.3%" },
  { value: "wt_8_8", label: "8.8%" },
  { value: "none", label: "없음" },
] as const;

function firstError(fieldErrors: InvoiceFieldErrors, field: keyof InvoiceInput) {
  return fieldErrors?.[field]?.[0];
}

function formatKRW(amount: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatAmountInput(value: unknown) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");

  if (digits === "") {
    return "";
  }

  return Number(digits).toLocaleString("ko-KR");
}

export function InvoiceForm({
  contract,
  defaultIssueDate,
  defaultDueDate,
  defaultWithholdingType,
}: InvoiceFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const {
    formState: { errors, isSubmitSuccessful },
    handleSubmit,
    register,
    setError,
    setValue,
    watch,
  } = useForm<InvoiceFormInput, unknown, InvoiceInput>({
    defaultValues: {
      contract_id: contract.id,
      amount: contract.amount,
      issue_date: defaultIssueDate,
      due_date: defaultDueDate,
      withholding_type: defaultWithholdingType ?? "wt_3_3",
    },
    resolver: zodResolver(invoiceInputSchema),
  });

  const amount = watch("amount");
  const withholdingType = watch("withholding_type");
  const preview = useMemo(() => {
    const parsedAmount =
      typeof amount === "number" ? amount : Number.parseInt(String(amount), 10);

    if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) {
      return null;
    }

    try {
      return calcWithholding(parsedAmount, withholdingType);
    } catch {
      return null;
    }
  }, [amount, withholdingType]);
  const isDisabled = contract.disabled || isPending;

  const onSubmit = handleSubmit((values) => {
    startTransition(async () => {
      const result = await createInvoice(values);

      if (!result.ok) {
        if (result.fieldErrors) {
          const fieldErrors = result.fieldErrors;

          (Object.keys(fieldErrors) as Array<keyof InvoiceInput>).forEach(
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

      router.push(`/invoices/${result.id}`);
      router.refresh();
    });
  });

  return (
    <Card>
      <form className="space-y-xl" onSubmit={onSubmit} noValidate>
        <input type="hidden" {...register("contract_id")} />

        <div className="border-b border-surface-border pb-lg">
          <h3 className="text-lg font-semibold text-text-primary">
            인보이스 발행
          </h3>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            {contract.clientName} · {contract.title}
          </p>
        </div>

        {contract.disabled ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-md py-sm text-sm text-red-700">
            취소된 계약에는 인보이스를 발행할 수 없습니다.
          </p>
        ) : null}

        <div className="grid gap-lg">
          <Input
            label="청구 금액"
            type="text"
            inputMode="numeric"
            error={errors.amount?.message}
            {...register("amount", {
              // 표시값은 "5,000,000"처럼 콤마가 포함되므로, RHF가 blur·submit 시 DOM
              // 값을 읽어들일 때 콤마를 제거해 숫자로 정규화한다. 없으면 z.coerce.number가
              // "5,000,000"을 NaN으로 보고 "Invalid input"으로 거부한다.
              setValueAs: (value) => {
                const digits = String(value ?? "").replace(/[^\d]/g, "");

                return digits === "" ? "" : Number(digits);
              },
            })}
            value={formatAmountInput(amount)}
            onChange={(event) => {
              const digits = event.target.value.replace(/[^\d]/g, "");

              setValue("amount", digits === "" ? "" : Number(digits), {
                shouldValidate: Boolean(errors.amount),
              });
            }}
          />

          <div className="grid gap-lg sm:grid-cols-2">
            <Input
              label="발행일"
              type="date"
              error={errors.issue_date?.message}
              {...register("issue_date")}
            />
            <Input
              label="지급기한"
              type="date"
              error={errors.due_date?.message}
              {...register("due_date")}
            />
          </div>

          <div className="grid gap-sm">
            <label
              htmlFor="invoice-withholding-type"
              className="text-sm font-medium text-text-body"
            >
              원천징수
            </label>
            <select
              id="invoice-withholding-type"
              className={cn(
                "min-h-11 rounded-sm border border-slate-300 bg-white px-md py-sm text-sm text-text-primary",
                "focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30",
                errors.withholding_type && "border-red-500",
              )}
              aria-invalid={errors.withholding_type ? true : undefined}
              aria-describedby={
                errors.withholding_type
                  ? "invoice-withholding-type-error"
                  : undefined
              }
              {...register("withholding_type")}
            >
              {withholdingOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {errors.withholding_type ? (
              <p
                id="invoice-withholding-type-error"
                className="text-xs text-red-600"
              >
                {errors.withholding_type.message}
              </p>
            ) : null}
          </div>
        </div>

        {preview ? (
          <div className="rounded-md border border-surface-border bg-surface-muted p-lg">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              미리보기
            </p>
            <dl className="mt-md grid gap-md sm:grid-cols-3">
              <div>
                <dt className="text-xs text-text-muted">청구 금액</dt>
                <dd className="mt-xs font-semibold tabular-nums text-text-primary">
                  {formatKRW(
                    typeof amount === "number"
                      ? amount
                      : Number.parseInt(String(amount), 10),
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">원천징수</dt>
                <dd className="mt-xs font-semibold tabular-nums text-text-primary">
                  {formatKRW(preview.withholding)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">실수령액</dt>
                <dd className="mt-xs font-semibold tabular-nums text-text-primary">
                  {formatKRW(preview.net)}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}

        <div className="rounded-md border border-amber-200 bg-status-waiting-bg px-md py-sm text-xs leading-relaxed text-amber-800">
          원천징수 계산은 참고용입니다. 저장되는 금액 스냅샷은 서버에서 다시
          계산되어 발행 시점 기준으로 고정됩니다.
        </div>

        {errors.root?.message ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-md py-sm text-sm text-red-700">
            {errors.root.message}
          </p>
        ) : null}

        {isSubmitSuccessful && !errors.root?.message ? (
          <p role="status" className="text-sm font-medium text-green-700">
            발행했습니다.
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
          <Button type="submit" disabled={isDisabled}>
            {isPending ? "발행 중" : "발행"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
