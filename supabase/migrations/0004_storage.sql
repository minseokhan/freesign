do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'storage'
      and table_name = 'buckets'
  ) then
    insert into storage.buckets (
      id,
      name,
      public,
      file_size_limit,
      allowed_mime_types
    )
    values (
      'contract-artifacts',
      'contract-artifacts',
      false,
      5242880,
      array['image/png', 'application/pdf']
    )
    on conflict (id) do update
      set public = false,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'storage'
      and table_name = 'objects'
  ) and not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'contract_artifacts_select_own'
  ) then
    execute $policy$
      create policy "contract_artifacts_select_own"
        on storage.objects
        for select
        to authenticated
        using (
          bucket_id = 'contract-artifacts'
          and (storage.foldername(name))[1] = (select auth.uid())::text
        )
    $policy$;
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'storage'
      and table_name = 'objects'
  ) and not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'contract_artifacts_insert_own'
  ) then
    execute $policy$
      create policy "contract_artifacts_insert_own"
        on storage.objects
        for insert
        to authenticated
        with check (
          bucket_id = 'contract-artifacts'
          and (storage.foldername(name))[1] = (select auth.uid())::text
        )
    $policy$;
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'storage'
      and table_name = 'objects'
  ) and not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'contract_artifacts_update_own'
  ) then
    execute $policy$
      create policy "contract_artifacts_update_own"
        on storage.objects
        for update
        to authenticated
        using (
          bucket_id = 'contract-artifacts'
          and (storage.foldername(name))[1] = (select auth.uid())::text
        )
        with check (
          bucket_id = 'contract-artifacts'
          and (storage.foldername(name))[1] = (select auth.uid())::text
        )
    $policy$;
  end if;
end
$$;
