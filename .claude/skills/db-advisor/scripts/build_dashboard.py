#!/usr/bin/env python3
"""Supabase 어드바이저 findings(JSON) → self-contained HTML 대시보드.

Artifact 게시용으로 <style>+markup만 출력한다(래퍼 <html>/<head>/<body> 없음 —
Artifact가 감싼다). 라이트/다크 테마 대응, 가로 스크롤 격리, 반응형.

사용:
    python3 build_dashboard.py findings.json --out dashboard.html
    cat findings.json | python3 build_dashboard.py > dashboard.html

입력 JSON 스키마:
    {
      "meta": { "project": str, "project_ref": str?, "generated": str,
                "types": ["security","performance"] },
      "findings": [
        { "lint": str,               # 린트 슬러그 (name)
          "title": str,
          "level": "ERROR"|"WARN"|"INFO",
          "category": "SECURITY"|"PERFORMANCE",
          "detail": str?,            # 어드바이저 detail 문장
          "entity": str?,            # 대상 객체 (public.set_updated_at 등)
          "remediation_url": str?,   # 문서 링크
          "bucket": "auto"|"review"|"manual",
          "fix_sql": str?,           # 제안 수정 SQL (manual이면 null)
          "fix_note": str? }         # 판단 근거/경고 한 줄
      ]
    }
"""
import argparse
import html
import json
import sys

LEVEL_ORDER = ["ERROR", "WARN", "INFO"]
LEVEL_RANK = {s: i for i, s in enumerate(LEVEL_ORDER)}
LEVEL_LABEL = {"ERROR": "Error", "WARN": "Warn", "INFO": "Info"}
LEVEL_VAR = {"ERROR": "error", "WARN": "warn", "INFO": "info"}

BUCKETS = ["auto", "review", "manual"]
BUCKET_LABEL = {"auto": "🟢 자동 수정 가능", "review": "🟡 검토 필요", "manual": "⚪ 수동 조치"}
BUCKET_VAR = {"auto": "auto", "review": "review", "manual": "manual"}

CAT_LABEL = {"SECURITY": "보안", "PERFORMANCE": "성능"}


def esc(v):
    return html.escape(str(v if v is not None else ""))


def verdict(counts):
    if counts.get("ERROR"):
        return ("위험", "error", "ERROR 등급 린트가 있어 즉시 조치가 필요합니다.")
    if counts.get("WARN"):
        return ("주의", "warn", "WARN 등급 보안·설정 린트가 있습니다. 검토 후 수정하세요.")
    if counts.get("INFO"):
        return ("보통", "info", "INFO 등급 성능·관찰 항목만 있습니다.")
    return ("클린", "clean", "어드바이저가 발견한 항목이 없습니다.")


