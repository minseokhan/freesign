import Link from "next/link";

import {
  CLIENT_CHANNELS,
  CHANNEL_OPTIONS,
  ChannelBadge,
  type ClientChannel
} from "@/components/channel-badge";
import { Card } from "@/components/ui/card";
import { notDeleted } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type ClientRow = Pick<
  Database["public"]["Tables"]["clients"]["Row"],
  "id" | "name" | "channel" | "contact_email" | "contact_phone" | "created_at"
>;

type ClientsPageProps = {
  searchParams?: Promise<{
    channel?: string;
  }>;
};

function parseChannelFilter(channel: string | undefined): ClientChannel | null {
  if (!channel) {
    return null;
  }

  return CLIENT_CHANNELS.includes(channel as ClientChannel)
    ? (channel as ClientChannel)
    : null;
}

function getContactSummary(client: ClientRow) {
  const contacts = [client.contact_email, client.contact_phone].filter(Boolean);

  return contacts.length > 0 ? contacts.join(" · ") : "연락처 없음";
}

export default async function ClientsPage({ searchParams }: ClientsPageProps) {
  const resolvedSearchParams = await searchParams;
  const selectedChannel = parseChannelFilter(resolvedSearchParams?.channel);
  const supabase = await createClient();

  let query = notDeleted(
    supabase
      .from("clients")
      .select("id,name,channel,contact_email,contact_phone,created_at")
  );

  if (selectedChannel) {
    query = query.eq("channel", selectedChannel);
  }

  const { data, error } = await query.order("created_at", {
    ascending: false
  });

  if (error) {
    throw error;
  }

  const clients = (data ?? []) as ClientRow[];

  return (
    <div className="space-y-xl">
      <div className="flex flex-col gap-lg sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-text-primary">
            클라이언트
          </h2>
          <p className="mt-xs text-sm leading-relaxed text-text-muted">
            유입 채널과 연락처를 한 곳에서 확인합니다.
          </p>
        </div>
        <Link
          href="/clients/new"
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
        >
          클라이언트 만들기
        </Link>
      </div>

      <nav aria-label="클라이언트 채널 필터" className="flex flex-wrap gap-sm">
        {CHANNEL_OPTIONS.map((option) => {
          const href =
            option.value === "all"
              ? "/clients"
              : `/clients?channel=${option.value}`;
          const isActive =
            option.value === "all"
              ? selectedChannel === null
              : selectedChannel === option.value;

          return (
            <Link
              key={option.value}
              href={href}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-lg py-sm text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2",
                isActive
                  ? "border-blue-200 bg-brand-point text-brand-primary"
                  : "border-surface-border bg-white text-text-body hover:bg-surface-muted"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              {option.label}
            </Link>
          );
        })}
      </nav>

      {clients.length === 0 ? (
        <Card className="flex min-h-80 flex-col items-center justify-center gap-lg text-center">
          <div
            aria-hidden="true"
            className="text-3xl font-semibold text-blue-600"
          >
            FS
          </div>
          <div>
            <h3 className="text-lg font-semibold text-text-primary">
              아직 클라이언트가 없어요
            </h3>
            <p className="mt-sm max-w-md text-sm leading-relaxed text-text-muted">
              계약과 인보이스를 연결할 클라이언트를 먼저 등록하세요. 등록 후에는
              채널별로 목록을 빠르게 필터링할 수 있습니다.
            </p>
          </div>
          <Link
            href="/clients/new"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand-primary px-lg py-sm text-sm font-medium text-white transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
          >
            클라이언트 만들기
          </Link>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead className="bg-surface-muted text-xs font-medium uppercase tracking-wide text-text-muted">
                <tr>
                  <th scope="col" className="px-xl py-md">
                    이름
                  </th>
                  <th scope="col" className="px-xl py-md">
                    채널
                  </th>
                  <th scope="col" className="px-xl py-md">
                    연락처
                  </th>
                  <th scope="col" className="px-xl py-md text-right">
                    상세
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-border">
                {clients.map((client) => (
                  <tr
                    key={client.id}
                    className="transition-colors hover:bg-surface-muted"
                  >
                    <td className="px-xl py-lg">
                      <Link
                        href={`/clients/${client.id}`}
                        className="font-medium text-text-primary hover:text-brand-primary"
                      >
                        {client.name}
                      </Link>
                    </td>
                    <td className="px-xl py-lg">
                      <ChannelBadge channel={client.channel} />
                    </td>
                    <td className="px-xl py-lg text-text-body">
                      {getContactSummary(client)}
                    </td>
                    <td className="px-xl py-lg text-right">
                      <Link
                        href={`/clients/${client.id}`}
                        className="text-sm font-medium text-brand-primary hover:text-brand-hover"
                      >
                        보기
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
