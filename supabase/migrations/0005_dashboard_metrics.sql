create or replace function get_dashboard_totals()
returns table (
  outstanding_amount bigint,
  monthly_revenue bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(
      sum(i.amount) filter (
        where i.payment_status = 'unpaid'
      ),
      0
    )::bigint as outstanding_amount,
    coalesce(
      sum(i.net_amount) filter (
        where i.payment_status = 'paid'
          and i.paid_at is not null
          and date_trunc('month', i.paid_at at time zone 'Asia/Seoul') =
            date_trunc('month', now() at time zone 'Asia/Seoul')
      ),
      0
    )::bigint as monthly_revenue
  from invoices i
  where i.deleted_at is null
$$;

create or replace function get_dashboard_channel_revenue()
returns table (
  channel text,
  revenue bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.channel,
    coalesce(sum(i.net_amount), 0)::bigint as revenue
  from invoices i
  join clients c on c.id = i.client_id
  where i.deleted_at is null
    and c.deleted_at is null
    and i.payment_status = 'paid'
  group by c.channel
$$;