CSS = """
<style>
  .db-dash { --bg:#f8fafc; --surface:#ffffff; --surface2:#f1f5f9; --border:#e2e8f0;
    --text:#0f172a; --muted:#64748b; --code:#f1f5f9; --codetext:#334155;
    --error:#dc2626; --warn:#ea580c; --info:#2563eb; --clean:#16a34a;
    --auto:#16a34a; --review:#d97706; --manual:#64748b;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    color:var(--text); background:var(--bg); line-height:1.55; padding:24px; max-width:1100px; margin:0 auto; }
  @media (prefers-color-scheme: dark) { .db-dash {
    --bg:#0b1120; --surface:#111827; --surface2:#1e293b; --border:#334155;
    --text:#e2e8f0; --muted:#94a3b8; --code:#0b1120; --codetext:#cbd5e1;
    --error:#f87171; --warn:#fb923c; --info:#60a5fa; --clean:#4ade80;
    --auto:#4ade80; --review:#fbbf24; --manual:#94a3b8; } }
  :root[data-theme="dark"] .db-dash { --bg:#0b1120; --surface:#111827; --surface2:#1e293b; --border:#334155;
    --text:#e2e8f0; --muted:#94a3b8; --code:#0b1120; --codetext:#cbd5e1;
    --error:#f87171; --warn:#fb923c; --info:#60a5fa; --clean:#4ade80;
    --auto:#4ade80; --review:#fbbf24; --manual:#94a3b8; }
  :root[data-theme="light"] .db-dash { --bg:#f8fafc; --surface:#ffffff; --surface2:#f1f5f9; --border:#e2e8f0;
    --text:#0f172a; --muted:#64748b; --code:#f1f5f9; --codetext:#334155;
    --error:#dc2626; --warn:#ea580c; --info:#2563eb; --clean:#16a34a;
    --auto:#16a34a; --review:#d97706; --manual:#64748b; }
  .db-dash * { box-sizing:border-box; }
  .db-dash h1 { font-size:1.5rem; margin:0 0 4px; letter-spacing:-.01em; }
  .db-dash h2 { font-size:1.05rem; margin:28px 0 12px; padding-bottom:6px; border-bottom:1px solid var(--border); }
  .db-dash .meta { color:var(--muted); font-size:.85rem; display:flex; flex-wrap:wrap; gap:8px 14px; margin-bottom:16px; }
  .db-dash .chip { display:inline-block; padding:2px 9px; border-radius:999px; font-size:.72rem; font-weight:600;
    background:var(--surface2); border:1px solid var(--border); color:var(--muted); }
  .db-dash .banner { border-radius:12px; padding:16px 18px; margin-bottom:20px; border:1px solid var(--border);
    background:var(--surface); display:flex; align-items:center; gap:14px; }
  .db-dash .banner .dot { width:14px; height:14px; border-radius:50%; flex:none; }
  .db-dash .banner .v { font-size:1.15rem; font-weight:700; }
  .db-dash .banner .d { color:var(--muted); font-size:.88rem; }
  .db-dash .tiles { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:8px; }
  @media (max-width:640px){ .db-dash .tiles { grid-template-columns:repeat(3,1fr); } }
  .db-dash .tile { border:1px solid var(--border); border-radius:10px; padding:12px 14px; background:var(--surface); }
  .db-dash .tile .n { font-size:1.7rem; font-weight:700; line-height:1; }
  .db-dash .tile .l { font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin-top:4px; }
  .db-dash .tile.lv-error { border-left:4px solid var(--error); }
  .db-dash .tile.lv-warn { border-left:4px solid var(--warn); }
  .db-dash .tile.lv-info { border-left:4px solid var(--info); }
  .db-dash .summary { display:grid; grid-template-columns:repeat(2,1fr); gap:14px; margin-top:14px; }
  @media (max-width:720px){ .db-dash .summary { grid-template-columns:1fr; } }
  .db-dash .card { border:1px solid var(--border); border-radius:10px; padding:14px 16px; background:var(--surface); }
  .db-dash .card .ct { font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; color:var(--muted);
    font-weight:700; margin-bottom:10px; }
  .db-dash .card .row { display:flex; justify-content:space-between; align-items:center; padding:4px 0; font-size:.88rem; }
  .db-dash .card .row .num { font-weight:700; }
  .db-dash .finding { border:1px solid var(--border); border-radius:10px; margin:10px 0; background:var(--surface);
    overflow:hidden; border-left:4px solid var(--bkt); }
  .db-dash .finding .hd { padding:12px 14px; display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
  .db-dash .finding .badge { font-size:.68rem; font-weight:700; text-transform:uppercase; letter-spacing:.03em;
    padding:2px 8px; border-radius:6px; color:#fff; background:var(--bkt); }
  .db-dash .finding .lvl { font-size:.66rem; font-weight:700; padding:1px 7px; border-radius:5px; color:#fff; }
  .db-dash .finding .ttl { font-weight:650; font-size:.95rem; flex:1 1 auto; min-width:200px; }
  .db-dash .finding .ent { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.76rem;
    color:var(--muted); word-break:break-all; }
  .db-dash .finding .bd { padding:0 14px 14px; font-size:.88rem; }
  .db-dash .finding .row { margin-top:10px; }
  .db-dash .finding .row .k { font-size:.7rem; text-transform:uppercase; letter-spacing:.04em; color:var(--muted);
    font-weight:700; margin-bottom:3px; }
  .db-dash pre { background:var(--code); color:var(--codetext); border:1px solid var(--border); border-radius:8px;
    padding:10px 12px; overflow-x:auto; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
    font-size:.78rem; margin:0; }
  .db-dash a.doc { color:var(--info); font-size:.78rem; text-decoration:none; }
  .db-dash a.doc:hover { text-decoration:underline; }
  .db-dash .empty { color:var(--muted); font-style:italic; padding:8px 0; }
  .db-dash footer { margin-top:32px; color:var(--muted); font-size:.75rem; border-top:1px solid var(--border);
    padding-top:12px; }
</style>
"""


