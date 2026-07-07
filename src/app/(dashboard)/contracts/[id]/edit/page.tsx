import Link from "next/link";
import { notFound } from "next/navigation";

import { ContractClausesForm } from "@/components/contract-clauses-form";
import { ContractStatusBadge } from "@/components/contract-status-badge";
import { Card } from "@/components/ui/card";
import { notDeleted } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { contractClausesSchema } from "@/lib/validation/contract";

type ContractEditPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ContractEditPage({
  params,
}: ContractEditPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await notDeleted(
    supabase
      .from("contracts")
      .select("id,title,status,clauses,client:clients(name)")
      .eq("id", id),
  ).maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    notFound();
  }

  const parsedClauses = contractClausesSchema.safeParse(data.clauses);

  return (
    <div className="mx-auto max-w-3xl space-y-xl">
      <div className="flex flex-col gap-lg sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link
            href={`/contracts/${data.id}`}
            className="text-sm font-medium text-text-muted hover:text-brand-primary"
          >
            계약 상세
          </Link>
          <div className="mt-sm flex flex-wrap items-center gap-sm">
            <h2 className="break-words text-2xl font-semibold tracking-tight text-text-primary">
              조항 편집
            </h2>
            <ContractStatusBadge status={data.status} />
          </div>
          <p className="mt-sm text-sm leading-relaxed text-text-muted">
            {data.title} · {data.client?.name ?? "클라이언트 없음"}
          </p>
        </div>
      </div>

      {data.status !== "draft" ? (
        <Card>
          <div className="border-b border-surface-border pb-lg">
            <h3 className="text-lg font-semibold text-text-primary">
              조항을 편집할 수 없습니다
            </h3>
            <p className="mt-xs text-sm leading-relaxed text-text-muted">
              서명 이후 문서 무결성을 위해 초안 상태의 계약만 조항을 수정할 수
              있습니다.
            </p>
          </div>
          <div className="mt-xl flex justify-end">
            <Link
              href={`/contracts/${data.id}`}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-surface-border bg-white px-lg py-sm text-sm font-medium text-text-body transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
            >
              상세로 돌아가기
            </Link>
          </div>
        </Card>
      ) : null}

      {data.status === "draft" && parsedClauses.success ? (
        <ContractClausesForm
          contractId={data.id}
          clauses={parsedClauses.data}
        />
      ) : null}

      {data.status === "draft" && !parsedClauses.success ? (
        <Card>
          <div className="border-b border-surface-border pb-lg">
            <h3 className="text-lg font-semibold text-text-primary">
              조항 구조를 확인해 주세요
            </h3>
            <p className="mt-xs text-sm leading-relaxed text-text-muted">
              필수 조항이 누락되었거나 저장된 조항 형식이 올바르지 않아 편집할
              수 없습니다.
            </p>
          </div>
          <div className="mt-xl flex justify-end">
            <Link
              href={`/contracts/${data.id}`}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-surface-border bg-white px-lg py-sm text-sm font-medium text-text-body transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
            >
              상세로 돌아가기
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
