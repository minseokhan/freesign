// pre-commit 정적 스캐너 — 순수 판정 로직 (LLM 없음).
// CLAUDE.md의 CRITICAL 규칙 중 "정적으로 확실히 잡히는 것"만 다룬다.
// 애매한 판단은 CI의 /review-code(LLM 3축)에 넘긴다.
//
// 오탐이 이 스캐너의 유일한 실패 모드다. 규칙을 지키라고 적어둔 주석이
// 규칙 위반으로 잡히면 커밋이 통째로 막히므로, 매칭 전에 주석을 지운다.

export type RuleSeverity = "block" | "warn";

export interface RuleViolation {
  ruleId: string;
  severity: RuleSeverity;
  file: string;
  line: number;
  message: string; // 무엇이 왜 문제인지
  hint: string; // 어떻게 고치는지
}

export interface ScanFile {
  path: string; // 레포 루트 기준 posix 경로
  content: string; // staged 내용
}

export interface ScanContext {
  // `server-only`를 선언한 모듈 목록(레포 기준 경로). SR-03이 사용한다.
  serverOnlyModules?: string[];
}

// ── 주석 제거 (오프셋 보존) ────────────────────────────────────────────
// 라인 번호를 보존해야 하므로 길이를 유지한 채 공백으로 치환한다.
// 문자열 상태를 추적하지 않으면 "https://x" 의 // 를 주석으로 오인한다.

type TsState = "code" | "sq" | "dq" | "tpl" | "line" | "block";

export function stripTsComments(src: string): string {
  const out = src.split("");
  let state: TsState = "code";
  let i = 0;

  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];

    if (state === "code") {
      if (c === "/" && d === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        state = "line";
        i += 2;
        continue;
      }
      if (c === "/" && d === "*") {
        out[i] = " ";
        out[i + 1] = " ";
        state = "block";
        i += 2;
        continue;
      }
      if (c === "'") state = "sq";
      else if (c === '"') state = "dq";
      else if (c === "`") state = "tpl";
      i++;
      continue;
    }

    if (state === "line") {
      if (c === "\n") {
        state = "code";
        i++;
        continue;
      }
      out[i] = " ";
      i++;
      continue;
    }

    if (state === "block") {
      if (c === "*" && d === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        state = "code";
        i += 2;
        continue;
      }
      if (c !== "\n") out[i] = " ";
      i++;
      continue;
    }

    // 문자열 안: 내용은 남기고 주석 해석만 하지 않는다.
    if (c === "\\") {
      i += 2;
      continue;
    }
    if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) {
      state = "code";
    }
    i++;
  }

  return out.join("");
}

type SqlState = "code" | "quote" | "dquote" | "line" | "block";

export function stripSqlComments(src: string): string {
  const out = src.split("");
  let state: SqlState = "code";
  let i = 0;

  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];

    if (state === "code") {
      if (c === "-" && d === "-") {
        out[i] = " ";
        out[i + 1] = " ";
        state = "line";
        i += 2;
        continue;
      }
      if (c === "/" && d === "*") {
        out[i] = " ";
        out[i + 1] = " ";
        state = "block";
        i += 2;
        continue;
      }
      if (c === "'") state = "quote";
      else if (c === '"') state = "dquote";
      i++;
      continue;
    }

    if (state === "line") {
      if (c === "\n") {
        state = "code";
        i++;
        continue;
      }
      out[i] = " ";
      i++;
      continue;
    }

    if (state === "block") {
      if (c === "*" && d === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        state = "code";
        i += 2;
        continue;
      }
      if (c !== "\n") out[i] = " ";
      i++;
      continue;
    }

    // '' 는 이스케이프된 따옴표
    if (state === "quote" && c === "'" && d === "'") {
      i += 2;
      continue;
    }
    if ((state === "quote" && c === "'") || (state === "dquote" && c === '"')) {
      state = "code";
    }
    i++;
  }

  return out.join("");
}

// ── 경로 헬퍼 ─────────────────────────────────────────────────────────

function lineAt(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === "\n") line++;
  return line;
}

function dirOf(p: string): string {
  const parts = p.split("/");
  parts.pop();
  return parts.join("/");
}

