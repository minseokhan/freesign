// Lighthouse 측정 하버스트 (autoresearch 루프의 결정론적 코어).
//
// 대상 라우트를 Lighthouse로 N회 측정해 중앙값을 낸다. 지능은 없다 — 숫자만 낸다.
//
//   node scripts/lighthouse-loop/measure.mjs --target=local  --round=0        [--runs=3]
//   node scripts/lighthouse-loop/measure.mjs --target=vercel --round=baseline [--runs=3]
//
// target=local : next build 산출물을 `next start`로 띄우고(로컬 프로덕션) 측정.
// target=vercel: 배포 URL을 실측(공개 페이지만 — 인증 세션 미주입).
//
// 인증 라우트는 @supabase/ssr signInWithPassword로 세션 쿠키를 발급받아 Cookie 헤더로 주입한다.

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "reports");
const JOURNAL = join(__dirname, "journal.jsonl");

// ── 대상 라우트 ─────────────────────────────────────────────
const ROUTES = [
  { path: "/", auth: false },
  { path: "/login", auth: false },
  { path: "/dashboard", auth: true },
  { path: "/contracts", auth: true },
  { path: "/invoices", auth: true },
];

const VERCEL_URL = "https://maedeup.app";
const LOCAL_PORT = 3100;

// ── 인자 파싱 ────────────────────────────────────────────────
function parseArgs() {
  const a = Object.fromEntries(
    process.argv.slice(2).map((x) => {
      const [k, v] = x.replace(/^--/, "").split("=");
      return [k, v ?? true];
    }),
  );
  return {
    target: a.target ?? "local",
    round: String(a.round ?? "0"),
    runs: Number(a.runs ?? 3),
  };
}

// ── .env.local 로드 (측정 스크립트는 Next 밖에서 도므로 직접 읽음) ──
function loadEnv() {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* .env.local 없으면 무시 */
  }
}

// ── 통계 유틸 ────────────────────────────────────────────────
function median(arr) {
  const s = [...arr].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ── 포트 대기 ────────────────────────────────────────────────
function waitForPort(port, timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect(port, "127.0.0.1");
      sock.on("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.on("error", () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error("server timeout"));
        else setTimeout(tryOnce, 500);
      });
    };
    tryOnce();
  });
}

// ── Supabase 세션 쿠키 발급 (@supabase/ssr가 인코딩) ──────────
async function mintAuthCookies() {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!email || !password || !url || !anon) {
    console.warn("⚠️  인증 크레덴셜 부재 — 인증 라우트 측정 생략");
    return null;
  }
  const { createServerClient } = await import("@supabase/ssr");
  const captured = [];
  const supa = createServerClient(url, anon, {
    cookies: {
      getAll: () => [],
      setAll: (list) => captured.push(...list),
    },
  });
  const { error } = await supa.auth.signInWithPassword({ email, password });
  if (error) {
    console.warn(`⚠️  테스트 로그인 실패(${error.message}) — 인증 라우트 생략`);
    return null;
  }
  // Cookie 헤더 문자열로 직렬화
  return captured.map((c) => `${c.name}=${c.value}`).join("; ");
}

// ── Lighthouse 1회 실행 → 지표 추출 ──────────────────────────
async function runLighthouse(lighthouse, url, chromePort, cookieHeader) {
  const flags = {
    port: chromePort,
    output: "json",
    logLevel: "error",
    onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
  };
  if (cookieHeader) flags.extraHeaders = { Cookie: cookieHeader };

  const result = await lighthouse(url, flags);
  const lhr = result.lhr;
  const cat = (id) => Math.round((lhr.categories[id]?.score ?? 0) * 100);
  const audit = (id) => lhr.audits[id]?.numericValue ?? null;
  return {
    perf: cat("performance"),
    a11y: cat("accessibility"),
    bp: cat("best-practices"),
    seo: cat("seo"),
    lcp: audit("largest-contentful-paint"),
    tbt: audit("total-blocking-time"),
    cls: audit("cumulative-layout-shift"),
    fcp: audit("first-contentful-paint"),
    si: audit("speed-index"),
  };
}

