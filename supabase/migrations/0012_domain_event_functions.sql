create or replace function transition_contract_status_with_event(
  p_contract_id uuid,
  p_to_status contract_status,
  p_reset_signature_artifacts boolean,
  p_actor text,
  p_event_type text,
  p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_contract contracts%rowtype;
begin
  select *
  into v_contract
  from contracts
  where id = p_contract_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'contract not found';
  end if;

  update contracts
  set status = p_to_status,
      signature_meta = case when p_reset_signature_artifacts then null else signature_meta end,
      doc_hash = case when p_reset_signature_artifacts then null else doc_hash end,
      signature_image_path = case
        when p_reset_signature_artifacts then null
        else signature_image_path
      end
  where id = p_contract_id;

  insert into contract_events (
    user_id,
    contract_id,
    actor,
    from_status,
    to_status,
    event_type,
    meta
  )
  values (
    v_contract.user_id,
    p_contract_id,
    p_actor,
    v_contract.status::text,
    p_to_status::text,
    p_event_type,
    coalesce(p_meta, '{}'::jsonb)
  );

  return p_contract_id;
end;
$$;

create or replace function sign_contract_with_event(
  p_contract_id uuid,
  p_signature_image_path text,
  p_doc_hash text,
  p_signature_meta jsonb,
  p_actor text,
  p_event_type text,
  p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_contract contracts%rowtype;
begin
  select *
  into v_contract
  from contracts
  where id = p_contract_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'contract not found';
  end if;

  if v_contract.status <> 'draft' then
    raise exception 'only draft contracts can be signed';
  end if;

  update contracts
  set status = 'signed',
      signature_image_path = p_signature_image_path,
      doc_hash = p_doc_hash,
      signature_meta = p_signature_meta
  where id = p_contract_id;

  insert into contract_events (
    user_id,
    contract_id,
    actor,
    from_status,
    to_status,
    event_type,
    meta
  )
  values (
    v_contract.user_id,
    p_contract_id,
    p_actor,
    v_contract.status::text,
    'signed',
    p_event_type,
    coalesce(p_meta, '{}'::jsonb)
  );

  return p_contract_id;
end;
$$;

create or replace function import_signed_contract_with_event(
  p_contract_id uuid,
  p_client_id uuid,
  p_title text,
  p_scope text,
  p_amount bigint,
  p_start_date date,
  p_end_date date,
  p_clauses jsonb,
  p_plain_summary text,
  p_doc_hash text,
  p_source_pdf_url text,
  p_actor text,
  p_event_type text,
  p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_client clients%rowtype;
begin
  select *
  into v_client
  from clients
  where id = p_client_id
    and deleted_at is null;

  if not found then
    raise exception 'client not found';
  end if;

  insert into contracts (
    id,
    user_id,
    client_id,
    title,
    scope,
    amount,
    start_date,
    end_date,
    status,
    clauses,
    plain_summary,
    doc_hash,
    source_pdf_url
  )
  values (
    p_contract_id,
    v_client.user_id,
    p_client_id,
    p_title,
    p_scope,
    p_amount,
    p_start_date,
    p_end_date,
    'signed',
    p_clauses,
    p_plain_summary,
    p_doc_hash,
    p_source_pdf_url
  );

  insert into contract_events (
    user_id,
    contract_id,
    actor,
    from_status,
    to_status,
    event_type,
    meta
  )
  values (
    v_client.user_id,
    p_contract_id,
    p_actor,
    null,
    'signed',
    p_event_type,
    coalesce(p_meta, '{}'::jsonb)
  );

  return p_contract_id;
end;
$$;

create or replace function issue_invoice_with_event(
  p_contract_id uuid,
  p_client_id uuid,
  p_amount bigint,
  p_issue_date date,
  p_due_date date,
  p_withholding_type withholding_type,
  p_withholding_amount bigint,
  p_net_amount bigint,
  p_actor text,
  p_event_type text,
  p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_contract contracts%rowtype;
  v_invoice_id uuid;
begin
  select *
  into v_contract
  from contracts
  where id = p_contract_id
    and deleted_at is null;

  if not found then
    raise exception 'contract not found';
  end if;

  if v_contract.client_id <> p_client_id then
    raise exception 'invoice client does not match contract client';
  end if;

  insert into invoices (
    user_id,
    contract_id,
    client_id,
    amount,
    issue_date,
    due_date,
    withholding_type,
    withholding_amount,
    net_amount,
    payment_status
  )
  values (
    v_contract.user_id,
    p_contract_id,
    p_client_id,
    p_amount,
    p_issue_date,
    p_due_date,
    p_withholding_type,
    p_withholding_amount,
    p_net_amount,
    'unpaid'
  )
  returning id into v_invoice_id;

  insert into invoice_events (
    user_id,
    invoice_id,
    actor,
    from_status,
    to_status,
    event_type,
    meta
  )
  values (
    v_contract.user_id,
    v_invoice_id,
    p_actor,
    null,
    'unpaid',
    p_event_type,
    coalesce(p_meta, '{}'::jsonb)
  );

  return v_invoice_id;
end;
$$;

create or replace function set_invoice_payment_with_event(
  p_invoice_id uuid,
  p_to_status payment_status,
  p_paid_at timestamptz,
  p_payment_method text,
  p_actor text,
  p_event_type text,
  p_meta jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_invoice invoices%rowtype;
begin
  select *
  into v_invoice
  from invoices
  where id = p_invoice_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'invoice not found';
  end if;

  update invoices
  set payment_status = p_to_status,
      paid_at = p_paid_at,
      payment_method = p_payment_method
  where id = p_invoice_id;

  insert into invoice_events (
    user_id,
    invoice_id,
    actor,
    from_status,
    to_status,
    event_type,
    meta
  )
  values (
    v_invoice.user_id,
    p_invoice_id,
    p_actor,
    v_invoice.payment_status::text,
    p_to_status::text,
    p_event_type,
    coalesce(p_meta, '{}'::jsonb)
  );

  return p_invoice_id;
end;
$$;

revoke all on function transition_contract_status_with_event(
  uuid,
  contract_status,
  boolean,
  text,
  text,
  jsonb
) from public;
revoke all on function sign_contract_with_event(
  uuid,
  text,
  text,
  jsonb,
  text,
  text,
  jsonb
) from public;
revoke all on function import_signed_contract_with_event(
  uuid,
  uuid,
  text,
  text,
  bigint,
  date,
  date,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  jsonb
) from public;
revoke all on function issue_invoice_with_event(
  uuid,
  uuid,
  bigint,
  date,
  date,
  withholding_type,
  bigint,
  bigint,
  text,
  text,
  jsonb
) from public;
revoke all on function set_invoice_payment_with_event(
  uuid,
  payment_status,
  timestamptz,
  text,
  text,
  text,
  jsonb
) from public;

grant execute on function transition_contract_status_with_event(
  uuid,
  contract_status,
  boolean,
  text,
  text,
  jsonb
) to authenticated;
grant execute on function sign_contract_with_event(
  uuid,
  text,
  text,
  jsonb,
  text,
  text,
  jsonb
) to authenticated;
grant execute on function import_signed_contract_with_event(
  uuid,
  uuid,
  text,
  text,
  bigint,
  date,
  date,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  jsonb
) to authenticated;
grant execute on function issue_invoice_with_event(
  uuid,
  uuid,
  bigint,
  date,
  date,
  withholding_type,
  bigint,
  bigint,
  text,
  text,
  jsonb
) to authenticated;
grant execute on function set_invoice_payment_with_event(
  uuid,
  payment_status,
  timestamptz,
  text,
  text,
  text,
  jsonb
) to authenticated;
