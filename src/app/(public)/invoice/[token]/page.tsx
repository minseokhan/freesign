import { headers } from "next/headers";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { parseInvoiceView } from "@/lib/invoices/public-view";
import { getHeadersIpHash } from "@/lib/request-meta";
import { hashSigningToken } from "@/lib/signing-token";
import { createAnonClient } from "@/lib/supabase/anon";

// 비로그인 청구서 페이지 — 인증 없이 anon DEFINER RPC(get_invoice_view)로만 조회한다.
// 열람 기록(first_viewed_at)이 RPC 안에서 남으므로 항상 동적으로 렌더한다.
export const dynamic = "force-dynamic";

type PublicInvoicePageProps = {
  params: Promise<{
    token: string;
  }>;
};

function NoticeCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card>
      <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
      <p className="mt-sm text-sm leading-relaxed text-text-muted">
        {description}
      </p>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-lg py-sm">
      <dt className="text-sm text-text-muted">{label}</dt>
      <dd className="text-sm font-medium text-text-body">{value}</dd>
    </div>
  );
}

const INVALID_LINK = {
  title: "유효하지 않은 청구서 링크입니다",
  description:
    "링크가 잘못되었거나 더 이상 사용할 수 없습니다. 청구서를 보낸 분에게 재발송을 부탁해 주세요.",
};

export default async function PublicInvoicePage({
  params,
}: PublicInvoicePageProps) {
  const { token } = await params;

  if (!token?.trim()) {
    return <NoticeCard {...INVALID_LINK} />;
  }

  const supabase = createAnonClient();

  // 형제 라우트(PDF)와 같은 IP 단위 안티오토메이션 — 이 페이지는 force-dynamic이라
  // 매 요청이 DB RPC + 열람 기록을 남긴다(공개 서명 페이지와 동일 정책).
  const { data: allowed, error: rateError } = await supabase.rpc(
    "consume_anon_rate_limit",
    {
      p_ip_hash: getHeadersIpHash(await headers()),
      p_bucket: "invoice_view",
      p_limit: 20,
      p_window_seconds: 60,
    },
  );

  // 레이트리밋 저장소 오류는 열람을 막지 않는다(가용성 우선).
  if (rateError) {
    console.error(
      "[public-invoice] 레이트리밋 확인 실패(fail-open):",
      rateError.message,
    );
  } else if (allowed === false) {
    return (
      <NoticeCard
        title="잠시 후 다시 시도해 주세요"
        description="짧은 시간에 요청이 너무 많았습니다. 1분 뒤 링크를 다시 열어 주세요."
      />
    );
  }

  const { data, error } = await supabase.rpc("get_invoice_view", {
    p_token_hash: hashSigningToken(token),
  });

  if (error) {
    throw new Error(error.message);
  }

  const view = parseInvoiceView(data);

  if (!view) {
    return <NoticeCard {...INVALID_LINK} />;
  }

  if (view.state === "expired") {
    return (
      <NoticeCard
        title="청구서 링크가 만료되었습니다"
        description="보안을 위해 청구서 링크에는 유효기간이 있습니다. 청구서를 보낸 분에게 재발송을 부탁해 주세요."
      />
    );
  }

  if (view.state === "revoked") {
    return (
      <NoticeCard
        title="이 청구서 링크는 더 이상 사용할 수 없습니다"
        description="청구서가 다시 발송되어 이전 링크가 회수되었습니다. 가장 최근에 받은 링크를 열어 주세요."
      />
    );
  }

  const { document } = view;
  const isPaid = view.paymentStatus === "paid";

  return (
    <div className="space-y-xl">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
          {view.contractTitle}
        </h2>
        <p className="mt-sm text-sm leading-relaxed text-text-muted">
          {view.senderName
            ? `${view.senderName}님이 보낸 청구서입니다.`
            : "청구서가 도착했습니다."}{" "}
          {isPaid
            ? "입금이 확인되어 정산이 완료되었습니다."
            : `지급기한은 ${document.dueDateLabel}입니다.`}
        </p>
      </div>

      <Card>
        <div className="border-b border-surface-border pb-lg">
          <h3 className="text-lg font-semibold text-text-primary">청구 내역</h3>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            문서번호 {document.invoiceNumber}
          </p>
        </div>
        <dl className="mt-lg divide-y divide-surface-border">
          <DetailRow label="청구처" value={document.clientName} />
          <DetailRow label="발행일" value={document.issueDateLabel} />
          <DetailRow label="지급기한" value={document.dueDateLabel} />
          <DetailRow label="공급가액" value={document.amountLabel} />
          {document.showWithholdingDetails ? (
            <DetailRow
              label={`원천징수 (${document.withholdingTypeLabel})`}
              value={`- ${document.withholdingAmountLabel}`}
            />
          ) : null}
          <DetailRow label="입금 예정 금액" value={document.netAmountLabel} />
          <DetailRow label="상태" value={document.paymentStatusLabel} />
        </dl>
      </Card>

      {document.bankAccount ? (
        <Card>
          <div className="border-b border-surface-border pb-lg">
            <h3 className="text-lg font-semibold text-text-primary">입금 계좌</h3>
          </div>
          <dl className="mt-lg divide-y divide-surface-border">
            <DetailRow label="은행" value={document.bankAccount.bankName} />
            <DetailRow
              label="계좌번호"
              value={document.bankAccount.accountNumber}
            />
            <DetailRow
              label="예금주"
              value={document.bankAccount.accountHolder}
            />
          </dl>
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-md">
          <div>
            <h3 className="text-lg font-semibold text-text-primary">
              청구서 PDF
            </h3>
            <p className="mt-xs text-sm leading-relaxed text-text-muted">
              보관용 사본을 내려받을 수 있습니다.
            </p>
          </div>
          <Link
            href={`/api/invoice/${encodeURIComponent(token)}/pdf`}
            target="_blank"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
          >
            PDF 내려받기
          </Link>
        </div>
      </Card>

      <p className="text-xs leading-relaxed text-text-muted">
        {document.disclaimer}
      </p>
    </div>
  );
}
