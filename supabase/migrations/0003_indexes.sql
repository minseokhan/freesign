create index idx_clients_active_user_id
  on clients (user_id)
  where deleted_at is null;

create index idx_contracts_active_user_id
  on contracts (user_id)
  where deleted_at is null;

create index idx_invoices_active_user_id
  on invoices (user_id)
  where deleted_at is null;

create index idx_invoices_unpaid_due_date
  on invoices (user_id, due_date)
  where payment_status = 'unpaid';

create index idx_contracts_user_client
  on contracts (user_id, client_id);

create index idx_invoices_user_client
  on invoices (user_id, client_id);

create index idx_contract_events_contract_created_at
  on contract_events (contract_id, created_at);

create index idx_invoice_events_invoice_created_at
  on invoice_events (invoice_id, created_at);
