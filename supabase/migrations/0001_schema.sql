do $$
begin
  if not exists (select 1 from pg_type where typname = 'contract_status') then
    create type contract_status as enum ('draft', 'signed', 'active', 'done', 'canceled');
  end if;

  if not exists (select 1 from pg_type where typname = 'withholding_type') then
    create type withholding_type as enum ('wt_3_3', 'wt_8_8', 'none');
  end if;

  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type payment_status as enum ('draft', 'unpaid', 'paid');
  end if;
end
$$;

create table clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  name text not null,
  channel text not null check (
    channel in ('linkedin', 'instagram', 'youtube', 'direct', 'kmong', 'referral', 'other')
  ),
  contact_email text,
  contact_phone text,
  memo text,
  is_demo boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table contracts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  client_id uuid not null references clients(id) on delete restrict,
  title text not null,
  scope text not null,
  amount bigint not null check (amount > 0),
  start_date date not null,
  end_date date not null,
  status contract_status not null default 'draft',
  clauses jsonb not null default '[]'::jsonb,
  contract_pdf_url text,
  signature_image_path text,
  doc_hash text,
  signature_meta jsonb,
  is_demo boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  contract_id uuid not null references contracts(id) on delete restrict,
  client_id uuid not null references clients(id) on delete restrict,
  amount bigint not null check (amount > 0),
  issue_date date not null,
  due_date date not null check (due_date >= issue_date),
  withholding_type withholding_type not null,
  withholding_amount bigint not null check (
    withholding_amount >= 0 and withholding_amount <= amount
  ),
  net_amount bigint not null check (net_amount >= 0),
  payment_status payment_status not null default 'draft',
  paid_at timestamptz,
  payment_method text,
  is_demo boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table contract_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  contract_id uuid not null references contracts(id),
  actor text not null,
  from_status text,
  to_status text not null,
  event_type text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table invoice_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  invoice_id uuid not null references invoices(id),
  actor text not null,
  from_status text,
  to_status text not null,
  event_type text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table profiles (
  user_id uuid primary key references auth.users(id),
  display_name text,
  default_withholding_type withholding_type not null default 'none',
  bank_name text,
  bank_account_number text,
  bank_account_holder text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_clients_updated_at
  before update on clients
  for each row
  execute function set_updated_at();

create trigger set_contracts_updated_at
  before update on contracts
  for each row
  execute function set_updated_at();

create trigger set_invoices_updated_at
  before update on invoices
  for each row
  execute function set_updated_at();

create trigger set_profiles_updated_at
  before update on profiles
  for each row
  execute function set_updated_at();
