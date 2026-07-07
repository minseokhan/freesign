import Link from "next/link";
import { notFound } from "next/navigation";

import { ClientForm } from "@/components/client-form";
import { notDeleted } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { CLIENT_CHANNELS, type ClientInput } from "@/lib/validation/client";
import type { Database } from "@/types/database";

type ClientRow = Pick<
  Database["public"]["Tables"]["clients"]["Row"],
  "id" | "name" | "channel" | "contact_email" | "contact_phone" | "memo"
>;

type EditClientPageProps = {
  params: Promise<{
    id: string;
  }>;
};

function parseChannel(channel: string): ClientInput["channel"] {
  return CLIENT_CHANNELS.includes(channel as ClientInput["channel"])
    ? (channel as ClientInput["channel"])
    : "other";
}

export default async function EditClientPage({ params }: EditClientPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await notDeleted(
    supabase
      .from("clients")
      .select("id,name,channel,contact_email,contact_phone,memo")
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
      <div>
        <Link
          href={`/clients/${client.id}`}
          className="text-sm font-medium text-text-muted hover:text-brand-primary"
        >
          클라이언트 상세
        </Link>
        <h2 className="mt-sm break-words text-2xl font-semibold tracking-tight text-text-primary">
          {client.name}
        </h2>
      </div>

      <ClientForm
        mode="edit"
        clientId={client.id}
        defaultValues={{
          name: client.name,
          channel: parseChannel(client.channel),
          contact_email: client.contact_email,
          contact_phone: client.contact_phone,
          memo: client.memo
        }}
      />
    </div>
  );
}
