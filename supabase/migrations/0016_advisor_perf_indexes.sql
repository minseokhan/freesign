-- 0016_advisor_perf_indexes
-- Supabase 어드바이저(performance) 대응: unindexed_foreign_keys 5건.
-- FK 컬럼에 커버링 인덱스를 추가한다. 기존 복합 인덱스가 있어도 FK 컬럼이 선행이 아니라
-- 단독 조회(조인·부모행 삭제/SET NULL 검사)를 커버하지 못하므로 어드바이저가 맞게 짚었다.

create index if not exists idx_contract_events_user_id on public.contract_events (user_id);
create index if not exists idx_contracts_client_id      on public.contracts (client_id);
create index if not exists idx_invoice_events_user_id   on public.invoice_events (user_id);
create index if not exists idx_invoices_client_id       on public.invoices (client_id);
create index if not exists idx_invoices_contract_id     on public.invoices (contract_id);
