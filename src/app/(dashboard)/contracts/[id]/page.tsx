import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";

import { ContractDeleteButton } from "@/components/contract-delete-button";
import { ContractStatusTransitionButton } from "@/components/contract-status-transition-button";
import {
  ContractStatusBadge,
  getContractStatusMeta,
} from "@/components/contract-status-badge";
import { SignatureRequestForm } from "@/components/signature-request-form";
import { SignatureRequestControls } from "@/components/signature-request-controls";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  getAvailableContractStatusTransitions,
  type ContractStatus,
} from "@/lib/contract-status";
import {
  contractEventLabel,
  formatContractEventActor,
} from "@/lib/contracts/event-labels";
import { notDeleted } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

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
  | "plain_summary"
  | "signature_image_path"
  | "doc_hash"
  | "signature_meta"
  | "source_pdf_url"
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

type SignatureRequestRow = Pick<
  Database["public"]["Tables"]["signature_requests"]["Row"],
  "id" | "recipient_email" | "recipient_name" | "expires_at" | "first_viewed_at"
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

function shortenHash(hash: string) {
  return `${hash.slice(0, 16)}…${hash.slice(-8)}`;
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

function PdfLink({ contractId }: { contractId: string }) {
  return (
    <Link
      href={`/api/contracts/${contractId}/pdf`}
      target="_blank"
      className="inline-flex min-h-11 items-center justify-center rounded-md border border-surface-border bg-white px-lg py-sm text-sm font-medium text-text-body transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
    >
      서식 PDF
    </Link>
  );
}

function SourcePdfLink({ contractId }: { contractId: string }) {
  return (
    <Link
      href={`/api/contracts/${contractId}/source-pdf`}
      target="_blank"
      className="inline-flex min-h-11 items-center justify-center rounded-md border border-surface-border bg-white px-lg py-sm text-sm font-medium text-text-body transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
    >
      원본 PDF
    </Link>
  );
}

function statusLabel(status: string | null) {
  return status ? getContractStatusMeta(status).label : "생성";
}

function displayTitle(title: string) {
  return title.replace(/\s*초안\s*$/, "").trim() || title;
}

const transitionLabels: Partial<Record<ContractStatus, string>> = {
  active: "진행 시작",
  done: "완료 처리",
  draft: "초안으로 되돌리기",
  canceled: "계약 취소",
};


export default async function ContractDetailPage({
  params,
}: ContractDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await notDeleted(
    supabase
      .from("contracts")
      .select(
        "id,title,scope,amount,start_date,end_date,status,clauses,plain_summary,signature_image_path,doc_hash,signature_meta,source_pdf_url,created_at,client:clients(name)",
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

  // sent 계약의 대기 중 서명 요청 현황 — RSC에서 RLS 스코프로 직접 조회한다.
  let signatureRequest: SignatureRequestRow | null = null;

  if (contract.status === "sent") {
    const { data: requestData, error: requestError } = await supabase
      .from("signature_requests")
      .select("id,recipient_email,recipient_name,expires_at,first_viewed_at")
      .eq("contract_id", contract.id)
      .eq("status", "pending")
      .maybeSingle();

    if (requestError) {
      throw requestError;
    }

    signatureRequest = requestData as SignatureRequestRow | null;
  }

  // 맞서명(counterparty) 서명 존재 여부 — legalEffect 표기·완결증명서 링크 분기 기준.
  let hasCounterpartySignature = false;

  if (contract.status !== "draft") {
    const { data: counterpartyData, error: counterpartyError } = await supabase
      .from("contract_signatures")
      .select("id")
      .eq("contract_id", contract.id)
      .eq("party", "counterparty")
      .limit(1)
      .maybeSingle();

    if (counterpartyError) {
      throw counterpartyError;
    }

    hasCounterpartySignature = counterpartyData !== null;
  }

  const events = (eventData ?? []) as ContractEventRow[];
  const clauses = normalizeClauses(contract.clauses);
  // 계약 전체 요약이 있으면(새 계약) 상단에 1회만 노출하고 조항별 요약은 생략한다.
  // 불러오기 계약은 계약 레벨 요약이 없어(null) 조항별 요약을 개별 노출한다.
  const contractSummary = contract.plain_summary?.trim() || null;
  const signatureMeta = isSignatureMeta(contract.signature_meta)
    ? contract.signature_meta
    : null;
  const signatureImageUrl = contract.signature_image_path
    ? await createSignatureImageUrl(supabase, contract.signature_image_path)
    : null;
  const statusTransitions = getAvailableContractStatusTransitions(
    contract.status,
    { hasCounterpartySignature },
  ).filter((status) => status !== "signed");
  // 다음 단계 버튼을 2열 그리드에서 시계방향(진행/완료 → 인보이스 → 취소 → 초안 되돌리기)으로 배치.
  const forwardTransitions = statusTransitions.filter(
    (status) => status !== "draft" && status !== "canceled",
  );
  const rollbackTransition = statusTransitions.includes("draft") ? "draft" : null;
  const cancelTransition = statusTransitions.includes("canceled")
    ? "canceled"
    : null;
  const canIssueInvoice = contract.status !== "canceled";
  // 발주처가 보낸 원본 PDF로 성사된 계약. 자체 간이 서명 대신 원본이 증빙이다.
  const isImported = contract.source_pdf_url != null;

  return (
    <div className="mx-auto max-w-3xl space-y-xl">
      <div>
        <Link
          href="/contracts"
          className="text-sm font-medium text-text-muted hover:text-brand-primary"
        >
          계약 목록
        </Link>
        <div className="mt-sm flex flex-col gap-lg sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-sm">
              <h2 className="break-words text-2xl font-semibold tracking-tight text-text-primary">
                {displayTitle(contract.title)}
              </h2>
              <ContractStatusBadge status={contract.status} />
            </div>
            <p className="mt-sm text-sm leading-relaxed text-text-muted">
              {contract.client?.name ?? "클라이언트 없음"}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-start gap-sm">
            {contract.status === "draft" ? (
              <Link
                href={`/contracts/${contract.id}/edit`}
                className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
              >
                조항 편집
              </Link>
            ) : null}
            {isImported ? <SourcePdfLink contractId={contract.id} /> : null}
            <PdfLink contractId={contract.id} />
            <ContractDeleteButton
              contractId={contract.id}
              blocked={hasCounterpartySignature}
            />
          </div>
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
        </dl>
        <div className="mt-lg">
          <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
            문서 해시
          </dt>
          <dd className="mt-xs break-all font-mono text-sm leading-relaxed text-text-body">
            {contract.doc_hash ?? "등록되지 않음"}
          </dd>
        </div>
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
        {contractSummary ? (
          <div className="mt-xl rounded-md bg-surface-muted px-md py-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              평문요약
            </p>
            <p className="mt-xs text-sm leading-relaxed text-text-body">
              {contractSummary}
            </p>
          </div>
        ) : null}
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
                {contractSummary ? null : (
                  <div className="mt-lg rounded-md bg-surface-muted px-md py-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                      평문요약
                    </p>
                    <p className="mt-xs text-sm leading-relaxed text-text-body">
                      {clause.plain_summary}
                    </p>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </Card>

      {isImported ? null : (
      <Card>
        <div className="border-b border-surface-border pb-lg">
          <h3 className="text-lg font-semibold text-text-primary">서명</h3>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            내 서명과 함께 상대방에게 이메일 서명 요청을 보내 양 당사자
            서명으로 계약을 체결합니다.
          </p>
        </div>
        {contract.status === "draft" ? (
          <div className="mt-xl">
            <SignatureRequestForm contractId={contract.id} />
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
              <DetailItem
                label="서명 구분"
                value={
                  hasCounterpartySignature
                    ? "양 당사자 동의 서명 · 이메일 소유확인 수준"
                    : "내 서명 · 상대방 서명 대기 중"
                }
              />
              {contract.doc_hash ? (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    문서 지문 (SHA-256)
                  </dt>
                  {/* 전문은 title 툴팁과 상단 기본 정보 카드에서 복사할 수 있다(LEGAL §B). */}
                  <dd
                    className="mt-xs font-mono text-sm leading-relaxed text-text-body"
                    title={contract.doc_hash}
                  >
                    {shortenHash(contract.doc_hash)}
                  </dd>
                </div>
              ) : null}
            </dl>
            {hasCounterpartySignature ? (
              <>
                <Link
                  href={`/api/contracts/${contract.id}/certificate`}
                  target="_blank"
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-surface-border bg-white px-lg py-sm text-sm font-medium text-text-body transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
                >
                  완결증명서 PDF
                </Link>
                <div className="rounded-md border border-amber-200 bg-status-waiting-bg px-md py-sm text-xs leading-relaxed text-amber-800">
                  양 당사자 동의 서명은 이메일 링크 소유확인 수준의
                  전자서명입니다. 맞서명이 완료된 계약은 삭제하거나 초안으로
                  되돌릴 수 없으며, 무효화가 필요하면 &lsquo;계약 취소&rsquo;를
                  사용하세요.
                </div>
              </>
            ) : (
              <div className="rounded-md border border-amber-200 bg-status-waiting-bg px-md py-sm text-xs leading-relaxed text-amber-800">
                아직 상대방 서명 전입니다. 위 서명은 요청자 본인 서명이며,
                상대방이 이메일 링크로 서명을 완료하면 양 당사자 동의
                서명으로 계약이 체결됩니다.
              </div>
            )}
          </div>
        ) : (
          <p className="mt-xl text-sm leading-relaxed text-text-muted">
            저장된 서명 이미지가 없습니다.
          </p>
        )}
      </Card>
      )}

      {signatureRequest ? (
        <Card>
          <div className="border-b border-surface-border pb-lg">
            <h3 className="text-lg font-semibold text-text-primary">
              상대방 서명 요청 현황
            </h3>
            <p className="mt-xs text-sm leading-relaxed text-text-muted">
              상대방이 이메일의 서명 링크로 서명하면 계약이 서명완료 상태가
              됩니다.
            </p>
          </div>
          <dl className="mt-xl grid gap-lg sm:grid-cols-2">
            <DetailItem
              label="수신자 이메일"
              value={signatureRequest.recipient_email}
            />
            <DetailItem
              label="수신자 이름"
              value={signatureRequest.recipient_name}
            />
            <DetailItem
              label="만료일"
              value={formatDate(signatureRequest.expires_at)}
            />
            <DetailItem
              label="열람 시각"
              value={
                signatureRequest.first_viewed_at
                  ? formatDate(signatureRequest.first_viewed_at)
                  : "아직 열람 전"
              }
            />
          </dl>
          <div className="mt-xl">
            <SignatureRequestControls contractId={contract.id} />
          </div>
        </Card>
      ) : null}

      <Card>
        <div className="border-b border-surface-border pb-lg">
          <h3 className="text-lg font-semibold text-text-primary">
            다음 단계
          </h3>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            현재 계약 상태에서 가능한 다음 작업만 표시됩니다.
          </p>
        </div>
        {forwardTransitions.length === 0 &&
        !canIssueInvoice &&
        !rollbackTransition &&
        !cancelTransition ? (
          <p className="mt-xl text-sm leading-relaxed text-text-muted">
            현재 상태에서 진행할 수 있는 작업이 없습니다.
          </p>
        ) : (
          <div className="mt-xl grid gap-md sm:grid-cols-2">
            {forwardTransitions.map((status) => (
              <ContractStatusTransitionButton
                key={status}
                contractId={contract.id}
                status={status}
                label={transitionLabels[status] ?? "상태 변경"}
                variant="primary"
              />
            ))}
            {canIssueInvoice ? (
              <Link
                href={`/invoices/new?contract=${contract.id}`}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-surface-border bg-white px-lg py-sm text-sm font-medium text-text-body transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
              >
                인보이스 발행
              </Link>
            ) : null}
            {rollbackTransition ? (
              <ContractStatusTransitionButton
                contractId={contract.id}
                status={rollbackTransition}
                label={transitionLabels[rollbackTransition] ?? "상태 변경"}
                variant="danger"
              />
            ) : null}
            {cancelTransition ? (
              <ContractStatusTransitionButton
                contractId={contract.id}
                status={cancelTransition}
                label={transitionLabels[cancelTransition] ?? "상태 변경"}
                variant="danger"
                confirm={{
                  title: "계약을 취소할까요?",
                  description:
                    "계약이 취소 상태로 무효화됩니다. 이력에 취소 기록이 남으며, 되돌릴 수 없습니다.",
                }}
              />
            ) : null}
          </div>
        )}
      </Card>

      <Card>
        <div className="border-b border-surface-border pb-lg">
          <h3 className="text-lg font-semibold text-text-primary">
            이력 타임라인
          </h3>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            계약이 언제 어떤 상태로 바뀌었는지 남기는 변경 기록입니다. 분쟁 시
            &ldquo;계약 → 서명 → 입금&rdquo; 증빙 체인의 근거가 됩니다.
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
                    {event.event_type === "contract.imported"
                      ? "계약 등록"
                      : event.from_status &&
                          event.from_status !== event.to_status
                        ? `${statusLabel(event.from_status)} → ${statusLabel(
                            event.to_status,
                          )}`
                        : statusLabel(event.to_status)}
                  </p>
                  <time className="text-xs text-text-muted">
                    {formatDate(event.created_at)}
                  </time>
                </div>
                <p className="mt-xs text-sm leading-relaxed text-text-body">
                  {contractEventLabel(event.event_type)} ·{" "}
                  {formatContractEventActor(event.actor)}
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
