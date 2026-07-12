-- 리포트 연 단위 결산 확장: 세무 요약 · 클라이언트별 수익 · 미수/연체 결산 · 세무 원장(CSV)
-- 0006_report_channel_revenue.sql 패턴을 따른다: language sql / stable / security invoker,
-- KST(Asia/Seoul) 기준, deleted_at is null 필터. 집계는 SQL에서만.

-- 원천징수 유형별 연간 세무 요약 (입금 기준: paid + paid_at의 KST 연도 = report_year)
create or replace function get_report_tax_summary(report_year integer)
returns table (
  withholding_type text,
  invoice_count bigint,
  gross_amount bigint,
  withholding_amount bigint,
  net_amount bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    i.withholding_type::text as withholding_type,
    count(*)::bigint as invoice_count,
    coalesce(sum(i.amount), 0)::bigint as gross_amount,
    coalesce(sum(i.withholding_amount), 0)::bigint as withholding_amount,
    coalesce(sum(i.net_amount), 0)::bigint as net_amount
  from invoices i
  where i.deleted_at is null
    and i.payment_status = 'paid'
    and i.paid_at is not null
    and extract(year from i.paid_at at time zone 'Asia/Seoul')::integer = report_year
  group by i.withholding_type
$$;

-- 클라이언트별 수익 (입금 기준, net_amount 합, 전체 합계 윈도우)
create or replace function get_report_client_revenue(report_year integer)
returns table (
  client_id uuid,
  client_name text,
  revenue bigint,
  total_revenue bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with client_revenue as (
    select
      c.id as client_id,
      c.name as client_name,
      coalesce(sum(i.net_amount), 0)::bigint as revenue
    from invoices i
    join clients c on c.id = i.client_id
    where i.deleted_at is null
      and c.deleted_at is null
      and i.payment_status = 'paid'
      and i.paid_at is not null
      and extract(year from i.paid_at at time zone 'Asia/Seoul')::integer = report_year
    group by c.id, c.name
  )
  select
    client_id,
    client_name,
    revenue,
    sum(revenue) over ()::bigint as total_revenue
  from client_revenue
$$;

-- 미수/연체 결산 (발행 기준: unpaid + issue_date의 KST 연도 = report_year)
-- 미납분은 paid_at이 없으므로 발행일로 필터. 금액은 청구액(amount). 연체 = due_date < KST 오늘.
create or replace function get_report_outstanding(report_year integer)
returns table (
  unpaid_count bigint,
  unpaid_amount bigint,
  overdue_count bigint,
  overdue_amount bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*)::bigint as unpaid_count,
    coalesce(sum(i.amount), 0)::bigint as unpaid_amount,
    count(*) filter (
      where i.due_date < (now() at time zone 'Asia/Seoul')::date
    )::bigint as overdue_count,
    coalesce(
      sum(i.amount) filter (
        where i.due_date < (now() at time zone 'Asia/Seoul')::date
      ),
      0
    )::bigint as overdue_amount
  from invoices i
  where i.deleted_at is null
    and i.payment_status = 'unpaid'
    and extract(year from i.issue_date)::integer = report_year
$$;

-- 세무 정리용 인보이스 원장 (입금 기준, CSV 내보내기 전용, 입금일 오름차순)
create or replace function get_report_tax_ledger(report_year integer)
returns table (
  paid_at timestamptz,
  issue_date date,
  client_name text,
  channel text,
  amount bigint,
  withholding_type text,
  withholding_amount bigint,
  net_amount bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    i.paid_at,
    i.issue_date,
    c.name as client_name,
    c.channel,
    i.amount,
    i.withholding_type::text as withholding_type,
    i.withholding_amount,
    i.net_amount
  from invoices i
  join clients c on c.id = i.client_id
  where i.deleted_at is null
    and c.deleted_at is null
    and i.payment_status = 'paid'
    and i.paid_at is not null
    and extract(year from i.paid_at at time zone 'Asia/Seoul')::integer = report_year
  order by i.paid_at
$$;
