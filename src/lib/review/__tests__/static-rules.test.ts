import { describe, expect, it } from "vitest";

import {
  hasBlocking,
  scanFiles,
  stripSqlComments,
  stripTsComments,
  type ScanContext,
  type ScanFile,
} from "@/lib/review/static-rules";

function scan(files: ScanFile[], ctx?: ScanContext) {
  return scanFiles(files, ctx);
}

function ids(files: ScanFile[], ctx?: ScanContext) {
  return scan(files, ctx).map((v) => v.ruleId);
}

// ── 주석 제거 ─────────────────────────────────────────────────────────
// 오탐의 실제 원인은 "규칙을 지키라고 적어둔 주석"이다. 오프셋을 보존해야
// 라인 번호가 어긋나지 않는다.
describe("stripTsComments", () => {
  it("줄 주석을 지우되 같은 줄 앞쪽 코드는 남긴다", () => {
    const out = stripTsComments(`const a = 1; // service_role 금지`);
    expect(out).toContain("const a = 1;");
    expect(out).not.toContain("service_role");
  });

  it("블록 주석을 지우고 줄 수를 보존한다", () => {
    const src = `/**\n * service_role은 쓰지 않는다\n */\nconst a = 1;`;
    const out = stripTsComments(src);
    expect(out).not.toContain("service_role");
    expect(out.split("\n")).toHaveLength(src.split("\n").length);
  });

  it("전체 길이(오프셋)를 보존한다", () => {
    const src = `const a = 1; // x\n/* y */\nconst b = 2;`;
    expect(stripTsComments(src)).toHaveLength(src.length);
  });

  it("문자열 안의 //를 주석 시작으로 착각하지 않는다", () => {
    const out = stripTsComments(`const url = "https://x.com/a";\nconst k = KEEP_ME;`);
    expect(out).toContain("KEEP_ME");
  });
});

describe("stripSqlComments", () => {
  it("-- 주석과 블록 주석을 지우고 길이를 보존한다", () => {
    const src = `create policy "p"\n  -- with check (true)\n  /* with check */\n  for insert;`;
    const out = stripSqlComments(src);
    expect(out).not.toContain("with check");
    expect(out).toHaveLength(src.length);
  });

  it("문자열 리터럴 안의 --를 주석으로 보지 않는다", () => {
    const out = stripSqlComments(`select 'a--b' as x, KEEP_ME from t;`);
    expect(out).toContain("KEEP_ME");
  });
});

// ── SR-01: service_role이 요청 경로에 ──────────────────────────────────
describe("SR-01 service_role in request path", () => {
  it("src/app의 코드에서 service_role 키 참조를 차단한다", () => {
    const v = scan([
      {
        path: "src/app/api/x/route.ts",
        content: `const k = process.env.SUPABASE_SERVICE_ROLE_KEY;`,
      },
    ]);
    expect(v.map((x) => x.ruleId)).toContain("SR-01");
    expect(v[0].severity).toBe("block");
    expect(v[0].line).toBe(1);
  });

  it("대괄호 접근도 잡는다", () => {
    expect(
      ids([
        {
          path: "src/app/api/x/route.ts",
          content: `const k = process.env["SUPABASE_SERVICE_ROLE_KEY"];`,
        },
      ]),
    ).toContain("SR-01");
  });

  it("주석으로만 언급한 경우는 통과시킨다 (실제 레포의 오탐 사례)", () => {
    expect(
      ids([
        {
          path: "src/app/api/contracts/[id]/insights/route.ts",
          content: `// service_role 금지 · 시크릿/외부 API는 서버 라우트에서만(CLAUDE.md).\nexport const runtime = "nodejs";`,
        },
        {
          path: "src/app/(dashboard)/settings/actions.ts",
          content: `/**\n * service_role은 쓰지 않는다 — 삭제는 auth.uid() 기반 RPC로만.\n */\nexport async function del() {}`,
        },
      ]),
    ).not.toContain("SR-01");
  });

  it("scripts/ 시드는 허용한다", () => {
    expect(
      ids([
        { path: "scripts/seed.mjs", content: `const k = process.env.SUPABASE_SERVICE_ROLE_KEY;` },
      ]),
    ).not.toContain("SR-01");
  });

  it("env 스키마 정본(src/lib/env.ts)은 키 이름을 선언해야 하므로 허용한다", () => {
    expect(
      ids([
        {
          path: "src/lib/env.ts",
          content: `export const serverEnvSchema = z.object({\n  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),\n});`,
        },
      ]),
    ).not.toContain("SR-01");
  });

  it("규칙 정의 파일 자신은 패턴을 담고 있으므로 허용한다", () => {
    expect(
      ids([
        {
          path: "src/lib/review/static-rules.ts",
          content: `const SR01_PATTERN = /SUPABASE_SERVICE_ROLE_KEY|service_role/g;`,
        },
      ]),
    ).not.toContain("SR-01");
  });

  it("테스트 파일과 테스트 하네스는 요청 경로가 아니므로 허용한다", () => {
    expect(
      ids([
        {
          path: "src/lib/review/__tests__/verdict.test.ts",
          content: `f({ title: "service_role 키 노출" })`,
        },
        { path: "src/test/pg.ts", content: `create role service_role nologin bypassrls;` },
        { path: "src/lib/__tests__/env.test.ts", content: `SUPABASE_SERVICE_ROLE_KEY: "x"` },
      ]),
    ).not.toContain("SR-01");
  });
});

