"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import {
  createContractDraft,
  type ContractActionResult,
} from "@/app/(dashboard)/contracts/actions";
import { AiProcessingNotice } from "@/components/ai-processing-notice";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  contractDraftInputSchema,
  type ContractDraftInput,
} from "@/lib/validation/contract";
import type { ContractDraftPreview } from "@/lib/contracts/draft";

type ContractFormProps = {
  clients: Array<{
    id: string;
    name: string;
  }>;
};

type ContractFormInput = z.input<typeof contractDraftInputSchema>;
type ContractFieldErrors = NonNullable<
  Extract<ContractActionResult, { ok: false }>["fieldErrors"]
>;

const STEPS = [
  { key: "input", label: "구조화 입력" },
  { key: "draft", label: "초안 생성" },
  { key: "save", label: "저장" },
] as const;

function firstError(
  fieldErrors: ContractFieldErrors,
  field: keyof ContractDraftInput,
) {
  return fieldErrors?.[field]?.[0];
}

function formatAmountDisplay(value: unknown) {
  if (value === "" || value === null || value === undefined) {
    return "";
  }

  const numeric = typeof value === "number" ? value : Number(value);

  if (Number.isNaN(numeric)) {
    return typeof value === "string" ? value : "";
  }

  return new Intl.NumberFormat("ko-KR").format(numeric);
}