// ── 라우트 1개를 N회 측정 → 중앙값 ───────────────────────────
async function measureRoute(lighthouse, baseUrl, route, chromePort, cookieHeader, runs) {
  const url = baseUrl + route.path;
  const cookie = route.auth ? cookieHeader : null;

  // 워밍업: next dev는 첫 요청 시 온디맨드 컴파일 → 측정 오염 방지. (cold start 완화도 겸함)
  try {
    await fetch(url, { headers: cookie ? { Cookie: cookie } : {}, redirect: "manual" });
  } catch {
    /* 워밍업 실패는 무시 */
  }

  const samples = [];
  for (let i = 0; i < runs; i++) {
    try {
      samples.push(await runLighthouse(lighthouse, url, chromePort, cookie));
    } catch (e) {
      console.warn(`  ⚠️  ${route.path} 실행 ${i + 1} 실패: ${e.message}`);
    }
  }
  if (!samples.length) return null;
  const keys = ["perf", "a11y", "bp", "seo", "lcp", "tbt", "cls", "fcp", "si"];
  const out = {};
  for (const k of keys) out[k] = median(samples.map((s) => s[k]));
  // 소수 지표 반올림
  for (const k of ["lcp", "tbt", "fcp", "si"]) out[k] = Math.round(out[k]);
  out.cls = Math.round(out.cls * 1000) / 1000;
  return out;
}

// ── 메인 ─────────────────────────────────────────────────────
async function main() {
  loadEnv();
  const { target, round, runs } = parseArgs();
  const isDev = target === "dev";
  const isProd = target === "local";
  const usesLocalServer = isDev || isProd;
  const baseUrl = usesLocalServer ? `http://127.0.0.1:${LOCAL_PORT}` : VERCEL_URL;

  // 로컬 서버(dev/prod)는 인증 라우트까지, Vercel은 공개 페이지만.
  const routes = usesLocalServer ? ROUTES : ROUTES.filter((r) => !r.auth);

  console.log(`\n▶ Lighthouse 측정 — target=${target} round=${round} runs=${runs}`);
  console.log(`  기준 URL: ${baseUrl}`);
  console.log(`  라우트: ${routes.map((r) => r.path).join(", ")}\n`);

  const chromeLauncher = await import("chrome-launcher");
  const { default: lighthouse } = await import("lighthouse");

  let server = null;
  let chrome = null;
  try {
    // 1) 로컬이면 서버 기동 (dev: next dev / prod: next start)
    if (usesLocalServer) {
      const cmd = isDev ? "dev" : "start";
      console.log(`· next ${cmd} 기동…`);
      server = spawn("npx", ["next", cmd, "-p", String(LOCAL_PORT)], {
        cwd: process.cwd(),
        env: { ...process.env },
        stdio: "ignore",
        detached: true, // 자체 프로세스 그룹 → 자식 워커까지 그룹째 종료 가능(고아 방지)
      });
      await waitForPort(LOCAL_PORT);
      console.log("· 서버 준비 완료");
    }

    // 2) 인증 쿠키 발급 (인증 라우트가 있으면)
    let cookieHeader = null;
    if (routes.some((r) => r.auth)) {
      cookieHeader = await mintAuthCookies();
    }

    // 3) Chrome 기동
    chrome = await chromeLauncher.launch({
      chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
    });

    // 4) 라우트별 측정
    const report = { round, target, baseUrl, ts: new Date().toISOString(), routes: {} };
    for (const route of routes) {
      process.stdout.write(`· 측정 ${route.path} … `);
      const m = await measureRoute(lighthouse, baseUrl, route, chrome.port, cookieHeader, runs);
      report.routes[route.path] = m;
      console.log(m ? `perf=${m.perf} lcp=${m.lcp}ms tbt=${m.tbt}ms cls=${m.cls}` : "실패");
    }

    // 5) primary objective = perf 단순 평균
    const perfs = Object.values(report.routes).filter(Boolean).map((r) => r.perf);
    report.score = perfs.length ? Math.round((perfs.reduce((a, b) => a + b, 0) / perfs.length) * 10) / 10 : null;

    // 6) 저장
    mkdirSync(OUT_DIR, { recursive: true });
    const file = join(OUT_DIR, `round-${round}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2));
    appendFileSync(JOURNAL, JSON.stringify(report) + "\n");

    console.log(`\n✅ score(perf 평균)=${report.score}  →  ${file}\n`);
  } finally {
    if (chrome) await chrome.kill();
    if (server) {
      try {
        process.kill(-server.pid, "SIGKILL"); // 프로세스 그룹째 종료
      } catch {
        try {
          server.kill("SIGKILL");
        } catch {
          /* 이미 종료됨 */
        }
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
