alter table public.contracts
  add column if not exists plain_summary text;

comment on column public.contracts.plain_summary is
  'Contract-level plain-language summary for AI-drafted contracts (scenario A). Shown once instead of duplicated per clause. Null for imported contracts, which carry distinct per-clause summaries inside clauses.';