// ── SR-02: 인가에 getSession ───────────────────────────────────────────
describe("SR-02 getSession for authorization", () => {
  it("src/app에서 auth.getSession()을 차단한다", () => {
    const v = scan([
      {
        path: "src/app/(dashboard)/page.tsx",
        content: `const { data } = await supabase.auth.getSession();`,
      },
    ]);
    expect(v.map((x) => x.ruleId)).toContain("SR-02");
  });

  it("middleware는 토큰 갱신 전용이므로 허용한다", () => {
    expect(
      ids([{ path: "src/middleware.ts", content: `await supabase.auth.getSession();` }]),
    ).not.toContain("SR-02");
  });

  it("getUser()는 통과시킨다", () => {
    expect(
      ids([{ path: "src/app/page.tsx", content: `await supabase.auth.getUser();` }]),
    ).not.toContain("SR-02");
  });

  it("주석 속 언급은 통과시킨다", () => {
    expect(
      ids([
        {
          path: "src/app/page.tsx",
          content: `// getSession()이 아니라 getUser()를 쓴다\nawait supabase.auth.getUser();`,
        },
      ]),
    ).not.toContain("SR-02");
  });
});

// ── SR-03: 클라이언트 컴포넌트가 서버 전용 모듈 import ──────────────────
describe("SR-03 client imports server-only module", () => {
  const ctx: ScanContext = {
    serverOnlyModules: ["src/lib/signing-token.ts", "src/lib/contracts/render-pdf.ts"],
  };

  it("'use client' 파일이 서버 전용 모듈을 import하면 차단한다", () => {
    const v = scan(
      [
        {
          path: "src/components/sign/panel.tsx",
          content: `"use client";\n\nimport { mint } from "@/lib/signing-token";\n`,
        },
      ],
      ctx,
    );
    expect(v.map((x) => x.ruleId)).toContain("SR-03");
    expect(v[0].line).toBe(3);
  });

  it("상대 경로 import도 해석한다", () => {
    expect(
      ids(
        [
          {
            path: "src/lib/contracts/preview.tsx",
            content: `'use client';\nimport { render } from "./render-pdf";\n`,
          },
        ],
        ctx,
      ),
    ).toContain("SR-03");
  });

  it("서버 컴포넌트가 import하는 건 정상이다", () => {
    expect(
      ids(
        [
          {
            path: "src/app/(dashboard)/contracts/page.tsx",
            content: `import { mint } from "@/lib/signing-token";\n`,
          },
        ],
        ctx,
      ),
    ).not.toContain("SR-03");
  });

  it("타입 전용 import는 컴파일 시 지워지므로 통과시킨다", () => {
    expect(
      ids(
        [
          {
            path: "src/components/contract-import-form.tsx",
            content: `"use client";\nimport type { Extract } from "@/lib/signing-token";\n`,
          },
        ],
        ctx,
      ),
    ).not.toContain("SR-03");
  });

  it("타입 전용 re-export도 통과시킨다", () => {
    expect(
      ids(
        [
          {
            path: "src/components/x.tsx",
            content: `"use client";\nexport type { T } from "@/lib/signing-token";\n`,
          },
        ],
        ctx,
      ),
    ).not.toContain("SR-03");
  });

  it("값 re-export는 번들에 들어가므로 차단한다", () => {
    expect(
      ids(
        [
          {
            path: "src/components/x.tsx",
            content: `"use client";\nexport { mint } from "@/lib/signing-token";\n`,
          },
        ],
        ctx,
      ),
    ).toContain("SR-03");
  });

  it("'use client'라도 서버 전용이 아닌 모듈은 통과시킨다", () => {
    expect(
      ids(
        [
          {
            path: "src/components/x.tsx",
            content: `"use client";\nimport { cn } from "@/lib/utils";\n`,
          },
        ],
        ctx,
      ),
    ).not.toContain("SR-03");
  });
});

