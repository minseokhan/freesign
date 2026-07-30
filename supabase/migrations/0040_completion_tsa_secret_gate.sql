-- 0040_completion_tsa_secret_gate
-- OWASP 스캔 A04(medium, 대시보드 #17): 완결 TSA 토큰 저장이 anon에 그대로 열려 있고
-- write-once라 "먼저 쓴 값이 확정"된다. 토큰(=서명 링크) 소지자가 완결 직후 임의 base64를
-- 먼저 밀어 넣으면 서버가 받아온 진짜 TSA 토큰이 저장되지 못하고, 완결 시점 타임스탬프
-- 증거가 공격자 제어 블롭으로 굳는다(완결증명서에 그 지문이 인쇄된다).
--
-- 저장을 호출하는 주체는 실제로는 브라우저가 아니라 우리 서버(/api/sign/[token] 라우트
-- 핸들러)다. 그래서 anon 실행권을 없애고 세션 없는 경계의 공통 패턴(ADR-011)인
-- 시크릿 게이트 DEFINER RPC로 바꾼다: cron_config.cron_secret(=CRON_SECRET env)을
-- 서버 경계 공유 시크릿으로 쓰고 assert_cron_secret으로 fail-closed 검증한다.
--
-- 형식·크기·write-once·completed 조건은 0020 그대로 유지한다.

create or replace function store_completion_tsa_token(
  p_token_hash text,
  p_token text,
  p_server_secret text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  -- 서버 경계 게이트(불일치 시 예외 → 호출 전체 롤백).
  perform assert_cron_secret(p_server_secret);

  if p_token_hash is null
    or char_length(p_token_hash) < 32
    or char_length(p_token_hash) > 128
  then
    return false;
  end if;

  -- TimeStampResp 원문 base64 — 형식·크기 상한 검증.
  if p_token is null
    or octet_length(p_token) > 65536
    or p_token !~ '^[A-Za-z0-9+/=]+$'
  then
    return false;
  end if;

  update signature_requests
  set completion_tsa_token = p_token
  where token_hash = p_token_hash
    and status = 'completed'
    and completion_tsa_token is null;

  get diagnostics v_updated = row_count;

  return v_updated = 1;
end;
$$;

revoke all on function store_completion_tsa_token(text, text, text) from public;
-- 세션 없는 라우트 핸들러가 anon 클라이언트로 호출한다. 인가는 위 시크릿 게이트가 담당한다.
grant execute on function store_completion_tsa_token(text, text, text) to anon;

-- 무검증 주입 경로였던 2인자 버전 제거.
drop function if exists store_completion_tsa_token(text, text);