export function ContractForm({ clients }: ContractFormProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<ContractDraftPreview | null>(null);
  const [isGenerating, startGenerating] = useTransition();
  const [isSaving, startSaving] = useTransition();
  const {
    control,
    formState: { errors },
    handleSubmit,
    register,
    setError,
  } = useForm<ContractFormInput, unknown, ContractDraftInput>({
    defaultValues: {
      title: "",
      client_id: clients[0]?.id ?? "",
      scope: "",
      amount: "" as unknown as number,
      start_date: "",
      end_date: "",
      due_date: "",
    },
    resolver: zodResolver(contractDraftInputSchema),
  });

  const currentStep = draft ? "draft" : "input";
  const isDisabled = clients.length === 0 || isGenerating || isSaving;

  const generateDraft = handleSubmit((values) => {
    startGenerating(async () => {
      setDraft(null);

      const response = await fetch("/api/contracts/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const result = (await response.json()) as
        | { ok: true; draft: ContractDraftPreview }
        | {
            ok: false;
            error: string;
            fieldErrors?: ContractFieldErrors;
          };

      if (!result.ok) {
        if (result.fieldErrors) {
          const fieldErrors = result.fieldErrors;

          (Object.keys(fieldErrors) as Array<keyof ContractDraftInput>).forEach(
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

      setDraft(result.draft);
    });
  });

  const saveDraft = handleSubmit((values) => {
    startSaving(async () => {
      const result = await createContractDraft(values);

      if (!result.ok) {
        if (result.fieldErrors) {
          const fieldErrors = result.fieldErrors;

          (Object.keys(fieldErrors) as Array<keyof ContractDraftInput>).forEach(
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

      router.push(`/contracts/${result.id}`);
      router.refresh();
    });
  });

  return (
    <div className="space-y-xl">
      <nav aria-label="계약 생성 단계" className="rounded-lg bg-white">
        <ol className="grid gap-sm sm:grid-cols-3">
          {STEPS.map((step, index) => {
            const isActive = step.key === currentStep;
            const isComplete =
              (step.key === "input" && draft) ||
              (step.key === "draft" && isSaving);

            return (
              <li
                key={step.key}
                className={cn(
                  "flex min-h-11 items-center gap-sm rounded-md border px-md py-sm text-sm font-medium",
                  isActive
                    ? "border-brand-primary/20 bg-brand-point text-brand-primary"
                    : "border-surface-border bg-white text-text-muted",
                  isComplete && "border-green-200 bg-green-50 text-green-700",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs",
                    isActive && "bg-brand-primary text-white",
                    isComplete && "bg-green-600 text-white",
                    !isActive && !isComplete && "bg-slate-200 text-text-muted",
                  )}
                  aria-hidden="true"
                >
                  {isComplete ? "✓" : index + 1}
                </span>
                {step.label}
              </li>
            );
          })}
        </ol>
      </nav>

      <Card className={cn(draft && "hidden")}>
        <form className="space-y-xl" onSubmit={generateDraft} noValidate>
          <div className="border-b border-surface-border pb-lg">
            <h3 className="text-lg font-semibold text-text-primary">
              계약 구조화 입력
            </h3>
            <p className="mt-xs text-sm leading-relaxed text-text-muted">
              클라이언트, 범위, 금액, 기간을 입력하면 초안 조항을 생성합니다.
            </p>
          </div>

          {clients.length === 0 ? (
            <p className="rounded-md border border-amber-200 bg-status-waiting-bg px-md py-sm text-sm text-amber-800">
              계약을 만들기 전에 클라이언트를 먼저 등록해야 합니다.
            </p>
          ) : null}

          <div className="grid gap-lg">
            <Input
              label="계약 제목"
              placeholder="예: 블루스튜디오 브랜드 랜딩 계약"
              error={errors.title?.message}
              {...register("title")}
            />

            <div className="grid gap-sm">
              <label
                htmlFor="contract-client"
                className="text-sm font-medium text-text-body"
              >
                클라이언트
              </label>
              <select
                id="contract-client"
                className={cn(
                  "select-caret min-h-11 rounded-sm border border-slate-300 bg-white px-md py-sm pr-2xl text-sm text-text-primary",
                  "focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30",
                  errors.client_id && "border-red-500",
                )}
                aria-invalid={errors.client_id ? true : undefined}
                aria-describedby={
                  errors.client_id ? "contract-client-error" : undefined
                }
                disabled={clients.length === 0}
                {...register("client_id")}
              >
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
              {errors.client_id ? (
                <p id="contract-client-error" className="text-xs text-red-600">
                  {errors.client_id.message}
                </p>
              ) : null}
            </div>

            <div className="grid gap-sm">
              <label
                htmlFor="contract-scope"
                className="text-sm font-medium text-text-body"
              >
                업무 범위
              </label>
              <textarea
                id="contract-scope"
                rows={7}
                placeholder="예: 브랜드 랜딩 페이지 디자인, 반응형 퍼블리싱, 기본 SEO 메타 설정"
                className={cn(
                  "rounded-sm border border-slate-300 bg-white px-md py-sm text-sm leading-relaxed text-text-primary",
                  "focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30",
                  errors.scope && "border-red-500",
                )}
                aria-invalid={errors.scope ? true : undefined}
                aria-describedby={errors.scope ? "contract-scope-error" : undefined}
                {...register("scope")}
              />
              {errors.scope ? (
                <p id="contract-scope-error" className="text-xs text-red-600">
                  {errors.scope.message}
                </p>
              ) : null}
            </div>

            <Controller
              control={control}
              name="amount"
              render={({ field }) => (
                <Input
                  label="계약 금액"
                  type="text"
                  inputMode="numeric"
                  placeholder="3,000,000"
                  error={errors.amount?.message}
                  name={field.name}
                  onBlur={field.onBlur}
                  value={formatAmountDisplay(field.value)}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/[^\d]/g, "");
                    field.onChange(digits === "" ? "" : Number(digits));
                  }}
                />
              )}
            />

            <div className="grid gap-lg sm:grid-cols-2 sm:items-start">
              <Input
                label="시작일"
                type="date"
                error={errors.start_date?.message}
                {...register("start_date")}
              />
              <Input
                label="종료일"
                type="date"
                error={errors.end_date?.message}
                {...register("end_date")}
              />
            </div>

            <Input
              label="지급기한"
              type="date"
              error={errors.due_date?.message}
              {...register("due_date")}
            />
          </div>

          {errors.root?.message ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-md py-sm text-sm text-red-700">
              {errors.root.message}
            </p>
          ) : null}

          {isGenerating ? (
            <AiProcessingNotice message="AI가 계약 초안을 작성하고 있어요. 최대 몇 분 정도 걸릴 수 있으니 창을 닫지 말고 잠시만 기다려 주세요." />
          ) : null}

          <div className="flex justify-end border-t border-surface-border pt-lg">
            <Button type="submit" disabled={isDisabled}>
              {isGenerating ? "초안 생성 중" : "초안 생성"}
            </Button>
          </div>
        </form>
      </Card>

      {draft ? (
        <Card>
          <div className="border-b border-surface-border pb-lg">
            <h3 className="text-lg font-semibold text-text-primary">
              {draft.title}
            </h3>
            <p className="mt-xs text-sm leading-relaxed text-text-muted">
              {draft.source === "ai"
                ? "AI 보강 초안이 생성되었습니다."
                : "AI를 사용할 수 없어 골격 초안으로 생성되었습니다."}
            </p>
          </div>

          <div className="mt-xl rounded-md border border-amber-200 bg-status-waiting-bg px-md py-sm text-xs leading-relaxed text-amber-800">
            AI 초안이며 법적 자문이 아닙니다. 계약 확정 전 전문가 검토를
            권장합니다.
          </div>

          <div className="mt-xl grid gap-lg">
            <div className="rounded-md bg-surface-muted px-md py-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                평문요약
              </p>
              <p className="mt-xs text-sm leading-relaxed text-text-body">
                {draft.plain_summary}
              </p>
            </div>

            <div className="grid gap-md">
              {draft.clauses.slice(0, 3).map((clause) => (
                <article
                  key={clause.title}
                  className="rounded-md border border-surface-border p-lg"
                >
                  <div className="flex flex-col gap-sm sm:flex-row sm:items-start sm:justify-between">
                    <h4 className="text-base font-semibold text-text-primary">
                      {clause.title}
                    </h4>
                    {clause.needs_review ? (
                      <span className="inline-flex w-fit rounded-full border border-amber-200 bg-amber-50 px-sm py-0.5 text-xs font-medium text-amber-700">
                        검토 필요
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-md whitespace-pre-wrap text-sm leading-relaxed text-text-body">
                    {clause.body}
                  </p>
                </article>
              ))}
            </div>
          </div>

          {isSaving ? (
            <div className="mt-xl">
              <AiProcessingNotice message="계약 초안을 확정해 저장하고 있어요. 최대 몇 분 정도 걸릴 수 있으니 창을 닫지 말고 잠시만 기다려 주세요." />
            </div>
          ) : null}

          <div className="mt-xl flex flex-col-reverse gap-sm border-t border-surface-border pt-lg sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              disabled={isSaving}
              onClick={() => setDraft(null)}
            >
              다시 입력
            </Button>
            <Button type="button" disabled={isSaving} onClick={saveDraft}>
              {isSaving ? "저장 중" : "초안 저장"}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
