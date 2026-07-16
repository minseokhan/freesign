do $$
begin
  if not exists (select 1 from pg_type where typname = 'signature_request_status') then
    create type signature_request_status as enum ('pending', 'completed', 'revoked');
  end if;

  if not exists (select 1 from pg_type where typname = 'contract_signature_party') then
    create type contract_signature_party as enum ('owner', 'counterparty');
  end if;
end
$$;

create table signature_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  contract_id uuid not null references contracts(id) on delete cascade,
  token_hash text not null unique check (
    char_length(token_hash) between 32 and 128
  ),
  recipient_email text not null check (
    char_length(recipient_email) between 3 and 320
  ),
  recipient_name text check (
    recipient_name is null or char_length(recipient_name) <= 120
  ),
  status signature_request_status not null default 'pending',
  frozen_doc_hash text not null check (
    char_length(frozen_doc_hash) = 64
  ),
  expires_at timestamptz not null,
  first_viewed_at timestamptz,
  completed_at timestamptz,
  sent_tsa_token text,
  completion_tsa_token text,
  created_at timestamptz not null default now()
);

create unique index signature_requests_one_pending_per_contract
  on signature_requests (contract_id)
  where status = 'pending';

create index signature_requests_owner_contract_created_at
  on signature_requests (user_id, contract_id, created_at);

create table contract_signatures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  contract_id uuid not null references contracts(id) on delete cascade,
  request_id uuid references signature_requests(id) on delete set null,
  party contract_signature_party not null,
  signer_email text check (
    signer_email is null or char_length(signer_email) <= 320
  ),
  signer_name text check (
    signer_name is null or char_length(signer_name) <= 120
  ),
  signature_image_path text check (
    signature_image_path is null or char_length(signature_image_path) <= 512
  ),
  signature_image_data text check (
    signature_image_data is null or octet_length(signature_image_data) <= 262144
  ),
  doc_hash text not null check (
    char_length(doc_hash) = 64
  ),
  consent jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  signed_at timestamptz not null default now(),
  constraint contract_signatures_image_xor check (
    (signature_image_path is not null) <> (signature_image_data is not null)
  )
);

create index contract_signatures_contract_signed_at
  on contract_signatures (contract_id, signed_at);

create unique index contract_signatures_one_counterparty_per_request
  on contract_signatures (request_id)
  where party = 'counterparty' and request_id is not null;

alter table signature_requests enable row level security;
alter table contract_signatures enable row level security;

create policy "signature_requests_select_own"
  on signature_requests
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "signature_requests_insert_own"
  on signature_requests
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "signature_requests_update_own"
  on signature_requests
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "contract_signatures_select_own"
  on contract_signatures
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "contract_signatures_insert_own"
  on contract_signatures
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create or replace function block_contract_delete_with_counterparty_signature()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from contract_signatures
    where contract_id = old.id
      and party = 'counterparty'
  ) then
    raise exception 'cannot delete contract with counterparty signature';
  end if;

  return old;
end;
$$;

create trigger block_contract_delete_with_counterparty_signature
  before delete on contracts
  for each row
  execute function block_contract_delete_with_counterparty_signature();

create table anon_rate_limit_events (
  id bigint generated always as identity primary key,
  ip_hash text not null check (
    char_length(ip_hash) between 16 and 128
  ),
  bucket text not null check (
    char_length(bucket) between 1 and 64
  ),
  created_at timestamptz not null default now()
);

create index anon_rate_limit_events_lookup
  on anon_rate_limit_events (ip_hash, bucket, created_at);

alter table anon_rate_limit_events enable row level security;

create or replace function consume_anon_rate_limit(
  p_ip_hash text,
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_ip_hash is null
    or char_length(p_ip_hash) < 16
    or char_length(p_ip_hash) > 128
    or p_bucket is null
    or char_length(p_bucket) = 0
    or char_length(p_bucket) > 64
    or p_limit <= 0
    or p_window_seconds <= 0
  then
    return false;
  end if;

  delete from anon_rate_limit_events
  where ip_hash = p_ip_hash
    and bucket = p_bucket
    and created_at < now() - make_interval(secs => p_window_seconds);

  select count(*)
  into v_count
  from anon_rate_limit_events
  where ip_hash = p_ip_hash
    and bucket = p_bucket;

  if v_count >= p_limit then
    return false;
  end if;

  insert into anon_rate_limit_events (ip_hash, bucket)
  values (p_ip_hash, p_bucket);

  return true;
end;
$$;

revoke all on function consume_anon_rate_limit(text, text, integer, integer) from public;
grant execute on function consume_anon_rate_limit(text, text, integer, integer) to anon;
