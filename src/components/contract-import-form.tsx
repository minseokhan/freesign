"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createImportedContract,
  type ContractActionResult,
} from "@/app/(dashboard)/contracts/actions";
import { AiProcessingNotice } from "@/components/ai-processing-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  REQUIRED_CONTRACT_CLAUSES,
  type ContractClauseInput,
  type ContractImportInput,
} from "@/lib/validation/contract";
import type { ImportedContractExtract } from "@/services/ai/contract-import";

type ContractImportFormProps = {
  clients: Array<{
    id: string;
    name: string;
  }>;
};

type FieldErrors = NonNullable<
  Extract<ContractActionResult, { ok: false }>["fieldErrors"]
>;

const MAX_PDF_SIZE_BYTES = 5 * 1024 * 1024;

const STEPS = [
  { key: "upload", label: "PDF 업로드" },
  { key: "review", label: "검토" },
  { key: "save", label: "저장" },
] as const;

function buildFallbackExtract(): ImportedContractExtract {
  return {
    title: null,
    scope: null,
    amount: null,
    start_date: null,
    end_date: null,
    plain_summary: null,
    clauses: REQUIRED_CONTRACT_CLAUSES.map((title) => ({
      title,
      body: "[검토 필요]",
      plain_summary: "[검토 필요]",
      needs_review: true,
    })),
    source: "fallback",
  };
}

function hasReviewMarker(clause: ContractClauseInput) {
  return (
    clause.needs_review ||
    clause.body.includes("[검토 필요]") ||
    clause.plain_summary.includes("[검토 필요]")
  );
}

function firstError(fieldErrors: FieldErrors | undefined, field: string) {
  return fieldErrors?.[field as keyof ContractImportInput]?.[0] ?? null;
}

// 필드별 원문(주로 zod 기본 영어) 메시지는 표시하지 않고, 잘못된 필드 여부만 노출한다.
// 상단 루트 메시지("입력값을 확인해 주세요")와 빨간 테두리로 충분히 안내된다.
function hasFieldError(fieldErrors: FieldErrors | undefined, field: string) {
  return Boolean(firstError(fieldErrors, field));
}

function getParseErrorMessage(result: unknown) {
  if (
    result &&
    typeof result === "object" &&
    "error" in result &&
    typeof result.error === "string"
  ) {
    return result.error;
  }

  return "계약서 PDF를 분석하지 못했습니다.";
}

