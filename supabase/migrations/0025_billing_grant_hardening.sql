-- 0025_billing_grant_hardening
-- 원격 advisor(0024 적용 후) 대응. Supabase는 ALTER DEFAULT PRIVILEGES로 public 스키마의
-- 새 함수에 anon·authenticated 실행권을 자동 부여한다(0021과 동일 배경).
-- upsert_subscription_from_polar는 webhook(anon)만 호출하는 DEFINER이므로 authenticated 실행권을
-- 명시적으로 회수해 역할 경계를 anon 전용으로 좁힌다(권한상승은 시크릿 게이트로 이미 차단되나,
-- ADR-009/0021의 anon 전용 DEFINER 컨벤션·advisor 위생을 유지).
revoke execute on function upsert_subscription_from_polar(
  text, uuid, text, text, text, text, timestamptz, boolean, text, jsonb
) from authenticated;
