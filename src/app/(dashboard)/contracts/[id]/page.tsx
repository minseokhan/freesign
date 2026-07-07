import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";

import { ContractStatusBadge } from "@/components/contract-status-badge";
import { SignaturePad } from "@/components/signature-pad";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  getAvailableContractStatusTransitions,
  type ContractStatus,
} from "@/lib/contract-status";
import { notDeleted } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

import { transitionContractStatus } from "../actions";

type ContractRow = Pick<
  Database["public"]["Tables"]["contracts"]["Row"],
  | "id"
  | "title"
  | "scope"
  | "amount"
  | "start_date"
  | "end_date"
  | "status"
  | "clauses"
  | "contract_pdf_url"
  | "signature_image_path"
  | "doc_hash"
  | "signature_meta"
  | "created_at"
> & {
  client: {
    name: string;
  } | null;
};

type ContractEventRow = Pick<
  Database["public"]["Tables"]["contract_events"]["Row"],
  "id" | "actor" | "from_status" | "to_status" | "event_type" | "created_at"
>;

type ContractClause = {
  title: string;
  body: string;
  plain_summary: string;
  needs_review: boolean;
};

type SignatureMeta = {
  signer: string;
  signed_at: string;
  ip: string;
  ua: string;
};

type ContractDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

const SIGNATURE_BUCKET = "contract-artifacts";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(date: string) {
  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getDate()).padStart(2, "0");

  return `${year}.${month}.${day}`;
}

function isClause(value: Json): value is {
  title: string;
  body: string;
  plain_summary: string;
  needs_review?: boolean;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.title === "string" &&
    typeof value.body === "string" &&
    typeof value.plain_summary === "string"
  );
}

function normalizeClauses(clauses: Json): ContractClause[] {
  if (!Array.isArray(clauses)) {
    return [];
  }

  return clauses.filter(isClause).map((clause) => ({
    title: clause.title,
    body: clause.body,
    plain_summary: clause.plain_summary,
    needs_review: clause.needs_review === true,
  }));
}

function isSignatureMeta(value: Json): value is SignatureMeta {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.signer === "string" &&
    typeof value.signed_at === "string" &&
    typeof value.ip === "string" &&
    typeof value.ua === "string"
  );
}

function DetailItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
        {label}
      </dt>
      <dd className="mt-xs text-sm leading-relaxed text-text-body">
        {value ?? "등록되지 않음"}
      </dd>
    </div>
  );
}

function PlaceholderButton({ children }: { children: string }) {
  return (
    <button
      type="button"
      disabled
      className="inline-flex min-h-11 items-center justify-center rounded-md border border-surface-border bg-surface-muted px-lg py-sm text-sm font-medium text-text-disabled"
    >
      {children}
    </button>
  );
}

function PdfLink({ contractId }: { contractId: string }) {
  return (
    <Link
      href={`/api/contracts/${contractId}/pdf`}
      target="_blank"
      className="inline-flex min-h-11 items-center justify-center rounded-md border border-surface-border bg-white px-lg py-sm text-sm font-medium text-text-body transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
    >
      PDF
    </Link>
  );
}

const transitionLabels: Partial<Record<ContractStatus, string>> = {
  active: "진행 시작",
  done: "완료 처리",
  draft: "초안으로 되돌리기",
  canceled: "계약 취소",
};

function getTransitionButtonClassName(status: ContractStatus) {
  if (status === "canceled" || status === "draft") {
    return "inline-flex min-h-11 items-center justify-center rounded-md border border-surface-border bg-white px-lg py-sm text-sm font-medium text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2";
  }

  return "inline-flex min-h-11 items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2";
}

function getEventDescription(event: ContractEventRow) {
  if (event.event_type === "signed") {
    return "간이 서명 완료";
  }

  if (event.event_type === "contract.status_changed") {
    return "계약 상태 변경";
  }

  return event.event_type;
}

