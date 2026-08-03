#!/usr/bin/env python3
"""OWASP Top 10 2025 스캔 findings(JSON) → self-contained HTML 대시보드.

Artifact 게시용으로 <style>+markup+<script>만 출력한다(래퍼 <html>/<head>/<body> 없음 —
Artifact가 감싼다). 라이트/다크 테마 대응, 가로 스크롤 격리, 반응형.

사용:
    python3 build_dashboard.py findings.json --out dashboard.html
    cat findings.json | python3 build_dashboard.py > dashboard.html

입력 JSON 스키마:
    {
      "meta": { "target": str, "scope": "full"|"diff", "stack": [str],
                "generated": str, "commit": str? },
      "findings": [
        { "category": "A01".."A10", "category_name": str,
          "severity": "critical"|"high"|"medium"|"low"|"info",
          "title": str, "file": str, "line": int?,
          "evidence": str?, "impact": str?, "remediation": str?,
          "confidence": "confirmed"|"plausible"?,
          "scope_tag": "generic"|"stack"?, "maedeup_rule": str? }
      ]
    }
"""
import argparse
import html
import json
import sys

CATEGORIES = [
    ("A01", "Broken Access Control"),
    ("A02", "Security Misconfiguration"),
    ("A03", "Software Supply Chain Failures"),
    ("A04", "Cryptographic Failures"),
    ("A05", "Injection"),
    ("A06", "Insecure Design"),
    ("A07", "Authentication Failures"),
    ("A08", "Software or Data Integrity Failures"),
    ("A09", "Security Logging and Alerting Failures"),
    ("A10", "Mishandling of Exceptional Conditions"),
]
CAT_NAME = dict(CATEGORIES)
SEV_ORDER = ["critical", "high", "medium", "low", "info"]
SEV_RANK = {s: i for i, s in enumerate(SEV_ORDER)}
SEV_LABEL = {"critical": "Critical", "high": "High", "medium": "Medium", "low": "Low", "info": "Info"}


def esc(v):
    return html.escape(str(v if v is not None else ""))


def worst(sevs):
    """리스트 중 가장 심각한 severity 반환(없으면 None)."""
    present = [s for s in SEV_ORDER if s in sevs]
    return present[0] if present else None


def verdict(counts):
    if counts.get("critical"):
        return ("위험", "critical", "critical 등급 결함이 있어 즉시 조치가 필요합니다.")
    if counts.get("high"):
        return ("주의", "high", "릴리스 전 반드시 수정해야 할 high 등급 결함이 있습니다.")
    if counts.get("medium"):
        return ("보통", "medium", "하드닝이 필요한 medium 등급 이슈가 있습니다.")
    if counts.get("low"):
        return ("양호", "low", "심층 방어 관점의 low 등급 개선점만 있습니다.")
    if counts.get("info"):
        return ("클린", "info", "결함은 없고 검토할 관찰 항목만 있습니다.")
    return ("클린", "clean", "발견된 취약점이 없습니다.")


