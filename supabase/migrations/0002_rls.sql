alter table clients enable row level security;
alter table contracts enable row level security;
alter table invoices enable row level security;
alter table contract_events enable row level security;
alter table invoice_events enable row level security;
alter table profiles enable row level security;

create policy "clients_select_own"
  on clients
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "clients_insert_own"
  on clients
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "clients_update_own"
  on clients
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "contracts_select_own"
  on contracts
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "contracts_insert_own"
  on contracts
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "contracts_update_own"
  on contracts
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "invoices_select_own"
  on invoices
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "invoices_insert_own"
  on invoices
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "invoices_update_own"
  on invoices
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "profiles_select_own"
  on profiles
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "profiles_insert_own"
  on profiles
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "profiles_update_own"
  on profiles
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "contract_events_select_own"
  on contract_events
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "contract_events_insert_own"
  on contract_events
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "invoice_events_select_own"
  on invoice_events
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "invoice_events_insert_own"
  on invoice_events
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));
