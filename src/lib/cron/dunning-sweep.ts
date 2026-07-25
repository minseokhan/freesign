// server-only: 일일 크론(/api/cron/daily)에서만 호출. anon 클라이언트로 SECURITY DEFINER RPC를
// 부르고, RPC 내부 assert_cron_secret(0027) 게이트로 인가된다. service_role 키는 쓰지 않는다.
// 크론은 초안(pending_review)만 만들고 소유자에게 "검토 대기" 알림만 보낸다. 클라이언트 발송 없음.
import { getSiteUrl } from "@/lib/seo";
import { createAnonClient } from "@/lib/supabase/anon";
import { generateDunningDraft } from "@/services/ai/dunning-draft";
import { getEmailProvider } from "@/services/email/provider";
import { renderOwnerDunningReviewEmail } from "@/services/email/templates";

export interface DunningSweepSummary {
  candidates: number;
  drafted: number;
  ownersNotified: number;
}

interface OwnerBucket {
  email: string | null;
  count: number;
}

export async function runDunningSweep(cronSecret: string): Promise<DunningSweepSummary> {
  const supabase = createAnonClient();

  const { data, error } = await supabase.rpc("create_dunning_drafts_for_overdue", {
    p_cron_secret: cronSecret,
    p_cooldown_days: 7,
  });

  if (error) {
    throw new Error(`create_dunning_drafts_for_overdue failed: ${error.message}`);
  }

  const candidates = data ?? [];
  let drafted = 0;
  const owners = new Map<string, OwnerBucket>();

  for (const candidate of candidates) {
    const draft = await generateDunningDraft({
      clientName: candidate.client_name,
      contractTitle: candidate.contract_title,
      amountNet: candidate.net_amount,
      dueDate: candidate.due_date,
      daysOverdue: candidate.days_overdue,
      freelancerName: candidate.freelancer_name,
    });

    const { error: updateError } = await supabase.rpc("update_dunning_draft_body", {
      p_cron_secret: cronSecret,
      p_reminder_id: candidate.reminder_id,
      p_subject: draft.subject,
      p_body: draft.body,
      p_source: draft.source,
    });

    if (updateError) {
      // 개별 초안 실패는 스윕 전체를 막지 않는다(나머지 후보 계속 처리).
      console.error("[dunning-sweep] update_dunning_draft_body error:", updateError.message);
      continue;
    }

    drafted += 1;

    const bucket = owners.get(candidate.user_id) ?? {
      email: candidate.owner_email,
      count: 0,
    };
    bucket.count += 1;
    owners.set(candidate.user_id, bucket);
  }

  // 유저별 "검토 대기 N건" 소유자 알림(best-effort — 실패해도 초안은 이미 생성됨).
  const reviewUrl = `${getSiteUrl()}/invoices`;
  let ownersNotified = 0;

  for (const bucket of owners.values()) {
    if (!bucket.email) continue;

    const rendered = renderOwnerDunningReviewEmail({
      reminderCount: bucket.count,
      reviewUrl,
    });
    const sent = await getEmailProvider().send({
      to: bucket.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (sent.ok) ownersNotified += 1;
  }

  return { candidates: candidates.length, drafted, ownersNotified };
}
