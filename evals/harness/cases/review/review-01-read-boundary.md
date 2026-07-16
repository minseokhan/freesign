---
id: review-01
track: review
expect: violation
rule: read-boundary
---
// app/invoices/page.tsx  (React Server Component)
export default async function InvoicesPage() {
  const res = await fetch("http://localhost:3000/api/invoices", { cache: "no-store" });
  const invoices = await res.json();
  return <InvoiceTable rows={invoices} />;
}