CSS = """
<style>
  .owasp-dash { --bg:#f8fafc; --surface:#ffffff; --surface2:#f1f5f9; --border:#e2e8f0;
    --text:#0f172a; --muted:#64748b; --code:#f1f5f9; --codetext:#334155;
    --critical:#dc2626; --high:#ea580c; --medium:#d97706; --low:#2563eb; --info:#64748b; --clean:#16a34a;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    color:var(--text); background:var(--bg); line-height:1.55; padding:24px; max-width:1100px; margin:0 auto; }
  @media (prefers-color-scheme: dark) { .owasp-dash {
    --bg:#0b1120; --surface:#111827; --surface2:#1e293b; --border:#334155;
    --text:#e2e8f0; --muted:#94a3b8; --code:#0b1120; --codetext:#cbd5e1;
    --critical:#f87171; --high:#fb923c; --medium:#fbbf24; --low:#60a5fa; --info:#94a3b8; --clean:#4ade80; } }
  :root[data-theme="dark"] .owasp-dash { --bg:#0b1120; --surface:#111827; --surface2:#1e293b; --border:#334155;
    --text:#e2e8f0; --muted:#94a3b8; --code:#0b1120; --codetext:#cbd5e1;
    --critical:#f87171; --high:#fb923c; --medium:#fbbf24; --low:#60a5fa; --info:#94a3b8; --clean:#4ade80; }
  :root[data-theme="light"] .owasp-dash { --bg:#f8fafc; --surface:#ffffff; --surface2:#f1f5f9; --border:#e2e8f0;
    --text:#0f172a; --muted:#64748b; --code:#f1f5f9; --codetext:#334155;
    --critical:#dc2626; --high:#ea580c; --medium:#d97706; --low:#2563eb; --info:#64748b; --clean:#16a34a; }
  .owasp-dash * { box-sizing:border-box; }
  .owasp-dash h1 { font-size:1.5rem; margin:0 0 4px; letter-spacing:-.01em; }
  .owasp-dash h2 { font-size:1.05rem; margin:28px 0 12px; padding-bottom:6px; border-bottom:1px solid var(--border); }
  .owasp-dash .meta { color:var(--muted); font-size:.85rem; display:flex; flex-wrap:wrap; gap:8px 14px; margin-bottom:16px; }
  .owasp-dash .chip { display:inline-block; padding:2px 9px; border-radius:999px; font-size:.72rem; font-weight:600;
    background:var(--surface2); border:1px solid var(--border); color:var(--muted); }
  .owasp-dash .banner { border-radius:12px; padding:16px 18px; margin-bottom:20px; border:1px solid var(--border);
    background:var(--surface); display:flex; align-items:center; gap:14px; }
  .owasp-dash .banner .dot { width:14px; height:14px; border-radius:50%; flex:none; }
  .owasp-dash .banner .v { font-size:1.15rem; font-weight:700; }
  .owasp-dash .banner .d { color:var(--muted); font-size:.88rem; }
  .owasp-dash .tiles { display:grid; grid-template-columns:repeat(5,1fr); gap:10px; margin-bottom:8px; }
  @media (max-width:640px){ .owasp-dash .tiles { grid-template-columns:repeat(2,1fr); } }
  .owasp-dash .tile { border:1px solid var(--border); border-radius:10px; padding:12px 14px; background:var(--surface); }
  .owasp-dash .tile .n { font-size:1.7rem; font-weight:700; line-height:1; }
  .owasp-dash .tile .l { font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin-top:4px; }
  .owasp-dash .tile.sev-critical { border-left:4px solid var(--critical); }
  .owasp-dash .tile.sev-high { border-left:4px solid var(--high); }
  .owasp-dash .tile.sev-medium { border-left:4px solid var(--medium); }
  .owasp-dash .tile.sev-low { border-left:4px solid var(--low); }
  .owasp-dash .tile.sev-info { border-left:4px solid var(--info); }
  .owasp-dash .grid { display:grid; grid-template-columns:repeat(5,1fr); gap:10px; }
  @media (max-width:820px){ .owasp-dash .grid { grid-template-columns:repeat(2,1fr); } }
  .owasp-dash .cat { border:1px solid var(--border); border-radius:10px; padding:11px 12px; background:var(--surface);
    text-decoration:none; color:inherit; display:block; }
  .owasp-dash .cat .id { font-weight:700; font-size:.82rem; }
  .owasp-dash .cat .nm { font-size:.72rem; color:var(--muted); margin:3px 0 8px; min-height:2.1em; }
  .owasp-dash .cat .cnt { font-size:.72rem; font-weight:600; }
  .owasp-dash .cat.hit { border-top:3px solid var(--sev); }
  .owasp-dash .cat.clean .cnt { color:var(--clean); }
  .owasp-dash .finding { border:1px solid var(--border); border-radius:10px; margin:10px 0; background:var(--surface);
    overflow:hidden; border-left:4px solid var(--sev); }
  .owasp-dash .finding .hd { padding:12px 14px; display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
  .owasp-dash .finding .badge { font-size:.68rem; font-weight:700; text-transform:uppercase; letter-spacing:.03em;
    padding:2px 8px; border-radius:6px; color:#fff; background:var(--sev); }
  .owasp-dash .finding .ttl { font-weight:650; font-size:.95rem; flex:1 1 auto; min-width:200px; }
  .owasp-dash .finding .loc { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.76rem;
    color:var(--muted); word-break:break-all; }
  .owasp-dash .finding .bd { padding:0 14px 14px; font-size:.88rem; }
  .owasp-dash .finding .row { margin-top:10px; }
  .owasp-dash .finding .row .k { font-size:.7rem; text-transform:uppercase; letter-spacing:.04em; color:var(--muted);
    font-weight:700; margin-bottom:3px; }
  .owasp-dash pre { background:var(--code); color:var(--codetext); border:1px solid var(--border); border-radius:8px;
    padding:10px 12px; overflow-x:auto; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    font-size:.78rem; margin:0; }
  .owasp-dash .tags { display:flex; gap:6px; flex-wrap:wrap; }
  .owasp-dash .conf-confirmed { background:var(--critical); }
  .owasp-dash .conf-plausible { background:var(--muted); }
  .owasp-dash .tag { font-size:.66rem; font-weight:600; padding:1px 7px; border-radius:5px; color:#fff; }
  .owasp-dash .empty { color:var(--muted); font-style:italic; padding:8px 0; }
  .owasp-dash footer { margin-top:32px; color:var(--muted); font-size:.75rem; border-top:1px solid var(--border);
    padding-top:12px; }
</style>
"""


