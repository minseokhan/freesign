import { headers } from "next/headers";
import Link from "next/link";

import { CounterpartySignForm } from "@/components/counterparty-sign-form";
import { Card } from "@/components/ui/card";
import { isFrozenDocHashIntact } from "@/lib/contracts/frozen-doc-hash";
import { captureServerException } from "@/lib/posthog-server";
import { getHeadersIpHash } from "@/lib/request-meta";
import { hashSigningToken } from "@/lib/signing-token";
import { createAnonClient } from "@/lib/supabase/anon";
import type { Json } from "@/types/database";

// 비로그인 서명 페이지 — 인증 없이 anon DEFINER RPC(get_signing_session)로만 조회한다.
// 열람 기록(first_viewed_at)이 RPC 안에서 남으므로 항상 동적으로 렌더한다.
export const dynamic = "force-dynamic";

type SigningSession = {
  state: "pending" | "completed" | "expired" | "revoked";
  contract_title?: string;
  clauses?: Json;
  frozen_doc_hash?: string;
  recipient_name?: string | null;
  sender_name?: string | null;
  expires_at?: string;
};

type PublicSignPageProps = {
  params: Promise<{
    token: string;
  }>;
};

type SessionClause = {
  title: string;
  body: string;
};

function parseSession(data: Json | null): SigningSession | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }

  const state = data.state;

  if (
    state !== "pending" &&
    state !== "completed" &&
    state !== "expired" &&
    state !== "revoked"
  ) {
    return null;
  }

  return data as SigningSession;
}

function normalizeClauses(clauses: Json | undefined): SessionClause[] {
  if (!Array.isArray(clauses)) {
    return [];
  }

  return clauses.flatMap((clause) => {
    if (
      typeof clause !== "object" ||
      clause === null ||
      Array.isArray(clause) ||
      typeof clause.title !== "string" ||
      typeof clause.body !== "string"
    ) {
      return [];
    }

    return [{ title: clause.title, body: clause.body }];
  });
}

