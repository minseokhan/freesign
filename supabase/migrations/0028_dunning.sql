-- 0028_dunning
-- 미수금 자동 독촉(반자동). 세션 없는 일일 크론이 연체 인보이스마다 독촉 초안 row를
-- 만들고(pending_review), 소유자가 앱에서 검토·승인해야만 클라이언트에 실제 발송된다.
-- 크론의 멀티유저 쓰기는 0027 assert_cron_secret 게이트를 통과한 SECURITY DEFINER RPC로만.
-- INSERT 정책 없음 = 초안 생성은 크론 RPC 내부에서만. 소유자의 승인/무시는 update_own RLS로.

create table dunning_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  invoice_id uuid not null references invoices (id) on delete cascade,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'sent', 'dismissed')),
  draft_subject text,
  draft_body text,
  ai_source text,               -- 'ai' | 'fallback' (sweep이 채움)
  sent_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index dunning_reminders_user_created_idx
  on dunning_reminders (user_id, created_at);
create index dunning_reminders_invoice_idx
  on dunning_reminders (invoice_id);
-- 멱등: 인보이스당 미검토(pending_review) 초안은 최대 1건. 크론 재실행·동시성 방어.
create unique index dunning_reminders_one_pending_idx
  on dunning_reminders (invoice_id)
  where status = 'pending_review';

alter table dunning_reminders enable row level security;

create policy "dunning_reminders_select_own"
  on dunning_reminders
  for select
  using (user_id = (select auth.uid()));

-- 승인(sent)·무시(dismissed) 전이는 소유자만. INSERT/DELETE 정책 없음.
create policy "dunning_reminders_update_own"
  on dunning_reminders
  for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 연체 후보에 대해 미검토 독촉 초안 placeholder를 생성한다(본문은 sweep이 이후 채움).
-- 후보 조건: unpaid + 지급기한 경과 + 미삭제 + 미검토 초안 없음 + cooldown 내 발송 이력 없음.
-- 반환: sweep이 AI 초안·소유자 알림을 만들 때 필요한 조인 필드 일체.
create or replace function create_dunning_drafts_for_overdue(
  p_cron_secret text,
  p_cooldown_days integer default 7
)
returns table (
  reminder_id uuid,
  user_id uuid,
  invoice_id uuid,
  client_name text,
  client_email text,
  contract_title text,
  net_amount bigint,
  due_date date,
  days_overdue integer,
  freelancer_name text,
  owner_email text
)
language plpgsql
security definer
as $$
-- RETURNS TABLE의 OUT 변수명(user_id·invoice_id 등)이 쿼리 컬럼명과 겹치므로 컬럼 우선 해석.
#variable_conflict use_column
begin
  perform assert_cron_secret(p_cron_secret);

  return query
  with candidates as (
    select
      i.id as invoice_id,
      i.user_id as user_id,
      c.name as client_name,
      c.contact_email as client_email,
      coalesce(ct.title, i.contract_snapshot->>'title', '(제목 없음)') as contract_title,
      i.net_amount as net_amount,
      i.due_date as due_date,
      (current_date - i.due_date)::integer as days_overdue,
      p.display_name as freelancer_name,
      u.email as owner_email
    from invoices i
    join clients c on c.id = i.client_id
    left join contracts ct on ct.id = i.contract_id
    left join profiles p on p.user_id = i.user_id
    join auth.users u on u.id = i.user_id
    where i.payment_status = 'unpaid'
      and i.due_date < current_date
      and i.deleted_at is null
      and not exists (
        select 1 from dunning_reminders d
        where d.invoice_id = i.id and d.status = 'pending_review'
      )
      and not exists (
        select 1 from dunning_reminders d
        where d.invoice_id = i.id
          and d.status = 'sent'
          and d.sent_at > now() - make_interval(days => p_cooldown_days)
      )
  ),
  inserted as (
    insert into dunning_reminders (user_id, invoice_id)
    select cand.user_id, cand.invoice_id from candidates cand
    returning id, invoice_id
  )
  select
    ins.id,
    cand.user_id,
    cand.invoice_id,
    cand.client_name,
    cand.client_email,
    cand.contract_title,
    cand.net_amount,
    cand.due_date,
    cand.days_overdue,
    cand.freelancer_name,
    cand.owner_email
  from inserted ins
  join candidates cand on cand.invoice_id = ins.invoice_id;
end;
$$;

alter function create_dunning_drafts_for_overdue(text, integer)
  set search_path = public, pg_temp;

-- sweep이 생성한 AI(또는 폴백) 초안 본문을 미검토 row에 채운다.
create or replace function update_dunning_draft_body(
  p_cron_secret text,
  p_reminder_id uuid,
  p_subject text,
  p_body text,
  p_source text
)
returns void
language plpgsql
security definer
as $$
begin
  perform assert_cron_secret(p_cron_secret);

  update dunning_reminders
  set draft_subject = p_subject,
      draft_body = p_body,
      ai_source = p_source
  where id = p_reminder_id
    and status = 'pending_review';
end;
$$;

alter function update_dunning_draft_body(text, uuid, text, text, text)
  set search_path = public, pg_temp;

revoke all on function create_dunning_drafts_for_overdue(text, integer) from public;
revoke all on function update_dunning_draft_body(text, uuid, text, text, text) from public;
grant execute on function create_dunning_drafts_for_overdue(text, integer) to anon, authenticated;
grant execute on function update_dunning_draft_body(text, uuid, text, text, text) to anon, authenticated;
