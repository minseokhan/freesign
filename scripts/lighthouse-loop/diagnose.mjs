// 특정 URL의 Lighthouse "실행 가능한 최적화 기회"만 추출한다.
// 루프의 제안 단계 서브에이전트에게 구체적 표적을 먹이기 위함.
//
//   node scripts/lighthouse-loop/diagnose.mjs <url>
//   node scripts/lighthouse-loop/diagnose.mjs https://freesign.vercel.app/

const url = process.argv[2] ?? "https://freesign.vercel.app/";

const chromeLauncher = await import("chrome-launcher");
const { default: lighthouse } = await import("lighthouse");

const chrome = await chromeLauncher.launch({
  chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
});
try {
  const { lhr } = await lighthouse(url, {
    port: chrome.port,
    output: "json",
    logLevel: "error",
    onlyCategories: ["performance"],
  });

  console.log(`\n▶ ${url}`);
  console.log(`  Performance: ${Math.round(lhr.categories.performance.score * 100)}\n`);

  const metrics = ["largest-contentful-paint", "first-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index", "server-response-time"];
  console.log("── 핵심 지표 ──");
  for (const id of metrics) {
    const a = lhr.audits[id];
    if (a) console.log(`  ${a.title}: ${a.displayValue ?? a.numericValue}`);
  }

  console.log("\n── 최적화 기회 (점수 미달 + 절감 여지) ──");
  const opps = Object.values(lhr.audits)
    .filter((a) => a.details?.type === "opportunity" || a.metricSavings)
    .filter((a) => (a.score ?? 1) < 1)
    .sort((a, b) => (b.numericValue ?? 0) - (a.numericValue ?? 0));

  if (!opps.length) {
    console.log("  (없음 — 절감 여지 있는 기회 감사 통과)");
  }
  for (const a of opps) {
    const saving = a.details?.overallSavingsMs
      ? `~${Math.round(a.details.overallSavingsMs)}ms 절감`
      : a.displayValue ?? "";
    console.log(`  • [${a.id}] ${a.title} — ${saving}`);
    // 관련 리소스 상위 3개
    const items = a.details?.items?.slice(0, 3) ?? [];
    for (const it of items) {
      const label = it.url ?? it.node?.snippet ?? it.source?.url ?? "";
      if (label) console.log(`      - ${String(label).slice(0, 90)}`);
    }
  }

  console.log("\n── 진단(diagnostics) 통과 못 한 항목 ──");
  const diags = Object.values(lhr.audits)
    .filter((a) => a.scoreDisplayMode === "binary" && a.score === 0 && a.details?.type === "table")
    .filter((a) => !["largest-contentful-paint", "first-contentful-paint"].includes(a.id));
  for (const a of diags) {
    console.log(`  • [${a.id}] ${a.title}${a.displayValue ? ` — ${a.displayValue}` : ""}`);
  }
  console.log("");
} finally {
  await chrome.kill();
}