def render(data):
    meta = data.get("meta", {})
    findings = data.get("findings", []) or []

    # severity 정규화 + 정렬
    for f in findings:
        if f.get("severity") not in SEV_RANK:
            f["severity"] = "info"
    findings.sort(key=lambda f: (f.get("category", "A99"), SEV_RANK[f["severity"]]))

    counts = {s: 0 for s in SEV_ORDER}
    for f in findings:
        counts[f["severity"]] += 1
    cat_sevs = {c: [] for c, _ in CATEGORIES}
    for f in findings:
        c = f.get("category")
        if c in cat_sevs:
            cat_sevs[c].append(f["severity"])

    vlabel, vsev, vdesc = verdict(counts)
    vcolor = "var(--clean)" if vsev == "clean" else f"var(--{vsev})"

    out = ['<div class="owasp-dash">', CSS]

    # 헤더
    out.append("<h1>🛡️ OWASP Top 10:2025 보안 스캔</h1>")
    mparts = []
    if meta.get("target"):
        mparts.append(f'<span class="chip">📁 {esc(meta["target"])}</span>')
    scope = meta.get("scope", "full")
    mparts.append(f'<span class="chip">범위: {"변경 diff" if scope == "diff" else "전체 코드베이스"}</span>')
    for s in meta.get("stack", []) or []:
        mparts.append(f'<span class="chip">{esc(s)}</span>')
    if meta.get("commit"):
        mparts.append(f'<span class="chip">commit {esc(meta["commit"])}</span>')
    if meta.get("generated"):
        mparts.append(f'<span class="chip">{esc(meta["generated"])}</span>')
    mparts.append(f'<span class="chip">총 {len(findings)}건</span>')
    out.append(f'<div class="meta">{"".join(mparts)}</div>')

    # 판정 배너
    out.append(
        f'<div class="banner"><span class="dot" style="background:{vcolor}"></span>'
        f'<div><div class="v" style="color:{vcolor}">{esc(vlabel)}</div>'
        f'<div class="d">{esc(vdesc)}</div></div></div>'
    )

    # 심각도 타일
    out.append('<div class="tiles">')
    for s in SEV_ORDER:
        out.append(
            f'<div class="tile sev-{s}"><div class="n" style="color:var(--{s})">{counts[s]}</div>'
            f'<div class="l">{SEV_LABEL[s]}</div></div>'
        )
    out.append("</div>")

    # OWASP 커버리지 그리드
    out.append("<h2>카테고리 커버리지</h2>")
    out.append('<div class="grid">')
    for cid, cname in CATEGORIES:
        sevs = cat_sevs[cid]
        w = worst(sevs)
        if w:
            out.append(
                f'<a class="cat hit" href="#cat-{cid}" style="--sev:var(--{w})">'
                f'<div class="id">{cid}</div><div class="nm">{esc(cname)}</div>'
                f'<div class="cnt" style="color:var(--{w})">{len(sevs)}건 · {SEV_LABEL[w]}</div></a>'
            )
        else:
            out.append(
                f'<div class="cat clean"><div class="id">{cid}</div>'
                f'<div class="nm">{esc(cname)}</div><div class="cnt">✓ 무결함</div></div>'
            )
    out.append("</div>")

    # findings — 카테고리별
    out.append("<h2>발견 상세</h2>")
    if not findings:
        out.append('<p class="empty">발견된 취약점이 없습니다. 🎉</p>')
    for cid, cname in CATEGORIES:
        group = [f for f in findings if f.get("category") == cid]
        if not group:
            continue
        out.append(f'<h3 id="cat-{cid}" style="margin:22px 0 4px;font-size:.95rem">{cid} · {esc(cname)} ({len(group)})</h3>')
        for f in group:
            sev = f["severity"]
            out.append(f'<div class="finding" style="--sev:var(--{sev})">')
            # 헤더
            out.append('<div class="hd">')
            out.append(f'<span class="badge">{SEV_LABEL[sev]}</span>')
            out.append(f'<span class="ttl">{esc(f.get("title", "(제목 없음)"))}</span>')
            out.append("</div>")
            # 본문
            out.append('<div class="bd">')
            loc = esc(f.get("file", "")) + (f":{esc(f.get('line'))}" if f.get("line") else "")
            tags = []
            conf = f.get("confidence")
            if conf in ("confirmed", "plausible"):
                tags.append(f'<span class="tag conf-{conf}">{"확인됨" if conf == "confirmed" else "추정"}</span>')
            if f.get("scope_tag") == "stack":
                tags.append('<span class="tag" style="background:var(--low)">스택 규칙</span>')
            out.append(
                f'<div class="hd" style="padding:8px 0 0"><span class="loc">{loc}</span>'
                f'<span class="tags">{"".join(tags)}</span></div>'
            )
            if f.get("evidence"):
                out.append(f'<div class="row"><div class="k">근거</div><pre>{esc(f["evidence"])}</pre></div>')
            if f.get("impact"):
                out.append(f'<div class="row"><div class="k">영향</div>{esc(f["impact"])}</div>')
            if f.get("remediation"):
                out.append(f'<div class="row"><div class="k">수정 방안</div>{esc(f["remediation"])}</div>')
            if f.get("maedeup_rule"):
                out.append(f'<div class="row"><div class="k">관련 규칙</div>{esc(f["maedeup_rule"])}</div>')
            out.append("</div></div>")

    out.append(
        '<footer>OWASP Top 10:2025 기준 · 카테고리별 병렬 서브에이전트 스캔 + verify 검증 · '
        'confirmed=검증 통과, plausible=추가 확인 권장. 자동 스캔은 완전하지 않으니 수동 검토를 병행하세요.</footer>'
    )
    out.append("</div>")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description="OWASP findings JSON → HTML 대시보드")
    ap.add_argument("input", nargs="?", help="findings JSON 경로 (없으면 stdin)")
    ap.add_argument("--out", help="출력 HTML 경로 (없으면 stdout)")
    args = ap.parse_args()

    raw = open(args.input, encoding="utf-8").read() if args.input else sys.stdin.read()
    data = json.loads(raw)
    htmlout = render(data)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(htmlout)
        print(f"wrote {args.out} ({len(data.get('findings', []))} findings)", file=sys.stderr)
    else:
        sys.stdout.write(htmlout)


if __name__ == "__main__":
    main()
