import { describe, expect, it, vi } from "vitest";

import { assertOwned, notDeleted } from "@/lib/db";

describe("database query helpers", () => {
  it("adds exactly one deleted_at null filter to a query builder", () => {
    const query = {
      filters: [] as Array<{ column: string; value: null }>,
      is(column: string, value: null) {
        this.filters.push({ column, value });
        return this;
      },
    };

    const result = notDeleted(query);

    expect(result).toBe(query);
    expect(query.filters).toEqual([{ column: "deleted_at", value: null }]);
  });

  it("checks ownership by querying the target table through the scoped client", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "contract-1" }, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const supabase = { from };

    await expect(assertOwned(supabase, "contracts", "contract-1")).resolves.toBe(true);

    expect(from).toHaveBeenCalledWith("contracts");
    expect(select).toHaveBeenCalledWith("id");
    expect(eq).toHaveBeenCalledWith("id", "contract-1");
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("returns false when the scoped ownership lookup finds no row", async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    };

    await expect(assertOwned(supabase, "clients", "missing-client")).resolves.toBe(false);
  });
});
