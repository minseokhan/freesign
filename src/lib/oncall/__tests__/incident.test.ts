import { describe, expect, it } from "vitest";

import {
  BLOCKED_PATCH_PREFIXES,
  checkPatchPaths,
  decideOncall,
  oncallBranch,
  parseReportJson,
  redact,
  renderPrBody,
  truncateLog,
  type WorkflowRunFacts,
} from "@/lib/oncall/incident";

function facts(over: Partial<WorkflowRunFacts> = {}): WorkflowRunFacts {
  return {
    conclusion: "failure",
    event: "push",
    headBranch: "main",
    headRepo: "minseokhan/freesign",
    repo: "minseokhan/freesign",
    actor: "minseokhan",
    triggeringActor: "minseokhan",
    ...over,
  };
}

describe("decideOncall", () => {
  it("사람이 올린 같은 레포의 실패에는 대응한다", () => {
    expect(decideOncall(facts()).respond).toBe(true);
  });

  it("성공·취소·스킵한 런에는 깨어나지 않는다", () => {
    for (const conclusion of ["success", "cancelled", "skipped", "neutral", null]) {
      expect(decideOncall(facts({ conclusion })).respond).toBe(false);
    }
  });

  it("봇이 트리거한 실패는 건너뛴다 (dependabot PR 등)", () => {
    expect(decideOncall(facts({ actor: "dependabot[bot]" })).respond).toBe(false);
    expect(decideOncall(facts({ triggeringActor: "dependabot[bot]" })).respond).toBe(false);
  });

  it("oncall 브랜치의 실패는 건너뛴다 (무한루프 차단)", () => {
    expect(decideOncall(facts({ headBranch: "oncall/ci-fix-abc1234" })).respond).toBe(false);
  });

  it("포크가 트리거한 실패는 건너뛴다", () => {
    expect(decideOncall(facts({ headRepo: "someone/freesign-fork" })).respond).toBe(false);
  });

  it("workflow_run이 트리거한 실패는 건너뛴다 (연쇄 차단)", () => {
    expect(decideOncall(facts({ event: "workflow_run" })).respond).toBe(false);
  });

  it("판정에 필요한 사실이 비어 있으면 fail-closed로 건너뛴다", () => {
    expect(decideOncall(facts({ headBranch: "" })).respond).toBe(false);
    expect(decideOncall(facts({ headRepo: "" })).respond).toBe(false);
    expect(decideOncall(facts({ actor: "" })).respond).toBe(false);
  });

  it("건너뛸 때는 사람이 읽을 이유를 남긴다", () => {
    const d = decideOncall(facts({ headBranch: "oncall/ci-fix-abc1234" }));
    expect(d.respond).toBe(false);
    expect(d.reason).toMatch(/oncall/);
  });
});

describe("oncallBranch", () => {
  it("실패 커밋 SHA로 브랜치 이름을 정한다 (같은 사고에 중복 PR 방지)", () => {
    expect(oncallBranch("0123456789abcdef0123456789abcdef01234567")).toBe("oncall/ci-fix-0123456");
  });

  it("decideOncall이 건너뛰는 접두사와 일치한다", () => {
    const branch = oncallBranch("0123456789abcdef");
    expect(decideOncall(facts({ headBranch: branch })).respond).toBe(false);
  });
});

