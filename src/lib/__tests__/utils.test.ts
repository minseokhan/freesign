import { cn } from "@/lib/utils";

describe("cn", () => {
  it("merges conditional classes", () => {
    expect(cn("rounded-md", false && "hidden", null, "text-sm")).toBe(
      "rounded-md text-sm",
    );
  });

  it("keeps the later Tailwind utility when classes conflict", () => {
    expect(cn("px-2 py-1", "px-4", "text-slate-500 text-slate-900")).toBe(
      "py-1 px-4 text-slate-900",
    );
  });
});
