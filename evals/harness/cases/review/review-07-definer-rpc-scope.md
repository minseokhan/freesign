---
id: review-07
track: review
expect: violation
rule: definer-rpc-scope
---
-- supabase/migrations/0049_account_deletion_v2.sql
-- 세션 있는 경계(로그인 사용자)의 계정 삭제 RPC.

create or replace function delete_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- 앱이 getUser()로 받은 id를 넘겨주므로 여기서 다시 확인하지 않는다.
  delete from public.invoice_events where user_id = p_user_id;
  delete from public.invoices where user_id = p_user_id;
  delete from public.contracts where user_id = p_user_id;
  delete from public.clients where user_id = p_user_id;
  delete from auth.users where id = p_user_id;
end;
$$;

grant execute on function delete_account(uuid) to authenticated;