function shortenHash(hash: string) {
  return `${hash.slice(0, 16)}…${hash.slice(-8)}`;
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

export default async function PublicSignPage({ params }: PublicSignPageProps) {
  const { token } = await params;

  if (!token?.trim()) {
    return (
      <NoticeCard
        title="유효하지 않은 서명 링크입니다"
        description="링크가 잘못되었거나 더 이상 사용할 수 없습니다. 계약을 보낸 분에게 서명 요청 재발송을 부탁해 주세요."
      />
    );
  }

  const supabase = createAnonClient();

  // 형제 라우트(POST·PDF)와 같은 IP 단위 안티오토메이션(대시보드 #25).
  // 이 페이지는 force-dynamic이라 캐시가 없고, 매 요청이 DB RPC + 열람 기록을 남긴다.
  const ipHash = getHeadersIpHash(await headers());
  const { data: allowed, error: rateError } = await supabase.rpc(
    "consume_anon_rate_limit",
    {
      p_ip_hash: ipHash,
      p_bucket: "signing_session_view",
      p_limit: 20,
      p_window_seconds: 60,
    },
  );

  // 레이트리밋 저장소 오류는 열람을 막지 않는다(가용성 우선, api 라우트와 동일 정책).
  if (rateError) {
    console.error("[public-sign] 레이트리밋 확인 실패(fail-open):", rateError.message);
  } else if (allowed === false) {
    return (
      <NoticeCard
        title="잠시 후 다시 시도해 주세요"
        description="짧은 시간에 요청이 너무 많았습니다. 1분 뒤 링크를 다시 열어 주세요."
      />
    );
  }

  const { data, error } = await supabase.rpc("get_signing_session", {
    p_token_hash: hashSigningToken(token),
  });

  if (error) {
    throw new Error(error.message);
  }

  const session = parseSession(data);

  if (!session) {
    return (
      <NoticeCard
        title="유효하지 않은 서명 링크입니다"
        description="링크가 잘못되었거나 더 이상 사용할 수 없습니다. 계약을 보낸 분에게 서명 요청 재발송을 부탁해 주세요."
      />
    );
  }

  if (session.state === "expired") {
    return (
      <NoticeCard
        title="서명 링크가 만료되었습니다"
        description="보안을 위해 서명 링크는 14일 동안만 유효합니다. 계약을 보낸 분에게 서명 요청 재발송을 부탁해 주세요."
      />
    );
  }

  if (session.state === "revoked") {
    return (
      <NoticeCard
        title="서명 요청이 철회되었습니다"
        description="계약을 보낸 분이 이 서명 요청을 철회했습니다. 계약 진행이 필요하면 보낸 분에게 새 서명 요청을 부탁해 주세요."
      />
    );
  }

  if (session.state === "completed") {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-text-primary">
          서명이 완료되어 계약이 매듭지어졌습니다
        </h2>
        <p className="mt-sm text-sm leading-relaxed text-text-muted">
          {session.contract_title
            ? `"${session.contract_title}" 계약의 양 당사자 서명이 완료되었습니다.`
            : "양 당사자 서명이 완료되었습니다."}{" "}
          아래에서 서명 완료 계약서와 완결증명서를 내려받아 보관해 주세요.
        </p>
        <div className="mt-xl flex flex-wrap gap-sm">
          <Link
            href={`/api/sign/${encodeURIComponent(token)}/pdf`}
            target="_blank"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
          >
            서명 완료 계약서 PDF
          </Link>
          <Link
            href={`/api/sign/${encodeURIComponent(token)}/certificate`}
            target="_blank"
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-surface-border bg-white px-lg py-sm text-sm font-medium text-text-body transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
          >
            완결증명서 PDF
          </Link>
        </div>
      </Card>
    );
  }

  // 아래 카드가 "문서 지문으로 검증합니다"라고 약속하는 그 검증을 실제로 수행한다.
  // 지문은 발송 RPC의 파라미터라 본문과 무관한 값이 동결돼 있을 수 있고, 그 상태로 서명이
  // 완결되면 증명서에 다른 문서의 지문이 박힌다. 서명 전에 막는다.
  if (!isFrozenDocHashIntact(session.clauses, session.frozen_doc_hash)) {
    await captureServerException(
      new Error("frozen doc hash does not match contract clauses"),
      undefined,
      { route: "sign/token" },
    );

    return (
      <NoticeCard
        title="이 서명 링크는 사용할 수 없습니다"
        description="계약 본문과 발송 시점 문서 지문이 일치하지 않습니다. 안전을 위해 서명을 진행할 수 없으니, 계약을 보낸 분에게 서명 요청 재발송을 부탁해 주세요."
      />
    );
  }

  const clauses = normalizeClauses(session.clauses);
  const recipientLabel = session.recipient_name
    ? `${session.recipient_name}님`
    : "안녕하세요";

  return (
    <div className="space-y-xl">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
          {session.contract_title ?? "계약 서명 요청"}
        </h2>
        <p className="mt-sm text-sm leading-relaxed text-text-muted">
          {recipientLabel},{" "}
          {session.sender_name
            ? `${session.sender_name}님이 계약서 서명을 요청했습니다.`
            : "계약서 서명 요청이 도착했습니다."}
          {session.expires_at
            ? ` 이 링크는 ${formatDate(session.expires_at)}까지 유효합니다.`
            : null}
        </p>
      </div>

      <Card>
        <div className="border-b border-surface-border pb-lg">
          <h3 className="text-lg font-semibold text-text-primary">계약 조항</h3>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            아래 조항은 읽기 전용입니다. 발송 시점에 내용이 동결되어 서명
            시점까지 변경되지 않았음을 문서 지문으로 검증합니다.
          </p>
        </div>
        {clauses.length === 0 ? (
          <p className="mt-xl text-sm leading-relaxed text-text-muted">
            표시할 조항이 없습니다.
          </p>
        ) : (
          <div className="mt-xl space-y-lg">
            {clauses.map((clause, index) => (
              <article
                key={`${clause.title}-${index}`}
                className="rounded-md border border-surface-border p-lg"
              >
                <h4 className="text-base font-semibold text-text-primary">
                  {clause.title}
                </h4>
                <p className="mt-md whitespace-pre-wrap text-sm leading-relaxed text-text-body">
                  {clause.body}
                </p>
              </article>
            ))}
          </div>
        )}
        {session.frozen_doc_hash ? (
          <div className="mt-xl">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              문서 지문 (SHA-256)
            </p>
            <p className="mt-xs break-all font-mono text-sm text-text-body">
              {shortenHash(session.frozen_doc_hash)}
            </p>
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="border-b border-surface-border pb-lg">
          <h3 className="text-lg font-semibold text-text-primary">서명하기</h3>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            이름을 입력하고 서명한 뒤, 두 가지 필수 동의에 체크하면 서명이
            완료됩니다. 완료 후 계약서와 완결증명서 사본이 이메일로 발송됩니다.
          </p>
        </div>
        <div className="mt-xl">
          <CounterpartySignForm token={token} />
        </div>
      </Card>
    </div>
  );
}
