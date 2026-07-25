// server-only: 일일 크론에서만 호출. anon 클라이언트로 SECURITY DEFINER RPC를 부르고,
// RPC 내부 assert_cron_secret(0027) 게이트 + plan=pro 조건으로 인가·필터된다.
// 크론은 draft 인보이스만 생성하고 소유자에게 "검토 대기" 알림만 보낸다. 발행·클라이언트 발송 없음.
import { getSiteUrl } from "@/lib/seo";
import { createAnonClient } from "@/lib/supabase/anon";
import { getEmailProvider } from "@/services/email/provider";
import { renderOwnerRecurringNoticeEmail } from "@/services/email/templates";

export interface RecurringSweepSummary {
  generated: number;
  ownersNotified: number;
}

export async function runRecurringSweep(cronSecret: string): Promise<RecurringSweepSummary> {
  const supabase = createAnonClient();

  const { data, error } = await supabase.rpc("generate_due_recurring_invoices", {
    p_cron_secret: cronSecret,
  });

  if (error) {
    throw new Error(`generate_due_recurring_invoices failed: ${error.message}`);
  }

  const generatedRows = data ?? [];
  const owners = new Map<string, { email: string | null; count: number }>();

  for (const row of generatedRows) {
    const bucket = owners.get(row.user_id) ?? { email: row.owner_email, count: 0 };
    bucket.count += 1;
    owners.set(row.user_id, bucket);
  }

  const reviewUrl = `${getSiteUrl()}/invoices/recurring`;
  let ownersNotified = 0;

  for (const bucket of owners.values()) {
    if (!bucket.email) continue;

    const rendered = renderOwnerRecurringNoticeEmail({
      draftCount: bucket.count,
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

  return { generated: generatedRows.length, ownersNotified };
}
