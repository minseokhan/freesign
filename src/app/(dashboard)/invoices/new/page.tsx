import Link from "next/link";
import { notFound } from "next/navigation";

import { InvoiceForm } from "@/components/invoice-form";
import { notDeleted } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type ContractRow = Pick<
  Database["public"]["Tables"]["contracts"]["Row"],
  "id" | "title" | "amount" | "status"
> & {
  client: {
    name: string;
  } | null;
};

type NewInvoicePageProps = {
  searchParams?: Promise<{
    contract?: string;
  }>;
};

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export default async function NewInvoicePage({
  searchParams,
}: NewInvoicePageProps) {
  const resolvedSearchParams = await searchParams;
  const contractId = resolvedSearchParams?.contract;

  if (!contractId) {
    notFound();
  }

  const supabase = await createClient();
  const { data, error } = await notDeleted(
    supabase
      .from("contracts")
      .select("id,title,amount,status,client:clients(name)")
      .eq("id", contractId),
  ).maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    notFound();
  }

  const contract = data as ContractRow;

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select("default_withholding_type")
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  const issueDate = new Date();
  const dueDate = new Date(issueDate);
  dueDate.setDate(issueDate.getDate() + 30);

  return (
    <div className="mx-auto max-w-3xl space-y-xl">
      <div>
        <Link
          href={`/contracts/${contract.id}`}
          className="text-sm font-medium text-text-muted hover:text-brand-primary"
        >
          계약 상세
        </Link>
        <h2 className="mt-sm text-2xl font-semibold tracking-tight text-text-primary">
          인보이스 발행
        </h2>
        <p className="mt-xs text-sm leading-relaxed text-text-muted">
          계약에 연결된 인보이스를 발행하고 원천징수 스냅샷을 저장합니다.
        </p>
      </div>

      <InvoiceForm
        contract={{
          id: contract.id,
          title: contract.title,
          amount: contract.amount,
          clientName: contract.client?.name ?? "클라이언트 없음",
          disabled: contract.status === "canceled",
        }}
        defaultIssueDate={formatDateInput(issueDate)}
        defaultDueDate={formatDateInput(dueDate)}
        defaultWithholdingType={profileData?.default_withholding_type}
      />
    </div>
  );
}