// ── SR-04: RLS 정책 WITH CHECK 누락 ────────────────────────────────────
describe("SR-04 policy missing WITH CHECK", () => {
  it("for insert에 with check가 없으면 차단한다", () => {
    const v = scan([
      {
        path: "supabase/migrations/0100_x.sql",
        content: `create policy "p_ins"\n  on t\n  for insert\n  to authenticated\n  using (user_id = (select auth.uid()));`,
      },
    ]);
    expect(v.map((x) => x.ruleId)).toContain("SR-04");
  });

  it("for all에 with check가 없으면 차단한다", () => {
    expect(
      ids([
        {
          path: "supabase/migrations/0100_x.sql",
          content: `create policy "p_all" on t for all to authenticated using (true);`,
        },
      ]),
    ).toContain("SR-04");
  });

  it("with check가 주석 처리돼 있으면 차단한다", () => {
    expect(
      ids([
        {
          path: "supabase/migrations/0100_x.sql",
          content: `create policy "p" on t for update to authenticated\n  using (true);\n  -- with check (true) 나중에 추가`,
        },
      ]),
    ).toContain("SR-04");
  });

  it("for select는 대상이 아니다 (0046 오탐 사례)", () => {
    expect(
      ids([
        {
          path: "supabase/migrations/0046_invoice_share_tokens.sql",
          content: `create policy "invoice_share_tokens_select_own"\n  on invoice_share_tokens\n  for select\n  to authenticated\n  using (user_id = (select auth.uid()));`,
        },
      ]),
    ).not.toContain("SR-04");
  });

  it("with check가 있으면 통과시킨다", () => {
    expect(
      ids([
        {
          path: "supabase/migrations/0100_x.sql",
          content: `create policy "p" on t for insert to authenticated\n  with check (user_id = (select auth.uid()));`,
        },
      ]),
    ).not.toContain("SR-04");
  });
});

// ── SR-05: Server Action zod에 서버 소유 필드 (warn) ────────────────────
describe("SR-05 server-owned field in client zod schema", () => {
  it("actions.ts의 z.object에 서버 소유 필드가 있으면 warn한다", () => {
    const v = scan([
      {
        path: "src/app/(dashboard)/invoices/actions.ts",
        content: `const Schema = z.object({\n  title: z.string(),\n  status: z.string(),\n});`,
      },
    ]);
    const hit = v.find((x) => x.ruleId === "SR-05");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("warn");
    expect(hit!.line).toBe(3);
  });

  it("도메인 필드만 있으면 통과시킨다", () => {
    expect(
      ids([
        {
          path: "src/app/(dashboard)/invoices/actions.ts",
          content: `const Schema = z.object({\n  title: z.string(),\n  amount: z.number(),\n});`,
        },
      ]),
    ).not.toContain("SR-05");
  });

  it("접두사가 붙은 액션 파일도 대상이다 (dunning-actions.ts 등)", () => {
    expect(
      ids([
        {
          path: "src/app/(dashboard)/invoices/partial-payment-actions.ts",
          content: `const S = z.object({\n  amount: z.number(),\n  status: z.string().optional(),\n});`,
        },
      ]),
    ).toContain("SR-05");
  });

  it("actions.ts가 아니면 대상이 아니다", () => {
    expect(
      ids([
        {
          path: "src/lib/invoices/query.ts",
          content: `const Row = z.object({\n  status: z.string(),\n});`,
        },
      ]),
    ).not.toContain("SR-05");
  });
});

// ── 통합 ──────────────────────────────────────────────────────────────
describe("scanFiles / hasBlocking", () => {
  it("여러 파일의 위반을 모아 반환한다", () => {
    const v = scan([
      { path: "src/app/a.ts", content: `process.env.SUPABASE_SERVICE_ROLE_KEY` },
      { path: "src/app/b.ts", content: `await supabase.auth.getSession()` },
    ]);
    expect(v).toHaveLength(2);
    expect(v.map((x) => x.file).sort()).toEqual(["src/app/a.ts", "src/app/b.ts"]);
  });

  it("warn만 있으면 차단하지 않는다", () => {
    const v = scan([
      {
        path: "src/app/(dashboard)/x/actions.ts",
        content: `const S = z.object({ status: z.string() });`,
      },
    ]);
    expect(v.every((x) => x.severity === "warn")).toBe(true);
    expect(hasBlocking(v)).toBe(false);
  });

  it("block이 하나라도 있으면 차단한다", () => {
    expect(hasBlocking(scan([{ path: "src/app/a.ts", content: `process.env.SUPABASE_SERVICE_ROLE_KEY` }]))).toBe(
      true,
    );
  });

  it("대상 밖 파일은 무시한다", () => {
    expect(scan([{ path: "docs/PLAN.md", content: `service_role getSession()` }])).toEqual([]);
  });

  it("모든 위반은 규칙 ID·근거·수정 방향을 갖는다", () => {
    for (const v of scan([{ path: "src/app/a.ts", content: `process.env.SUPABASE_SERVICE_ROLE_KEY` }])) {
      expect(v.ruleId).toMatch(/^SR-\d\d$/);
      expect(v.message.length).toBeGreaterThan(0);
      expect(v.hint.length).toBeGreaterThan(0);
    }
  });
});
