import Link from "next/link";
import { notFound } from "next/navigation";

import { UpgradeCard } from "@/components/billing/upgrade-cta";
import { DunningReviewPanel } from "@/components/dunning-review-panel";
import { InvoiceDeleteButton } from "@/components/invoice-delete-button";
import { InvoiceIssuedLinkProvider } from "@/components/invoice-issued-link";
import { InvoicePaymentToggle } from "@/components/invoice-payment-toggle";
import { SendInvoiceButton } from "@/components/send-invoice-button";
import { deriveInvoiceShareStatus } from "@/lib/invoices/share-status";
import {
  getPaymentStatusMeta,
  PaymentStatusBadge,
} from "@/components/payment-status-badge";
import { Card } from "@/components/ui/card";
import { resolveContractLabel } from "@/lib/contract-snapshot";
import { notDeleted } from "@/lib/db";
import {
  formatInvoiceEventActor,
  invoiceEventLabel,
} from "@/lib/invoices/event-labels";
import { deriveDueStatus, formatKRW } from "@/lib/metrics";
import { getUserPlan } from "@/lib/plan";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type InvoiceRow = Pick<
  Database["public"]["Tables"]["invoices"]["Row"],
  | "id"
  | "amount"
  | "issue_date"
  | "due_date"
  | "withholding_type"
  | "withholding_amount"
  | "net_amount"
  | "payment_status"
  | "paid_at"
  | "payment_method"
  | "created_at"
  | "contract_snapshot"
> & {
  client: {
    name: string;
    contact_email: string | null;
  } | null;
  contract: {
    title: string;
  } | null;
};

type InvoiceEventRow = Pick<
  Database["public"]["Tables"]["invoice_events"]["Row"],
  "id" | "actor" | "from_status" | "to_status" | "event_type" | "created_at"
>;

type ProfileRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "bank_name" | "bank_account_number" | "bank_account_holder"
>;

type InvoiceDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

const withholdingLabels: Record<
  Database["public"]["Enums"]["withholding_type"],
  string
> = {
  wt_3_3: "3.3%",
  wt_8_8: "8.8%",
  none: "없음",
};

function formatDate(date: string | null) {
  if (!date) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);

  if (!match) {
    return date;
  }

  const [, year, month, day] = match;

  return `${year}.${month}.${day}`;
}

function formatDateTime(date: string | null) {
  if (!date) {
    return null;
  }

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsedDate);
}

