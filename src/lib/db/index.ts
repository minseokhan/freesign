import type { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type DomainTable = Extract<
  keyof Database["public"]["Tables"],
  "clients" | "contracts" | "invoices"
>;

type RlsScopedServerClient = Pick<
  Awaited<ReturnType<typeof createClient>>,
  "from"
>;

type DeletedAtQuery<Q> = {
  is(column: "deleted_at", value: null): Q;
};

export function notDeleted<Q extends DeletedAtQuery<Q>>(query: Q): Q {
  return query.is("deleted_at", null);
}

export async function assertOwned(
  supabase: RlsScopedServerClient,
  table: DomainTable,
  id: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data !== null;
}
