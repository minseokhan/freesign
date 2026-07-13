-- 대시보드 확장: 건수 배지, 이번 달 예정 입금, 계약 파이프라인.
-- get_dashboard_totals는 반환 컬럼이 바뀌므로 drop 후 재생성한다.
drop function if exists get_dashboard_totals();

create function get_dashboard_totals()
returns table (
  outstanding_amount bigint,
  outstanding_count bigint,
  monthly_revenue bigint,
  monthly_paid_count bigint,
  expected_this_month_amount bigint,
  expected_this_month_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with kst_today as (
    select (now() at time zone 'Asia/Seoul')::date as d
  )
  select
    coalesce(
      sum(i.amount) filter (where i.payment_status = 'unpaid'),
      0
    )::bigint as outstanding_amount,
    count(*) filter (where i.payment_status = 'unpaid')::bigint as outstanding_count,
    coalesce(
      sum(i.net_amount) filter (
        where i.payment_status = 'paid'
          and i.paid_at is not null
          and date_trunc('month', i.paid_at at time zone 'Asia/Seoul') =
            date_trunc('month', now() at time zone 'Asia/Seoul')
      ),
      0
    )::bigint as monthly_revenue,
    count(*) filter (
      where i.payment_status = 'paid'
        and i.paid_at is not null
        and date_trunc('month', i.paid_at at time zone 'Asia/Seoul') =
          date_trunc('month', now() at time zone 'Asia/Seoul')
    )::bigint as monthly_paid_count,
    coalesce(
      sum(i.amount) filter (
        where i.payment_status = 'unpaid'
          and date_trunc('month', i.due_date) =
            date_trunc('month', (select d from kst_today))
      ),
      0
    )::bigint as expected_this_month_amount,
    count(*) filter (
      where i.payment_status = 'unpaid'
        and date_trunc('month', i.due_date) =
          date_trunc('month', (select d from kst_today))
    )::bigint as expected_this_month_count
  from invoices i
  where i.deleted_at is null
$$;

create or replace function get_dashboard_contract_pipeline()
returns table (
  status text,
  count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.status::text,
    count(*)::bigint as count
  from contracts c
  where c.deleted_at is null
  group by c.status
$$;