export function ContractImportForm({ clients }: ContractImportFormProps) {
  const router = useRouter();
  const [selectedClientId, setSelectedClientId] = useState(
    clients[0]?.id ?? "",
  );
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<ContractActionResult | null>(
    null,
  );
  const [isParsing, startParsing] = useTransition();
  const [isSaving, startSaving] = useTransition();
  const [extracted, setExtracted] = useState<ImportedContractExtract | null>(
    null,
  );
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [amount, setAmount] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [plainSummary, setPlainSummary] = useState("");
  const [clauses, setClauses] = useState<ContractClauseInput[]>(
    buildFallbackExtract().clauses,
  );

  const currentStep = extracted ? "review" : "upload";
  const fieldErrors =
    actionResult && !actionResult.ok ? actionResult.fieldErrors : undefined;
  const rootError = actionResult && !actionResult.ok ? actionResult.error : null;

  const applyExtract = (nextExtract: ImportedContractExtract) => {
    setExtracted(nextExtract);
    setTitle(nextExtract.title ?? "");
    setScope(nextExtract.scope ?? "");
    setAmount(nextExtract.amount ? String(nextExtract.amount) : "");
    setStartDate(nextExtract.start_date ?? "");
    setEndDate(nextExtract.end_date ?? "");
    setPlainSummary(nextExtract.plain_summary ?? "");
    setClauses(
      nextExtract.clauses.length > 0
        ? nextExtract.clauses
        : buildFallbackExtract().clauses,
    );
  };

  const updateClause = (
    index: number,
    patch: Partial<ContractClauseInput>,
  ) => {
    setClauses((current) =>
      current.map((clause, clauseIndex) =>
        clauseIndex === index ? { ...clause, ...patch } : clause,
      ),
    );
  };

  const handleFileChange = (file: File | null) => {
    setFileError(null);
    setSourceFile(null);

    if (!file) {
      return;
    }

    if (file.type !== "application/pdf") {
      setFileError("PDF 파일만 업로드할 수 있습니다.");
      return;
    }

    if (file.size > MAX_PDF_SIZE_BYTES) {
      setFileError("5MB 이하 PDF만 업로드할 수 있습니다.");
      return;
    }

    setSourceFile(file);
  };

  const parsePdf = () => {
    if (!sourceFile) {
      setFileError("PDF 파일을 업로드해 주세요.");
      return;
    }

    startParsing(async () => {
      setParseError(null);
      setActionResult(null);

      const formData = new FormData();
      formData.append("file", sourceFile);

      try {
        const response = await fetch("/api/contracts/import/parse", {
          method: "POST",
          body: formData,
        });
        const result = (await response.json()) as
          | { extracted: ImportedContractExtract }
          | { error?: string };

        if (!response.ok || !("extracted" in result)) {
          setParseError(getParseErrorMessage(result));
          applyExtract(buildFallbackExtract());
          return;
        }

        applyExtract(result.extracted);
      } catch {
        setParseError("계약서 PDF를 분석하지 못했습니다.");
        applyExtract(buildFallbackExtract());
      }
    });
  };

  const save = () => {
    if (!sourceFile) {
      setFileError("PDF 파일을 업로드해 주세요.");
      return;
    }

    startSaving(async () => {
      setActionResult(null);

      const formData = new FormData();
      formData.append("file", sourceFile);
      formData.append(
        "payload",
        JSON.stringify({
          client_id: selectedClientId,
          title,
          scope,
          amount: Number(amount),
          start_date: startDate,
          end_date: endDate,
          plain_summary: plainSummary,
          clauses,
        }),
      );

      const result = await createImportedContract(formData);
      setActionResult(result);

      if (result.ok) {
        router.push(`/contracts/${result.id}`);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-xl">
      <nav aria-label="계약 불러오기 단계" className="rounded-lg bg-white">
        <ol className="grid gap-sm sm:grid-cols-3">
          {STEPS.map((step, index) => {
            const isActive = step.key === currentStep;
            const isComplete =
              (step.key === "upload" && extracted) ||
              (step.key === "review" && isSaving);

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

      {!extracted ? (
        <Card>
          <div className="border-b border-surface-border pb-lg">
            <h3 className="text-lg font-semibold text-text-primary">
              계약서 PDF 업로드
            </h3>
            <p className="mt-xs text-sm leading-relaxed text-text-muted">
              PDF는 분석 단계에서 저장하지 않고, 검토 후 저장할 때 원본으로
              함께 보관합니다.
            </p>
          </div>

          <div className="mt-xl grid gap-lg">
            {clients.length === 0 ? (
              <p className="rounded-md border border-amber-200 bg-status-waiting-bg px-md py-sm text-sm text-amber-800">
                계약을 불러오기 전에 클라이언트를 먼저 등록해야 합니다.
              </p>
            ) : null}

            <div className="grid gap-sm">
              <label
                htmlFor="import-client"
                className="text-sm font-medium text-text-body"
              >
                클라이언트
              </label>
              <select
                id="import-client"
                value={selectedClientId}
                onChange={(event) => setSelectedClientId(event.target.value)}
                disabled={clients.length === 0}
                className="select-caret min-h-11 rounded-sm border border-slate-300 bg-white px-md py-sm pr-2xl text-sm text-text-primary focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30"
              >
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-sm">
              <label
                htmlFor="contract-pdf"
                className="text-sm font-medium text-text-body"
              >
                계약서 PDF
              </label>
              <input
                id="contract-pdf"
                type="file"
                accept="application/pdf"
                onChange={(event) =>
                  handleFileChange(event.target.files?.[0] ?? null)
                }
                aria-describedby={
                  fileError ? "contract-pdf-error" : "contract-pdf-help"
                }
                aria-invalid={fileError ? true : undefined}
                className={cn(
                  "min-h-11 rounded-sm border border-slate-300 bg-white px-md py-sm text-sm text-text-primary file:mr-md file:rounded-md file:border-0 file:bg-surface-muted file:px-md file:py-xs file:text-sm file:font-medium file:text-text-body",
                  "focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30",
                  fileError && "border-red-500",
                )}
              />
              {fileError ? (
                <p id="contract-pdf-error" className="text-xs text-red-600">
                  {fileError}
                </p>
              ) : (
                <p id="contract-pdf-help" className="text-xs text-text-muted">
                  application/pdf, 최대 5MB
                </p>
              )}
            </div>

            {parseError ? (
              <p
                role="alert"
                className="rounded-md border border-amber-200 bg-status-waiting-bg px-md py-sm text-sm text-amber-800"
              >
                {parseError} 직접 입력할 수 있는 검토 화면으로 이동했습니다.
              </p>
            ) : null}
          </div>

          {isParsing ? (
            <div className="mt-xl">
              <AiProcessingNotice message="AI가 계약서를 분석하고 있어요. 최대 몇 분 정도 걸릴 수 있으니 창을 닫지 말고 잠시만 기다려 주세요." />
            </div>
          ) : null}

          <div className="mt-xl flex justify-end border-t border-surface-border pt-lg">
            <Button
              type="button"
              disabled={
                clients.length === 0 || !sourceFile || isParsing || isSaving
              }
              onClick={parsePdf}
            >
              {isParsing ? "분석 중" : "분석"}
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="border-b border-surface-border pb-lg">
            <h3 className="text-lg font-semibold text-text-primary">
              추출 내용 검토
            </h3>
            <p className="mt-xs text-sm leading-relaxed text-text-muted">
              금액, 기간, 조항을 확인한 뒤 성사된 계약으로 저장합니다.
              (별도 서명 단계는 없습니다.)
            </p>
          </div>

          <div className="mt-xl rounded-md border border-amber-200 bg-status-waiting-bg px-md py-sm text-xs leading-relaxed text-amber-800">
            PDF 분석 결과는 검토용 초안이며 법적 자문이 아닙니다. 계약 확정
            전 전문가 검토를 권장합니다.
          </div>

          {parseError ? (
            <p
              role="alert"
              className="mt-lg rounded-md border border-amber-200 bg-status-waiting-bg px-md py-sm text-sm text-amber-800"
            >
              {parseError} 빈 초안으로 계속 진행합니다.
            </p>
          ) : null}

          {rootError ? (
            <p
              role="alert"
              className="mt-lg rounded-md border border-red-200 bg-red-50 px-md py-sm text-sm text-red-700"
            >
              {rootError}
            </p>
          ) : null}

          <div className="mt-xl grid gap-lg">
            <Input
              label="계약 제목"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-invalid={hasFieldError(fieldErrors, "title") || undefined}
              className={cn(
                hasFieldError(fieldErrors, "title") && "border-red-500",
              )}
            />

            <div className="grid gap-sm">
              <label
                htmlFor="import-scope"
                className="text-sm font-medium text-text-body"
              >
                업무 범위
              </label>
              <textarea
                id="import-scope"
                rows={5}
                value={scope}
                onChange={(event) => setScope(event.target.value)}
                className={cn(
                  "rounded-sm border border-slate-300 bg-white px-md py-sm text-sm leading-relaxed text-text-primary",
                  "focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30",
                  hasFieldError(fieldErrors, "scope") && "border-red-500",
                )}
                aria-invalid={hasFieldError(fieldErrors, "scope") || undefined}
              />
            </div>

            <div className="grid gap-sm">
              <label
                htmlFor="import-plain-summary"
                className="text-sm font-medium text-text-body"
              >
                평문요약
              </label>
              <textarea
                id="import-plain-summary"
                rows={3}
                value={plainSummary}
                onChange={(event) => setPlainSummary(event.target.value)}
                placeholder="계약 전체를 2~3문장으로 요약합니다. 비워 두면 표시하지 않습니다."
                className="rounded-sm border border-slate-300 bg-white px-md py-sm text-sm leading-relaxed text-text-primary focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30"
              />
            </div>

            <Input
              label="계약 금액"
              type="number"
              min={1}
              step={1}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-invalid={hasFieldError(fieldErrors, "amount") || undefined}
              className={cn(
                hasFieldError(fieldErrors, "amount") && "border-red-500",
              )}
            />

            <div className="grid gap-lg sm:grid-cols-2 sm:items-start">
              <Input
                label="시작일"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                aria-invalid={
                  hasFieldError(fieldErrors, "start_date") || undefined
                }
                className={cn(
                  hasFieldError(fieldErrors, "start_date") && "border-red-500",
                )}
              />
              <Input
                label="종료일"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                aria-invalid={
                  hasFieldError(fieldErrors, "end_date") || undefined
                }
                className={cn(
                  hasFieldError(fieldErrors, "end_date") && "border-red-500",
                )}
              />
            </div>
          </div>

          <div className="mt-xl space-y-lg">
            {clauses.map((clause, index) => {
              const needsReview = hasReviewMarker(clause);

              return (
                <article
                  key={clause.title}
                  className={cn(
                    "rounded-lg border border-surface-border bg-white p-xl shadow-sm",
                    needsReview && "border-amber-200 bg-amber-50/40",
                  )}
                >
                  <div className="flex flex-col gap-sm border-b border-surface-border pb-lg sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                        조항 {index + 1}
                      </p>
                      <h4 className="mt-xs text-lg font-semibold text-text-primary">
                        {clause.title}
                      </h4>
                    </div>
                    {needsReview ? (
                      <Badge variant="warning">검토 필요</Badge>
                    ) : null}
                  </div>

                  <div className="mt-xl grid gap-lg">
                    <div className="grid gap-sm">
                      <label
                        htmlFor={`import-clause-body-${index}`}
                        className="text-sm font-medium text-text-body"
                      >
                        {clause.title} 조항 본문
                      </label>
                      <textarea
                        id={`import-clause-body-${index}`}
                        rows={6}
                        value={clause.body}
                        onChange={(event) =>
                          updateClause(index, { body: event.target.value })
                        }
                        className="rounded-sm border border-slate-300 bg-white px-md py-sm text-sm leading-relaxed text-text-primary focus:border-brand-ring focus:outline-none focus:ring-2 focus:ring-brand-ring/30"
                      />
                    </div>

                    <label className="flex min-h-11 items-center gap-sm text-sm font-medium text-text-body">
                      <input
                        type="checkbox"
                        checked={clause.needs_review}
                        onChange={(event) =>
                          updateClause(index, {
                            needs_review: event.target.checked,
                          })
                        }
                        className="size-4 rounded border-slate-300 text-brand-primary focus:ring-brand-ring"
                      />
                      검토 필요로 표시
                    </label>
                  </div>
                </article>
              );
            })}
          </div>

          {firstError(fieldErrors, "clauses") ? (
            <p className="mt-lg rounded-md border border-red-200 bg-red-50 px-md py-sm text-sm text-red-700">
              {firstError(fieldErrors, "clauses")}
            </p>
          ) : null}

          <div className="mt-xl flex flex-col-reverse gap-sm border-t border-surface-border pt-lg sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              disabled={isSaving}
              onClick={() => setExtracted(null)}
            >
              다시 업로드
            </Button>
            <Button type="button" disabled={isSaving} onClick={save}>
              {isSaving ? "저장 중" : "저장"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
