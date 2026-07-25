-- 0030_contract_insights
-- AI 계약 인사이트. 과거 계약을 AI가 읽어 조항 약점/누락 피드백을 도출·저장한다.
-- 온디맨드 분석(세션 있는 Pro API)에서만 생성. 크론 독립(스케줄러 불필요).
-- AI 결과는 "비법률자문·검토보조"이며 게이트가 아니라 보강 요소. 실패 시 중립 폴백.

create table contract_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  contract_id uuid not null references contracts (id) on delete cascade,
  summary text not null,
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  findings jsonb not null default '[]'::jsonb,  -- [{clause_title, severity, note}]
  model text,
  source text,                                  -- 'ai' | 'fallback'
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index contract_insights_user_created_idx
  on contract_insights (user_id, created_at);
create index contract_insights_contract_created_idx
  on contract_insights (contract_id, created_at desc);

alter table contract_insights enable row level security;

create policy "contract_insights_select_own"
  on contract_insights
  for select
  using (user_id = (select auth.uid()));

create policy "contract_insights_insert_own"
  on contract_insights
  for insert
  with check (user_id = (select auth.uid()));
