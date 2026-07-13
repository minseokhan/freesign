-- 계약 삭제를 물리(hard) 삭제로 전환한다(ADR-008을 계약에 한해 뒤집음).
-- 인보이스는 보존하되 contract_id를 NULL로 끊고 삭제 시점 계약 스냅샷을 남긴다.
-- 계약의 감사 이벤트는 cascade로 함께 제거한다.

-- 인보이스: 계약이 삭제돼도 청구 기록은 남아야 하므로 FK를 SET NULL로 교체한다.
alter table invoices
  alter column contract_id drop not null;

alter table invoices
  drop constraint invoices_contract_id_fkey;

alter table invoices
  add constraint invoices_contract_id_fkey
    foreign key (contract_id) references contracts(id) on delete set null;

-- 계약이 살아있으면 조인으로 충분하므로 평소엔 NULL, 삭제 시 액션이 채운다.
-- 서버 소유 필드(클라이언트 입력 금지): {title, amount, start_date, end_date}.
alter table invoices
  add column contract_snapshot jsonb;

-- 계약 이벤트: 계약 삭제 시 자동 제거(append-only delete 정책 부재를 cascade가 우회).
alter table contract_events
  drop constraint contract_events_contract_id_fkey;

alter table contract_events
  add constraint contract_events_contract_id_fkey
    foreign key (contract_id) references contracts(id) on delete cascade;

-- 소유자는 상태와 무관하게 자기 계약을 물리 삭제할 수 있다.
-- 데모 전용 삭제 정책(contracts_delete_demo_own)은 이 정책의 부분집합이므로 정리한다.
drop policy if exists "contracts_delete_demo_own" on contracts;

create policy "contracts_delete_own"
  on contracts
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- Storage: 서버가 계약 삭제 시 소유 폴더의 아티팩트를 제거할 수 있도록 delete 정책 추가.
-- 임베디드 테스트 DB에는 storage 스키마가 없으므로 존재 여부를 가드한다(0004와 동일 패턴).
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
      and policyname = 'contract_artifacts_delete_own'
  ) then
    execute $policy$
      create policy "contract_artifacts_delete_own"
        on storage.objects
        for delete
        to authenticated
        using (
          bucket_id = 'contract-artifacts'
          and (storage.foldername(name))[1] = (select auth.uid())::text
        )
    $policy$;
  end if;
end
$$;
