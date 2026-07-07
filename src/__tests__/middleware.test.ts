import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Supabase middleware", () => {
  const source = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");

  it("refreshes Supabase auth tokens without route authorization redirects", () => {
    expect(source).toContain("supabase.auth.getUser()");
    expect(source).not.toContain("redirect(");
  });

  it("excludes static assets from the matcher", () => {
    expect(source).toContain("_next/static");
    expect(source).toContain("_next/image");
    expect(source).toContain("favicon.ico");
  });
});
