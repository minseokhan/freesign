-- A06(Insecure Design) 대응: 비싼 AI 엔드포인트(계약서 PDF 파싱·초안 생성)의
-- 사용자 단위 레이트리밋. 서버리스 다중 인스턴스에서도 신뢰 가능하도록 공유 저장소(Postgres)에 둔다.
-- 슬라이딩 윈도우: (user_id, bucket)별 이벤트를 기록하고 윈도우 밖은 정리한 뒤 개수로 판정한다.

create table rate_limit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null,
  created_at timestamptz not null default now()
);

create index rate_limit_events_lookup
  on rate_limit_events (user_id, bucket, created_at);

alter table rate_limit_events enable row level security;

-- 사용자 데이터이므로 자기 행만 스코프(USING + WITH CHECK). RPC가 caller 권한으로 돌며 RLS를 통과해야 한다.
create policy "rate_limit_events_select_own"
  on rate_limit_events
  for select
  using (user_id = (select auth.uid()));

create policy "rate_limit_events_insert_own"
  on rate_limit_events
  for insert
  with check (user_id = (select auth.uid()));

create policy "rate_limit_events_delete_own"
  on rate_limit_events
  for delete
  using (user_id = (select auth.uid()));

-- 슬라이딩 윈도우 소비 함수. SECURITY DEFINER가 아니라 caller 권한 + RLS로 스코프되며,
-- user_id는 클라이언트 입력이 아니라 항상 auth.uid()에서 얻는다.
create or replace function consume_rate_limit(
  p_bucket text,
  p_max integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
  v_oldest timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('allowed', false, 'retry_after', p_window_seconds);
  end if;

  -- 윈도우 밖 이벤트 정리(해당 사용자·버킷)
  delete from rate_limit_events
  where user_id = v_uid
    and bucket = p_bucket
    and created_at < now() - make_interval(secs => p_window_seconds);

  select count(*), min(created_at)
  into v_count, v_oldest
  from rate_limit_events
  where user_id = v_uid
    and bucket = p_bucket;

  if v_count >= p_max then
    return jsonb_build_object(
      'allowed', false,
      'retry_after', greatest(
        1,
        ceil(extract(epoch from (v_oldest + make_interval(secs => p_window_seconds) - now())))
      )
    );
  end if;

  insert into rate_limit_events (user_id, bucket) values (v_uid, p_bucket);

  return jsonb_build_object('allowed', true, 'remaining', p_max - v_count - 1);
end;
$$;

grant execute on function consume_rate_limit(text, integer, integer) to authenticated;
