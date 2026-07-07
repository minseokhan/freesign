create policy "clients_delete_demo_own"
  on clients
  for delete
  to authenticated
  using (user_id = (select auth.uid()) and is_demo = true);

create policy "contracts_delete_demo_own"
  on contracts
  for delete
  to authenticated
  using (user_id = (select auth.uid()) and is_demo = true);

create policy "invoices_delete_demo_own"
  on invoices
  for delete
  to authenticated
  using (user_id = (select auth.uid()) and is_demo = true);

create policy "contract_events_delete_demo_own"
  on contract_events
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from contracts
      where contracts.id = contract_events.contract_id
        and contracts.user_id = (select auth.uid())
        and contracts.is_demo = true
    )
  );

create policy "invoice_events_delete_demo_own"
  on invoice_events
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from invoices
      where invoices.id = invoice_events.invoice_id
        and invoices.user_id = (select auth.uid())
        and invoices.is_demo = true
    )
  );
