-- 0015_advisor_security_fixes
-- Supabase 어드바이저(security) 대응: function_search_path_mutable 7건.
-- 함수 search_path를 고정해 세션 search_path 하이재킹 표면을 제거한다.
-- 주의: 본문이 테이블을 스키마 비한정으로 참조하므로 빈 search_path('')는 함수를 깨뜨린다.
--       참조가 해석되는 public을 고정하고, pg_temp를 마지막에 명시해 temp 스키마 우선탐색을 차단한다.

alter function public.set_updated_at()
  set search_path = public, pg_temp;

alter function public.transition_contract_status_with_event(uuid, contract_status, boolean, text, text, jsonb)
  set search_path = public, pg_temp;

alter function public.sign_contract_with_event(uuid, text, text, jsonb, text, text, jsonb)
  set search_path = public, pg_temp;

alter function public.import_signed_contract_with_event(uuid, uuid, text, text, bigint, date, date, jsonb, text, text, text, text, text, jsonb)
  set search_path = public, pg_temp;

alter function public.issue_invoice_with_event(uuid, uuid, bigint, date, date, withholding_type, bigint, bigint, text, text, jsonb)
  set search_path = public, pg_temp;

alter function public.set_invoice_payment_with_event(uuid, payment_status, timestamptz, text, text, text, jsonb)
  set search_path = public, pg_temp;

alter function public.consume_rate_limit(text, integer, integer)
  set search_path = public, pg_temp;