def render(data):
    meta = data.get("meta", {})
    findings = data.get("findings", []) or []

    for f in findings:
        if f.get("level") not in LEVEL_RANK:
            f["level"] = "INFO"
        if f.get("bucket") not in BUCKETS:
            f["bucket"] = "review"

    # 정렬: 레벨(심각) → 버킷(자동 먼저) → 카테고리
    bkt_rank = {b: i for i, b in enumerate(BUCKETS)}
    findings.sort(key=lambda f: (LEVEL_RANK[f["level"]], bkt_rank[f["bucket"]], f.get("category", "")))

    lvl_counts = {s: 0 for s in LEVEL_ORDER}
    cat_counts = {"SECURITY": 0, "PERFORMANCE": 0}
    bkt_counts = {b: 0 for b in BUCKETS}
    for f in findings:
        lvl_counts[f["level"]] += 1
        cat_counts[f.get("category", "SECURITY")] = cat_counts.get(f.get("category", "SECURITY"), 0) + 1
        bkt_counts[f["bucket"]] += 1

    vlabel, vsev, vdesc = verdict(lvl_counts)
    vcolor = "var(--clean)" if vsev == "clean" else f"var(--{vsev})"

    out = ['<div class="db-dash">', CSS]

    # 헤더
    out.append("<h1>🩺 Supabase DB 어드바이저</h1>")
    mparts = []
    if meta.get("project"):
        mparts.append(f'<span class="chip">🗄️ {esc(meta["project"])}</span>')
    if meta.get("project_ref"):
        mparts.append(f'<span class="chip">{esc(meta["project_ref"])}</span>')
    for t in meta.get("types", []) or []:
        mparts.append(f'<span class="chip">{esc(t)}</span>')
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

    # 레벨 타일
    out.append('<div class="tiles">')
    for s in LEVEL_ORDER:
        out.append(
            f'<div class="tile lv-{LEVEL_VAR[s]}"><div class="n" style="color:var(--{LEVEL_VAR[s]})">{lvl_counts[s]}</div>'
            f'<div class="l">{LEVEL_LABEL[s]}</div></div>'
        )
    out.append("</div>")

    # 카테고리 + 버킷 요약
    out.append('<div class="summary">')
    out.append('<div class="card"><div class="ct">카테고리</div>')
    for c in ("SECURITY", "PERFORMANCE"):
        out.append(
            f'<div class="row"><span>{CAT_LABEL[c]}</span>'
            f'<span class="num">{cat_counts.get(c, 0)}건</span></div>'
        )
    out.append("</div>")
    out.append('<div class="card"><div class="ct">수정 가능성</div>')
    for b in BUCKETS:
        out.append(
            f'<div class="row"><span>{BUCKET_LABEL[b]}</span>'
            f'<span class="num" style="color:var(--{BUCKET_VAR[b]})">{bkt_counts[b]}건</span></div>'
        )
    out.append("</div></div>")

    # findings 상세
    out.append("<h2>발견 상세</h2>")
    if not findings:
        out.append('<p class="empty">어드바이저가 발견한 항목이 없습니다. 🎉</p>')
    for f in findings:
        bkt = f["bucket"]
        lvl = f["level"]
        out.append(f'<div class="finding" style="--bkt:var(--{BUCKET_VAR[bkt]})">')
        # 헤더
        out.append('<div class="hd">')
        out.append(f'<span class="badge">{BUCKET_LABEL[bkt].split(" ", 1)[-1]}</span>')
        out.append(f'<span class="lvl" style="background:var(--{LEVEL_VAR[lvl]})">{LEVEL_LABEL[lvl]}</span>')
        out.append(f'<span class="ttl">{esc(f.get("title", f.get("lint", "(제목 없음)")))}</span>')
        out.append("</div>")
        # 본문
        out.append('<div class="bd">')
        ent = f.get("entity")
        lint = f.get("lint")
        meta_line = []
        if ent:
            meta_line.append(f'<span class="ent">{esc(ent)}</span>')
        if lint:
            meta_line.append(f'<span class="chip">{esc(lint)}</span>')
        if meta_line:
            out.append(f'<div class="hd" style="padding:8px 0 0">{"".join(meta_line)}</div>')
        if f.get("detail"):
            out.append(f'<div class="row"><div class="k">설명</div>{esc(f["detail"])}</div>')
        if f.get("fix_note"):
            out.append(f'<div class="row"><div class="k">판단</div>{esc(f["fix_note"])}</div>')
        if f.get("fix_sql"):
            out.append(f'<div class="row"><div class="k">제안 수정 SQL</div><pre>{esc(f["fix_sql"])}</pre></div>')
        elif bkt == "manual":
            out.append('<div class="row"><div class="k">수정</div>SQL로 고칠 수 없는 항목입니다(대시보드/설정 조치).</div>')
        if f.get("remediation_url"):
            out.append(
                f'<div class="row"><a class="doc" href="{esc(f["remediation_url"])}" '
                f'target="_blank" rel="noopener">📖 Supabase 문서 →</a></div>'
            )
        out.append("</div></div>")

    out.append(
        '<footer>Supabase MCP get_advisors 기준 · 🟢 자동=안전·가역, 🟡 검토=판단 필요·비가역 주의, ⚪ 수동=설정 조치. '
        '어드바이저는 정적 린트라 완전하지 않습니다 — 특히 "미사용 인덱스"는 신규·저트래픽일 수 있고, '
        'RLS·정책 변경은 앱 동작에 영향을 주니 적용 전 검토하세요.</footer>'
    )
    out.append("</div>")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description="Supabase 어드바이저 findings JSON → HTML 대시보드")
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
