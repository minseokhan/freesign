import Link from "next/link";

import { ContractImportForm } from "@/components/contract-import-form";
import { Card } from "@/components/ui/card";
import { notDeleted } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type ClientRow = Pick<
  Database["public"]["Tables"]["clients"]["Row"],
  "id" | "name"
>;

export default async function ImportContractPage() {
  const supabase = await createClient();
  const { data, error } = await notDeleted(
    supabase.from("clients").select("id,name"),
  ).order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  const clients = (data ?? []) as ClientRow[];

  return (
    <div className="mx-auto max-w-3xl space-y-xl">
      <div className="flex flex-col gap-lg sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/contracts"
            className="text-sm font-medium text-text-muted hover:text-brand-primary"
          >
            계약 목록
          </Link>
          <h2 className="mt-sm text-2xl font-semibold tracking-tight text-text-primary">
            기존 계약 불러오기
          </h2>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            발주처가 보낸 PDF를 분석·검토한 뒤 성사된 계약으로 저장합니다.
            이미 체결된 계약이므로 별도 서명 단계는 없습니다.
          </p>
        </div>
      </div>

      {clients.length === 0 ? (
        <Card className="flex flex-col gap-md">
          <h3 className="text-lg font-semibold text-text-primary">
            클라이언트가 필요합니다
          </h3>
          <p className="text-sm leading-relaxed text-text-muted">
            계약은 클라이언트에 연결되어야 합니다. 먼저 클라이언트를 등록한 뒤
            초안을 생성할 수 있습니다.
          </p>
          <Link
            href="/clients/new"
            className="inline-flex min-h-11 w-fit items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
          >
            클라이언트 생성
          </Link>
        </Card>
      ) : null}

      <ContractImportForm clients={clients} />
    </div>
  );
}