describe("redact", () => {
  const cases: [string, string][] = [
    ["Anthropic 키", "ANTHROPIC_API_KEY is sk-ant-api03-AbCdEf0123456789xyz"],
    ["GitHub 토큰", "token gho_AbCdEf0123456789AbCdEf0123456789xy"],
    ["GitHub PAT", "github_pat_11ABCDEFG0123456789_abcdefghijklmnop"],
    ["Supabase 키", "key sb_secret_AbCdEf0123456789AbCdEfGh"],
    ["Resend 키", "RESEND_API_KEY=re_AbCdEf01_23456789AbCdEfGhIj"],
    ["Polar webhook", "whsec_60DvAbCdEf0123456789"],
    ["JWT", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.QWxsWW91ckJhc2VBcmU"],
    ["Bearer 헤더", "authorization: Bearer AbCdEf0123456789AbCdEf"],
    ["DB URL 자격증명", "postgres://postgres:hunter2hunter2@db.example.co:5432/postgres"],
    ["일반 SECRET 대입", 'CRON_SECRET="s0me-l0ng-cron-secret-value"'],
  ];

  for (const [label, line] of cases) {
    it(`${label}를 마스킹한다`, () => {
      const out = redact(line);
      expect(out).toContain("[REDACTED]");
      for (const token of ["sk-ant-api03-AbCdEf0123456789xyz", "gho_AbCdEf0123456789AbCdEf0123456789xy", "sb_secret_AbCdEf0123456789AbCdEfGh", "hunter2hunter2", "s0me-l0ng-cron-secret-value", "QWxsWW91ckJhc2VBcmU"]) {
        if (line.includes(token)) expect(out).not.toContain(token);
      }
    });
  }

  it("로그 본문은 읽을 수 있게 남긴다 (과잉 마스킹 금지)", () => {
    const log = "FAIL src/lib/tax.test.ts > 부가세 계산\n  expected 1100 to be 1000";
    expect(redact(log)).toBe(log);
  });

  it("DB URL은 호스트를 남기고 자격증명만 지운다", () => {
    expect(redact("postgres://u:p@db.example.co:5432/x")).toContain("db.example.co");
  });

  it("여러 줄에 흩어진 시크릿을 모두 지운다", () => {
    const out = redact("a sk-ant-api03-0123456789abcdefg\nb gho_0123456789abcdefghij0123456789\n");
    expect(out).not.toMatch(/sk-ant-api03-0/);
    expect(out).not.toMatch(/gho_0/);
  });
});

describe("truncateLog", () => {
  it("긴 로그는 꼬리만 남긴다 (실패 원인은 끝에 있다)", () => {
    const log = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const out = truncateLog(log, 10);
    expect(out).toContain("line 99");
    expect(out).not.toContain("line 50");
    expect(out).toMatch(/생략/);
  });

  it("짧은 로그는 그대로 둔다", () => {
    expect(truncateLog("a\nb", 10)).toBe("a\nb");
  });
});

describe("checkPatchPaths", () => {
  it("일반 소스 수정은 통과시킨다", () => {
    expect(checkPatchPaths(["src/lib/tax.ts", "package.json"]).ok).toBe(true);
  });

  it("에이전트가 자기 하네스를 고치려 하면 막는다", () => {
    for (const prefix of BLOCKED_PATCH_PREFIXES) {
      const res = checkPatchPaths([`${prefix}something.yml`]);
      expect(res.ok).toBe(false);
      expect(res.blocked).toEqual([`${prefix}something.yml`]);
    }
  });

  it("빈 패치는 통과가 아니라 '고칠 것 없음'으로 구분된다", () => {
    expect(checkPatchPaths([]).ok).toBe(false);
    expect(checkPatchPaths([]).empty).toBe(true);
  });

  it("막힌 경로가 하나라도 섞이면 패치 전체를 거부한다", () => {
    const res = checkPatchPaths(["src/a.ts", ".github/workflows/ci.yml"]);
    expect(res.ok).toBe(false);
    expect(res.blocked).toEqual([".github/workflows/ci.yml"]);
  });
});

describe("parseReportJson", () => {
  it("JSON 앞뒤에 섞인 노이즈를 무시하고 읽는다", () => {
    const raw = `(node:1) ExperimentalWarning\n{"rootCause":"x","fix":"y"}\ndone\n`;
    expect(parseReportJson(raw).rootCause).toBe("x");
  });

  it("JSON이 없으면 던진다 (fail-closed)", () => {
    expect(() => parseReportJson("no json here")).toThrow();
  });
});

describe("renderPrBody", () => {
  const base = {
    report: {
      title: "vitest 실패",
      rootCause: "lib/tax.ts 반올림이 바뀜",
      fix: "Math.round → 절사로 되돌림",
      unresolved: "없음",
    },
    runId: "123",
    runUrl: "https://github.com/o/r/actions/runs/123",
    headSha: "0123456789abcdef",
    headBranch: "main",
    files: ["src/lib/tax.ts"],
    verified: true,
    ciAttached: true,
  };

  it("무엇이·왜·어떻게를 본문에 담는다", () => {
    const body = renderPrBody(base);
    expect(body).toContain("lib/tax.ts 반올림이 바뀜");
    expect(body).toContain("Math.round → 절사로 되돌림");
    expect(body).toContain("src/lib/tax.ts");
    expect(body).toContain(base.runUrl);
  });

  it("자동 머지하지 않는다는 사실을 본문에 명시한다", () => {
    expect(renderPrBody(base)).toMatch(/자동[ ]?머지/);
  });

  it("재검증 결과를 통과·실패로 구분해 적는다", () => {
    expect(renderPrBody(base)).toMatch(/통과/);
    expect(renderPrBody({ ...base, verified: false })).toMatch(/실패/);
  });

  it("PR에 CI 체크가 붙으면 그렇다고 적는다", () => {
    const body = renderPrBody(base);
    expect(body).toMatch(/체크가 붙습니다/);
    expect(body).not.toMatch(/붙지 않습니다/);
  });

  it("PR에 CI 체크가 안 붙으면 그 사실을 경고로 적는다", () => {
    const body = renderPrBody({ ...base, ciAttached: false });
    expect(body).toMatch(/붙지 않습니다/);
  });

  it("본문은 항상 마스킹을 거친다", () => {
    const body = renderPrBody({
      ...base,
      report: { ...base.report, rootCause: "키가 sk-ant-api03-LeakedLeaked0123456 로 만료됨" },
    });
    expect(body).not.toContain("sk-ant-api03-LeakedLeaked0123456");
    expect(body).toContain("[REDACTED]");
  });
});
