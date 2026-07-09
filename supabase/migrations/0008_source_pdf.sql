alter table public.contracts
  add column if not exists source_pdf_url text;

comment on column public.contracts.source_pdf_url is
  'Storage key for the original PDF provided by the client. Kept separate from contract_pdf_url, which stores FreeSign-generated signed PDFs, to preserve provenance.';
