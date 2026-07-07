create or replace function get_report_channel_revenue(report_year integer)
returns table (
  channel text,
  revenue bigint,
  total_revenue bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with channel_revenue as (
    select
      c.channel,
      coalesce(sum(i.net_amount), 0)::bigint as revenue
    from invoices i
    join clients c on c.id = i.client_id
    where i.deleted_at is null
      and c.deleted_at is null
      and i.payment_status = 'paid'
      and i.paid_at is not null
      and extract(year from i.paid_at at time zone 'Asia/Seoul')::integer = report_year
    group by c.channel
  )
  select
    channel,
    revenue,
    sum(revenue) over ()::bigint as total_revenue
  from channel_revenue
$$;