function isOverdue(
  invoice: Pick<InvoiceRow, "due_date" | "payment_status">,
) {
  return (
    deriveDueStatus(
      {
        dueDate: invoice.due_date,
        paymentStatus: invoice.payment_status,
      },
      new Date(),
    ) === "overdue"
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

export default async function InvoiceDetailPage({
  params,
}: InvoiceDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await notDeleted(
    supabase
      .from("invoices")
      .select(
        "id,amount,issue_date,due_date,withholding_type,withholding_amount,net_amount,payment_status,paid_at,payment_method,created_at,contract_snapshot,client:clients(name,contact_email),contract:contracts(title)",
      )
      .eq("id", id),
  ).maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    notFound();
  }

  const invoice = data as InvoiceRow;

  const { data: eventData, error: eventError } = await supabase
    .from("invoice_events")
    .select("id,actor,from_status,to_status,event_type,created_at")
    .eq("invoice_id", invoice.id)
    .order("created_at", { ascending: true });

  if (eventError) {
    throw eventError;
  }

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("bank_name,bank_account_number,bank_account_holder")
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  // 발송 여부는 결제 상태가 아니라 "링크를 발급한 적이 있는가"로 정한다 —
  // 인보이스는 생성 즉시 unpaid이므로(0035 issue_invoice_with_event), 결제 상태로 판단하면
  // 한 번도 안 보낸 인보이스가 "재발송"으로 뜨고 있지도 않은 이전 링크의 무효화를 경고하게 된다.
  // 활성 토큰은 인보이스당 1건(0046 부분 유니크)이고, 회수는 새 토큰 발급과 함께만 일어난다.
  const { data: shareTokenData, error: shareTokenError } = await supabase
    .from("invoice_share_tokens")
    .select("recipient_email,last_sent_at,first_viewed_at,expires_at")
    .eq("invoice_id", invoice.id)
    .eq("status", "active")
    .maybeSingle();

  if (shareTokenError) {
    throw shareTokenError;
  }

  const events = (eventData ?? []) as InvoiceEventRow[];
  const profile = profileData as ProfileRow | null;
  const overdue = isOverdue(invoice);
  const shareStatus = deriveInvoiceShareStatus(shareTokenData, events);
  const hasBeenSent = shareStatus !== null;

  // 연체 인보이스에 한해 미검토 독촉 초안을 노출한다(크론이 생성, 소유자 검토 대기).
  let pendingDunning: {
    id: string;
    draft_subject: string | null;
    draft_body: string | null;
    ai_source: string | null;
  } | null = null;
  let isPro = false;

  if (overdue) {
    const [{ data: dunningData }, plan] = await Promise.all([
      supabase
        .from("dunning_reminders")
        .select("id,draft_subject,draft_body,ai_source")
        .eq("invoice_id", invoice.id)
        .eq("status", "pending_review")
        .maybeSingle(),
      getUserPlan(),
    ]);
    pendingDunning = dunningData ?? null;
    isPro = plan === "pro";
  }

  const hasBankAccount =
    Boolean(profile?.bank_name) ||
    Boolean(profile?.bank_account_number) ||
    Boolean(profile?.bank_account_holder);

  return (
    // 발송 버튼은 발송 전후로 서로 다른 카드에 놓여 재마운트된다. 발급된 링크는 다시 볼 수
    // 없으므로 재마운트되지 않는 이 provider가 들고 안내 창을 띄운다.
    <InvoiceIssuedLinkProvider>
    <div className="mx-auto max-w-6xl space-y-xl">
      <div>
        <Link
          href="/invoices"
          className="text-sm font-medium text-text-muted hover:text-brand-primary"
        >
          인보이스 목록
        </Link>
        <div className="mt-sm flex flex-col gap-lg sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-sm">
              <h2 className="break-words text-2xl font-semibold tracking-tight text-text-primary">
                {resolveContractLabel(invoice.contract, invoice.contract_snapshot)}
              </h2>
              <PaymentStatusBadge
                status={invoice.payment_status}
                overdue={overdue}
              />
            </div>
            <p className="mt-sm text-sm leading-relaxed text-text-muted">
              {invoice.client?.name ?? "클라이언트 없음"}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-start gap-sm">
            <Link
              href={`/api/invoices/${invoice.id}/pdf`}
              target="_blank"
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-surface-border bg-white px-lg py-sm text-sm font-medium text-text-body transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
            >
              PDF
            </Link>
            <InvoiceDeleteButton invoiceId={invoice.id} />
          </div>
        </div>
      </div>

      <div className="grid items-start gap-xl lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* 왼쪽(2fr): 인보이스 본문 — 정산 요약·지급 정보·입금 계좌 */}
        <div className="space-y-xl">
          {pendingDunning ? (
            isPro ? (
              <DunningReviewPanel
                reminderId={pendingDunning.id}
                draftSubject={pendingDunning.draft_subject ?? ""}
                draftBody={pendingDunning.draft_body ?? ""}
                aiSource={pendingDunning.ai_source}
              />
            ) : (
              <UpgradeCard
                title="미수금 자동 독촉"
                description="이 연체 인보이스의 독촉 메일 초안이 준비됐어요. Pro로 업그레이드하면 검토 후 클라이언트에게 바로 보낼 수 있어요."
              />
            )
          ) : null}

          <Card>
            <div className="border-b border-surface-border pb-lg">
              <h3 className="text-lg font-semibold text-text-primary">
                정산 요약
              </h3>
              <p className="mt-xs text-sm leading-relaxed text-text-muted">
                발행 시점에 저장된 금액 스냅샷을 기준으로 표시합니다.
              </p>
            </div>
            <div className="mt-xl grid gap-lg sm:grid-cols-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  청구 금액
                </p>
                <p className="mt-xs text-2xl font-bold tabular-nums tracking-tight text-text-primary">
                  {formatKRW(invoice.amount)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  원천징수
                </p>
                <p className="mt-xs text-2xl font-bold tabular-nums tracking-tight text-text-primary">
                  {formatKRW(invoice.withholding_amount)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  실수령액
                </p>
                <p className="mt-xs text-2xl font-bold tabular-nums tracking-tight text-text-primary">
                  {formatKRW(invoice.net_amount)}
                </p>
              </div>
            </div>
            <details className="mt-xl rounded-md border border-surface-border bg-surface-muted px-lg py-md">
              <summary className="cursor-pointer text-sm font-medium text-text-primary">
                원천징수 내역 보기
              </summary>
              <dl className="mt-lg grid gap-md sm:grid-cols-2">
                <DetailItem
                  label="원천징수 유형"
                  value={withholdingLabels[invoice.withholding_type]}
                />
                <DetailItem
                  label="저장 원천징수액"
                  value={formatKRW(invoice.withholding_amount)}
                />
                <DetailItem label="청구 금액" value={formatKRW(invoice.amount)} />
                <DetailItem label="실수령액" value={formatKRW(invoice.net_amount)} />
              </dl>
            </details>
            <div className="mt-lg rounded-md border border-amber-200 bg-status-waiting-bg px-md py-sm text-xs leading-relaxed text-amber-800">
              원천징수는 참고용 계산입니다. 이 화면은 재계산하지 않고 발행 시점
              스냅샷을 그대로 표시합니다.
            </div>
          </Card>

          <Card>
            <div className="border-b border-surface-border pb-lg">
              <h3 className="text-lg font-semibold text-text-primary">
                지급 정보
              </h3>
              <p className="mt-xs text-sm leading-relaxed text-text-muted">
                지급기한과 입금 확인 정보를 함께 확인합니다.
              </p>
            </div>
            <dl className="mt-xl grid gap-lg sm:grid-cols-2">
              <DetailItem label="발행일" value={formatDate(invoice.issue_date)} />
              <DetailItem
                label="지급기한"
                value={formatDate(invoice.due_date)}
              />
              <DetailItem label="입금일" value={formatDateTime(invoice.paid_at)} />
              <DetailItem label="입금 방식" value={invoice.payment_method} />
            </dl>
            {overdue ? (
              <p className="mt-lg rounded-md border border-red-200 bg-status-overdue-bg px-md py-sm text-xs leading-relaxed text-red-700">
                지급기한이 지났지만 아직 입금완료 상태가 아닙니다.
              </p>
            ) : null}
          </Card>

          <Card>
            <div className="border-b border-surface-border pb-lg">
              <h3 className="text-lg font-semibold text-text-primary">
                입금 계좌
              </h3>
              <p className="mt-xs text-sm leading-relaxed text-text-muted">
                설정에 저장된 계좌 정보입니다.
              </p>
            </div>
            {hasBankAccount ? (
              <dl className="mt-xl grid gap-lg sm:grid-cols-2">
                <DetailItem label="은행" value={profile?.bank_name ?? null} />
                <DetailItem
                  label="계좌번호"
                  value={profile?.bank_account_number ?? null}
                />
                <DetailItem
                  label="예금주"
                  value={profile?.bank_account_holder ?? null}
                />
              </dl>
            ) : (
              <p className="mt-xl text-sm leading-relaxed text-text-muted">
                설정에 등록된 입금 계좌가 없습니다.
              </p>
            )}
          </Card>

          {/* 청구서 발송 현황 — 계약의 "상대방 서명 요청 현황"과 같은 자리·같은 역할.
              링크 원문은 저장하지 않아 다시 보여줄 수 없으므로, 대신 도달·열람 사실을 보여준다. */}
          {shareStatus ? (
            <Card>
              <div className="border-b border-surface-border pb-lg">
                <h3 className="text-lg font-semibold text-text-primary">
                  청구서 발송 현황
                </h3>
                <p className="mt-xs text-sm leading-relaxed text-text-muted">
                  보안을 위해 발급된 링크 주소는 저장하지 않습니다. 링크를 다시
                  보내려면 재발송해야 하며, 그때 이전 링크는 무효화됩니다.
                </p>
              </div>
              <dl className="mt-xl grid gap-lg sm:grid-cols-2">
                <DetailItem
                  label="보낸 곳"
                  value={shareStatus.recipientEmail ?? "링크만 발급(이메일 없음)"}
                />
                <DetailItem
                  label="보낸 때"
                  value={formatDateTime(shareStatus.sentAt)}
                />
                <DetailItem
                  label="메일 전달"
                  value={
                    shareStatus.delivered
                      ? "전달됨"
                      : "전달되지 않음 — 링크를 직접 전해 주세요"
                  }
                />
                <DetailItem
                  label="상대 열람"
                  value={
                    shareStatus.firstViewedAt
                      ? formatDateTime(shareStatus.firstViewedAt)
                      : "아직 열어보지 않음"
                  }
                />
                <DetailItem
                  label="링크 만료"
                  value={formatDate(shareStatus.expiresAt)}
                />
              </dl>
              {invoice.payment_status !== "paid" ? (
                <div className="mt-xl">
                  <SendInvoiceButton
                    invoiceId={invoice.id}
                    recipientEmail={invoice.client?.contact_email ?? null}
                    mode="resend"
                  />
                </div>
              ) : null}
            </Card>
          ) : null}
        </div>

        {/* 오른쪽(1fr): 상태·액션 레일 — 다음 단계·인보이스 타임라인 */}
        <div className="space-y-xl">
          <Card>
            <div className="border-b border-surface-border pb-lg">
              <h3 className="text-lg font-semibold text-text-primary">
                다음 단계
              </h3>
              <p className="mt-xs text-sm leading-relaxed text-text-muted">
                현재 인보이스 상태에서 가능한 다음 작업만 표시됩니다.
              </p>
            </div>
            <div className="mt-xl grid gap-lg">
              {invoice.payment_status === "draft" ? (
                !hasBeenSent ? (
                  <SendInvoiceButton
                    invoiceId={invoice.id}
                    recipientEmail={invoice.client?.contact_email ?? null}
                    mode="send"
                  />
                ) : null
              ) : (
                <>
                  <InvoicePaymentToggle
                    invoiceId={invoice.id}
                    status={invoice.payment_status}
                  />
                  {/* 첫 발송만 여기 둔다. 이미 보낸 뒤의 재발송은 "청구서 발송 현황" 카드에서 —
                      현재 링크 상태를 보면서 눌러야 이전 링크가 죽는다는 경고가 의미를 갖는다. */}
                  {invoice.payment_status === "unpaid" && !hasBeenSent ? (
                    <SendInvoiceButton
                      invoiceId={invoice.id}
                      recipientEmail={invoice.client?.contact_email ?? null}
                      mode="send"
                    />
                  ) : null}
                </>
              )}
            </div>
          </Card>

          <Card>
            <div className="border-b border-surface-border pb-lg">
              <h3 className="text-lg font-semibold text-text-primary">
                인보이스 타임라인
              </h3>
              <p className="mt-xs text-sm leading-relaxed text-text-muted">
                인보이스 상태 전이는 append-only 이벤트로 기록됩니다.
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
                      className={cn(
                        "absolute -left-[25px] top-1.5 size-3 rounded-full border-2 border-white",
                        event.to_status === "paid"
                          ? "bg-status-paid-fg"
                          : "bg-brand-primary",
                      )}
                    />
                    <div className="flex flex-col gap-xs sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm font-medium text-text-primary">
                        {event.from_status
                          ? `${getPaymentStatusMeta(event.from_status).label} → ${getPaymentStatusMeta(event.to_status).label}`
                          : getPaymentStatusMeta(event.to_status).label}
                      </p>
                      <time className="text-xs text-text-muted">
                        {formatDateTime(event.created_at)}
                      </time>
                    </div>
                    <p className="mt-xs text-sm leading-relaxed text-text-body">
                      {invoiceEventLabel(event.event_type)} ·{" "}
                      {formatInvoiceEventActor(event.actor)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
    </InvoiceIssuedLinkProvider>
  );
}