function joinPosix(dir: string, rel: string): string {
  const parts = dir.split("/").filter(Boolean);
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

// 확장자와 /index 를 떼어 import 지정자와 파일 경로를 같은 형태로 맞춘다.
function normalizeModule(p: string): string {
  return p.replace(/\.(ts|tsx|js|jsx|mjs)$/, "").replace(/\/index$/, "");
}

const CODE_EXT = /\.(ts|tsx|js|jsx|mjs)$/;

function isSrcCode(path: string): boolean {
  return path.startsWith("src/") && CODE_EXT.test(path);
}

// 테스트 파일·테스트 하네스는 요청 경로가 아니다. 오히려 금지 패턴을 fixture로
// 들고 있는 게 정상이라(예: "service_role 키 노출"이라는 지적 제목) 대상에서 뺀다.
function isTestFile(path: string): boolean {
  return (
    path.startsWith("src/test/") ||
    path.includes("/__tests__/") ||
    /\.(test|spec)\.[jt]sx?$/.test(path)
  );
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

// ── SR-01: service_role 이 요청 경로에 ─────────────────────────────────
// CLAUDE.md: service_role 키는 요청 경로에서 절대 금지 (CLI 시드에서만).

const SR01_PATTERN = /SUPABASE_SERVICE_ROLE_KEY|service_role/g;

// env 스키마 정본은 키 이름을 선언하는 곳이라 예외. 키를 *쓰는* 쪽이 규칙 대상이다.
// 이 파일 자신도 예외 — 규칙 카탈로그라 금지 패턴을 문자열로 들고 있다.
const SR01_ALLOWED = new Set(["src/lib/env.ts", "src/lib/review/static-rules.ts"]);

function ruleServiceRole(file: ScanFile): RuleViolation[] {
  if (!isSrcCode(file.path)) return [];
  if (isTestFile(file.path) || SR01_ALLOWED.has(file.path)) return [];
  const code = stripTsComments(file.content);
  const out: RuleViolation[] = [];
  for (const m of code.matchAll(SR01_PATTERN)) {
    out.push({
      ruleId: "SR-01",
      severity: "block",
      file: file.path,
      line: lineAt(code, m.index ?? 0),
      message: "service_role 키가 요청 경로(src/)에 등장합니다 — RLS를 통째로 우회합니다.",
      hint: "익명/세션 클라이언트를 쓰거나, 세션 없는 경계라면 시크릿 게이트 SECURITY DEFINER RPC로 가세요. service_role은 scripts/ 시드 전용입니다.",
    });
  }
  return out;
}

// ── SR-02: 인가에 getSession ───────────────────────────────────────────
// CLAUDE.md: 서버 인가는 getUser(). middleware는 토큰 갱신 전용이라 예외.

const SR02_PATTERN = /\bauth\s*\.\s*getSession\s*\(/g;

function ruleGetSession(file: ScanFile): RuleViolation[] {
  if (!isSrcCode(file.path) || isTestFile(file.path)) return [];
  if (baseName(file.path) === "middleware.ts") return [];
  const code = stripTsComments(file.content);
  const out: RuleViolation[] = [];
  for (const m of code.matchAll(SR02_PATTERN)) {
    out.push({
      ruleId: "SR-02",
      severity: "block",
      file: file.path,
      line: lineAt(code, m.index ?? 0),
      message: "인가 판단에 getSession()을 썼습니다 — 쿠키의 토큰을 검증 없이 신뢰합니다.",
      hint: "getUser()로 바꾸세요. 토큰 갱신 목적이라면 middleware에서만 허용됩니다.",
    });
  }
  return out;
}

// ── SR-03: 클라이언트 컴포넌트가 서버 전용 모듈을 import ────────────────

const USE_CLIENT = /^\s*(['"])use client\1/;
// import/export ... from "spec" — 키워드와 from 사이(clause)를 함께 잡아 타입 전용인지 가린다.
const MODULE_REF = /\b(import|export)\b([^;]*?)\bfrom\s*["']([^"']+)["']/g;
const BARE_IMPORT = /\bimport\s*["']([^"']+)["']/g;

function ruleClientServerImport(file: ScanFile, ctx: ScanContext): RuleViolation[] {
  const serverOnly = ctx.serverOnlyModules ?? [];
  if (serverOnly.length === 0) return [];
  if (!isSrcCode(file.path) || isTestFile(file.path)) return [];

  const code = stripTsComments(file.content);
  if (!USE_CLIENT.test(code)) return [];

  const serverSet = new Set(serverOnly.map(normalizeModule));
  const dir = dirOf(file.path);
  const out: RuleViolation[] = [];

  const refs: { spec: string; index: number }[] = [];
  for (const m of code.matchAll(MODULE_REF)) {
    // `import type {...} from` / `export type {...} from` 은 컴파일 시 지워진다 — 번들에 없다.
    if (/^\s*type\b/.test(m[2])) continue;
    refs.push({ spec: m[3], index: m.index ?? 0 });
  }
  for (const m of code.matchAll(BARE_IMPORT)) {
    refs.push({ spec: m[1], index: m.index ?? 0 });
  }

  for (const { spec, index } of refs) {
    let resolved: string;
    if (spec.startsWith("@/")) resolved = "src/" + spec.slice(2);
    else if (spec.startsWith(".")) resolved = joinPosix(dir, spec);
    else continue; // 외부 패키지
    if (!serverSet.has(normalizeModule(resolved))) continue;
    out.push({
      ruleId: "SR-03",
      severity: "block",
      file: file.path,
      line: lineAt(code, index),
      message: `'use client' 파일이 서버 전용 모듈(${spec})을 import합니다 — 시크릿이 클라이언트 번들로 샙니다.`,
      hint: "해당 로직을 Server Action이나 app/api 라우트로 옮기고, 클라이언트에는 결과만 넘기세요.",
    });
  }
  return out;
}

// ── SR-04: RLS 정책에 WITH CHECK 누락 ──────────────────────────────────
// USING만 있으면 읽기는 막아도 쓰기(삽입/변경)를 막지 못한다.
// SELECT·DELETE 정책에는 WITH CHECK 자체가 성립하지 않으므로 대상이 아니다.

const POLICY_BLOCK = /create\s+policy[\s\S]*?;/gi;
const POLICY_WRITE_CMD = /\bfor\s+(insert|update|all)\b/i;
const POLICY_WITH_CHECK = /\bwith\s+check\b/i;

function rulePolicyWithCheck(file: ScanFile): RuleViolation[] {
  if (!/^supabase\/migrations\/.*\.sql$/.test(file.path)) return [];
  const sql = stripSqlComments(file.content);
  const out: RuleViolation[] = [];
  for (const m of sql.matchAll(POLICY_BLOCK)) {
    const block = m[0];
    if (!POLICY_WRITE_CMD.test(block)) continue;
    if (POLICY_WITH_CHECK.test(block)) continue;
    out.push({
      ruleId: "SR-04",
      severity: "block",
      file: file.path,
      line: lineAt(sql, m.index ?? 0),
      message: "쓰기 정책(insert/update/all)에 WITH CHECK가 없습니다 — 남의 user_id로 행을 쓸 수 있습니다.",
      hint: "USING과 WITH CHECK 둘 다 (user_id = (select auth.uid()))로 스코프하세요.",
    });
  }
  return out;
}

// ── SR-05: Server Action의 client 입력 zod에 서버 소유 필드 (warn) ──────
// 서버가 정하는 값을 client가 넘길 수 있으면 상태·금액을 위조당한다.
// 서버 내부 스키마와 구분이 어려워 오탐 여지가 있으므로 warn으로 시작한다.

const SERVER_OWNED = [
  "user_id",
  "status",
  "paid_at",
  "doc_hash",
  "signature_meta",
  "is_demo",
  "contract_snapshot",
  "pdf_path",
  "pdf_key",
];
const SERVER_OWNED_KEY = new RegExp(`[{,\\n]\\s*(${SERVER_OWNED.join("|")})\\s*:`, "g");

// z.object( 의 여는 중괄호부터 짝이 맞는 닫는 중괄호까지의 구간을 돌려준다.
function zodObjectRanges(code: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const marker = /z\s*\.\s*object\s*\(/g;
  for (const m of code.matchAll(marker)) {
    const open = code.indexOf("{", (m.index ?? 0) + m[0].length - 1);
    if (open === -1) continue;
    let depth = 0;
    for (let i = open; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}") {
        depth--;
        if (depth === 0) {
          ranges.push({ start: open, end: i });
          break;
        }
      }
    }
  }
  return ranges;
}

function ruleServerOwnedInZod(file: ScanFile): RuleViolation[] {
  if (!isSrcCode(file.path)) return [];
  // actions.ts 뿐 아니라 dunning-actions.ts·partial-payment-actions.ts 같은 접두사 형태도 대상.
  if (!/(^|-)actions\.ts$/.test(baseName(file.path))) return [];

  const code = stripTsComments(file.content);
  const out: RuleViolation[] = [];
  for (const r of zodObjectRanges(code)) {
    const seg = code.slice(r.start, r.end + 1);
    for (const m of seg.matchAll(SERVER_OWNED_KEY)) {
      // 매치는 키 앞의 구분자({ , 개행)부터 시작한다. 라인은 키 자체 위치로 잡는다.
      const abs = r.start + (m.index ?? 0) + m[0].indexOf(m[1]);
      out.push({
        ruleId: "SR-05",
        severity: "warn",
        file: file.path,
        line: lineAt(code, abs),
        message: `zod 스키마에 서버 소유 필드 '${m[1]}'가 있습니다 — client 입력으로 덮어쓸 수 있는지 확인하세요.`,
        hint: "client 입력 스키마에는 도메인 필드만 두고, 서버 소유 필드는 Server Action 안에서 결정하세요.",
      });
    }
  }
  return out;
}

// ── 진입점 ────────────────────────────────────────────────────────────

const RULES = [
  ruleServiceRole,
  ruleGetSession,
  (f: ScanFile, ctx: ScanContext) => ruleClientServerImport(f, ctx),
  rulePolicyWithCheck,
  ruleServerOwnedInZod,
] as ((file: ScanFile, ctx: ScanContext) => RuleViolation[])[];

export function scanFiles(files: ScanFile[], ctx: ScanContext = {}): RuleViolation[] {
  const out: RuleViolation[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const rule of RULES) {
      for (const v of rule(file, ctx)) {
        const key = `${v.ruleId}|${v.file}|${v.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(v);
      }
    }
  }
  return out;
}

export function hasBlocking(violations: RuleViolation[]): boolean {
  return violations.some((v) => v.severity === "block");
}
