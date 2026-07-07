import Link from "next/link";
import { notFound } from "next/navigation";

import { ChannelBadge } from "@/components/channel-badge";
import { ClientDeleteButton } from "@/components/client-delete-button";
import { Card } from "@/components/ui/card";
import { notDeleted } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type ClientRow = Pick<
  Database["public"]["Tables"]["clients"]["Row"],
  | "id"
  | "name"
  | "channel"
  | "contact_email"
  | "contact_phone"
  | "memo"
  | "created_at"
>;

type ClientDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

function DetailItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
        {label}
      </dt>
      <dd className="mt-xs text-sm leading-relaxed text-text-body">
        {value ?? "등록되지 않음"}
      </dd>
    </div>
  );
}

export default async function ClientDetailPage({
  params
}: ClientDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await notDeleted(
    supabase
      .from("clients")
      .select("id,name,channel,contact_email,contact_phone,memo,created_at")
      .eq("id", id)
  ).maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    notFound();
  }

  const client = data as ClientRow;

  return (
    <div className="mx-auto max-w-3xl space-y-xl">
      <div className="flex flex-col gap-lg sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link
            href="/clients"
            className="text-sm font-medium text-text-muted hover:text-brand-primary"
          >
            클라이언트 목록
          </Link>
          <div className="mt-sm flex flex-wrap items-center gap-sm">
            <h2 className="break-words text-2xl font-semibold tracking-tight text-text-primary">
              {client.name}
            </h2>
            <ChannelBadge channel={client.channel} />
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-sm">
          <Link
            href={`/clients/${client.id}/edit`}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-surface-border bg-white px-lg py-sm text-sm font-medium text-text-body transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
          >
            수정
          </Link>
          <ClientDeleteButton clientId={client.id} />
        </div>
      </div>

      <Card>
        <div className="border-b border-surface-border pb-lg">
          <h3 className="text-lg font-semibold text-text-primary">기본 정보</h3>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            연락처와 메모는 계약 생성 시 참고 정보로 사용됩니다.
          </p>
        </div>
        <dl className="mt-xl grid gap-lg sm:grid-cols-2">
          <DetailItem label="이메일" value={client.contact_email} />
          <DetailItem label="전화번호" value={client.contact_phone} />
          <div className="sm:col-span-2">
            <DetailItem label="메모" value={client.memo} />
          </div>
        </dl>
      </Card>
    </div>
  );
}
