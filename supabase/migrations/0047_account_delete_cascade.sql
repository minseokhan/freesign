-- 0047_account_delete_cascade
-- 계정 삭제의 선행 조건 — auth.users를 참조하는 FK를 전부 on delete cascade로 맞춘다.
--
-- 문제: 0001_schema.sql·0018_mutual_signature.sql이 만든 8개 테이블
-- (clients·contracts·invoices·contract_events·invoice_events·profiles·
--  signature_requests·contract_signatures)은 `references auth.users(id)`만 걸고
-- 삭제 동작을 지정하지 않아 NO ACTION이다. 0014 이후 테이블에만 cascade가 있다.
-- 이 상태로 `delete from auth.users`를 하면 FK 위반으로 실패한다.
--
-- 왜 목록을 하드코딩하지 않고 훑는가: 대상 테이블이 두 마이그레이션에 흩어져 있고,
-- 이후에도 user_id FK를 가진 테이블이 계속 추가된다. 이름을 나열하면 새로 생긴
-- 테이블을 놓치고, 놓친 사실은 "계정 삭제가 런타임에 실패"할 때까지 드러나지 않는다.
-- 여기서는 현재 NO ACTION인 것을 전부 전환하고, 이후 추가분은 테스트가 잡는다
-- (src/lib/db/__tests__/account-delete.test.ts — NO ACTION FK가 0건임을 단언).
--
-- 안전성: 참조 방향은 auth.users → public.* 단방향이고, user_id는 전부 소유자 스코프
-- 컬럼이다. 계정이 사라지면 그 행들도 함께 사라지는 것이 정의상 옳다.

do $$
declare
  fk record;
begin
  for fk in
    select
      con.conname as constraint_name,
      rel.relname as table_name,
      (
        select string_agg(quote_ident(att.attname), ', ' order by att.attnum)
        from unnest(con.conkey) as k
        join pg_attribute att
          on att.attrelid = rel.oid
         and att.attnum = k
      ) as columns
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    join pg_class frel on frel.oid = con.confrelid
    join pg_namespace fnsp on fnsp.oid = frel.relnamespace
    where con.contype = 'f'
      and nsp.nspname = 'public'
      and fnsp.nspname = 'auth'
      and frel.relname = 'users'
      and con.confdeltype = 'a' -- 'a' = NO ACTION
  loop
    execute format(
      'alter table public.%I drop constraint %I, add constraint %I foreign key (%s) references auth.users (id) on delete cascade',
      fk.table_name,
      fk.constraint_name,
      fk.constraint_name,
      fk.columns
    );
  end loop;
end
$$;
