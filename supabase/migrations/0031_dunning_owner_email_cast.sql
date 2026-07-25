-- 0031_dunning_owner_email_cast
-- 0028 create_dunning_drafts_for_overdue의 RETURN QUERY가 owner_email을 text로 선언했으나
-- 실제 auth.users.email은 varchar(255)라 "structure of query does not match function result type"
-- 오류가 발생한다(로컬 embedded-pg는 email을 text로 목킹해 못 잡았음). u.email::text로 캐스팅해 수정.
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
      -- auth.users.email은 varchar(255)이므로 RETURNS TABLE의 text와 맞추려면 캐스팅 필요.
      u.email::text as owner_email
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