export default async function ContractDetailPage({
  params,
}: ContractDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await notDeleted(
    supabase
      .from("contracts")
      .select(
        "id,title,scope,amount,start_date,end_date,status,clauses,contract_pdf_url,signature_image_path,doc_hash,signature_meta,created_at,client:clients(name)",
      )
      .eq("id", id),
  ).maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    notFound();
  }

  const contract = data as ContractRow;

  const { data: eventData, error: eventError } = await supabase
    .from("contract_events")
    .select("id,actor,from_status,to_status,event_type,created_at")
    .eq("contract_id", contract.id)
    .order("created_at", { ascending: true });

  if (eventError) {
    throw eventError;
  }

  const events = (eventData ?? []) as ContractEventRow[];
  const clauses = normalizeClauses(contract.clauses);
  const signatureMeta = isSignatureMeta(contract.signature_meta)
    ? contract.signature_meta
    : null;
  const signatureImageUrl = contract.signature_image_path
    ? await createSignatureImageUrl(supabase, contract.signature_image_path)
    : null;
  const statusTransitions = getAvailableContractStatusTransitions(
    contract.status,
  ).filter((status) => status !== "signed");

  return (
    <div className="mx-auto max-w-3xl space-y-xl">
      <div className="flex flex-col gap-lg sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link
            href="/contracts"
            className="text-sm font-medium text-text-muted hover:text-brand-primary"
          >
            계약 목록
          </Link>
          <div className="mt-sm flex flex-wrap items-center gap-sm">
            <h2 className="break-words text-2xl font-semibold tracking-tight text-text-primary">
              {contract.title}
            </h2>
            <ContractStatusBadge status={contract.status} />
          </div>
          <p className="mt-sm text-sm leading-relaxed text-text-muted">
            {contract.client?.name ?? "클라이언트 없음"}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-sm">
          {contract.status === "draft" ? (
            <Link
              href={`/contracts/${contract.id}/edit`}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
            >
              조항 편집
            </Link>
          ) : null}
          <PdfLink contractId={contract.id} />
        </div>
      </div>

      <Card>
        <div className="border-b border-surface-border pb-lg">
          <h3 className="text-lg font-semibold text-text-primary">기본 정보</h3>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            계약의 금액, 기간, 현재 상태를 확인합니다.
          </p>
        </div>
        <dl className="mt-xl grid gap-lg sm:grid-cols-2">
          <DetailItem label="금액" value={formatCurrency(contract.amount)} />
          <DetailItem
            label="기간"
            value={`${formatDate(contract.start_date)} - ${formatDate(
              contract.end_date,
            )}`}
          />
          <DetailItem label="문서 해시" value={contract.doc_hash} />
          <DetailItem
            label="PDF 저장"
            value={contract.contract_pdf_url ? "저장됨" : "아직 없음"}
          />
        </dl>
      </Card>

      <div className="rounded-md border border-amber-200 bg-status-waiting-bg px-md py-sm text-xs leading-relaxed text-amber-800">
        AI 초안이며 법적 자문이 아닙니다. 계약 확정 전 전문가 검토를
        권장합니다.
      </div>

      <Card>
        <div className="border-b border-surface-border pb-lg">
          <h3 className="text-lg font-semibold text-text-primary">업무 범위</h3>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            계약서 조항의 기준이 되는 원문 범위입니다.
          </p>
        </div>
        <p className="mt-xl whitespace-pre-wrap text-sm leading-relaxed text-text-body">
          {contract.scope}
        </p>
      </Card>

      <Card>
        <div className="border-b border-surface-border pb-lg">
          <h3 className="text-lg font-semibold text-text-primary">
            조항과 평문요약
          </h3>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            조항별 본문과 프리랜서가 빠르게 확인할 수 있는 요약입니다.
          </p>
        </div>
        {clauses.length === 0 ? (
          <p className="mt-xl text-sm leading-relaxed text-text-muted">
            아직 표시할 조항이 없습니다.
          </p>
        ) : (
          <div className="mt-xl space-y-lg">
            {clauses.map((clause, index) => (
              <article
                key={`${clause.title}-${index}`}
                className="rounded-md border border-surface-border p-lg"
              >
                <div className="flex flex-col gap-sm sm:flex-row sm:items-start sm:justify-between">
                  <h4 className="text-base font-semibold text-text-primary">
                    {clause.title}
                  </h4>
                  {clause.needs_review ? (
                    <Badge variant="warning">검토 필요</Badge>
                  ) : null}
                </div>
                <p className="mt-md whitespace-pre-wrap text-sm leading-relaxed text-text-body">
                  {clause.body}
                </p>
                <div className="mt-lg rounded-md bg-surface-muted px-md py-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    평문요약
                  </p>
                  <p className="mt-xs text-sm leading-relaxed text-text-body">
                    {clause.plain_summary}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="border-b border-surface-border pb-lg">
          <h3 className="text-lg font-semibold text-text-primary">서명</h3>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            v1 간이 서명은 private Storage에 저장하고, 문서 해시는 Provider로
            산출합니다.
          </p>
        </div>
        {contract.status === "draft" ? (
          <div className="mt-xl">
            <SignaturePad contractId={contract.id} />
          </div>
        ) : signatureImageUrl ? (
          <div className="mt-xl space-y-lg">
            <Image
              src={signatureImageUrl}
              alt="저장된 계약 서명"
              width={720}
              height={240}
              unoptimized
              className="h-auto w-full rounded-sm border border-surface-border bg-white"
            />
            <dl className="grid gap-lg sm:grid-cols-2">
              <DetailItem label="서명자" value={signatureMeta?.signer ?? null} />
              <DetailItem
                label="서명 시각"
                value={
                  signatureMeta ? formatDate(signatureMeta.signed_at) : null
                }
              />
            </dl>
            <div className="rounded-md border border-amber-200 bg-status-waiting-bg px-md py-sm text-xs leading-relaxed text-amber-800">
              v1 간이 서명은 법적 효력이 없는 기록용 서명입니다. 서명 후
              조항은 읽기 전용이며, 수정하려면 초안으로 되돌린 뒤 다시
              서명해야 합니다.
            </div>
          </div>
        ) : (
          <p className="mt-xl text-sm leading-relaxed text-text-muted">
            저장된 서명 이미지가 없습니다.
          </p>
        )}
      </Card>

      <Card>
        <div className="border-b border-surface-border pb-lg">
          <h3 className="text-lg font-semibold text-text-primary">
            다음 단계
          </h3>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            현재 계약 상태에서 가능한 다음 작업만 표시됩니다.
          </p>
        </div>
        <div className="mt-xl grid gap-md sm:grid-cols-2">
          {statusTransitions.length === 0 ? (
            <p className="text-sm leading-relaxed text-text-muted">
              현재 상태에서 변경할 수 있는 상태가 없습니다.
            </p>
          ) : (
            statusTransitions.map((status) => (
              <form
                key={status}
                action={async () => {
                  "use server";

                  await transitionContractStatus(contract.id, status);
                }}
              >
                <button
                  type="submit"
                  className={getTransitionButtonClassName(status)}
                >
                  {transitionLabels[status] ?? "상태 변경"}
                </button>
              </form>
            ))
          )}
          <PlaceholderButton>하위 인보이스</PlaceholderButton>
        </div>
      </Card>

      <Card>
        <div className="border-b border-surface-border pb-lg">
          <h3 className="text-lg font-semibold text-text-primary">
            이력 타임라인
          </h3>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            계약 상태 전이는 append-only 이벤트로 기록됩니다.
          </p>
        </div>
        {events.length === 0 ? (
          <p className="mt-xl text-sm leading-relaxed text-text-muted">
            아직 기록된 이력이 없습니다.
          </p>
        ) : (
          <ol className="mt-xl space-y-lg border-l border-surface-border pl-lg">
            {events.map((event) => (
              <li key={event.id} className="relative">
                <span
                  aria-hidden="true"
                  className="absolute -left-[25px] top-1.5 size-3 rounded-full border-2 border-white bg-brand-primary"
                />
                <div className="flex flex-col gap-xs sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm font-medium text-text-primary">
                    {event.from_status
                      ? `${event.from_status} -> ${event.to_status}`
                      : event.to_status}
                  </p>
                  <time className="text-xs text-text-muted">
                    {formatDate(event.created_at)}
                  </time>
                </div>
                <p className="mt-xs text-sm leading-relaxed text-text-body">
                  {getEventDescription(event)} · {event.actor}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

async function createSignatureImageUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  key: string,
) {
  const { data } = await supabase.storage
    .from(SIGNATURE_BUCKET)
    .createSignedUrl(key, 300);

  return data?.signedUrl ?? null;
}
