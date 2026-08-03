#!/usr/bin/env python3
"""Lighthouse 최적화 루프 리포트 → self-contained HTML 대시보드.

입력 JSON 스키마:
{
  "meta": { "generated": "2026-07-16", "verdict": "optimized" | "improved",
            "score": 98.4, "score_baseline": 98.4 },
  "verdict": { "headline": "루프 판정: 이미 최적화됨 (정체)",
               "detail": "…한두 문장…",
               "pill": "1개 실험 · 0 채택 · 되돌림 완료 · 소스 무변경" },
  "baseline": {
     "routes": [ { "path": "/", "label": "랜딩", "perf": 99, "lcp": "2.03 s",
                   "tbt": "18 ms", "cls": "0", "a11y": 96, "bp": 100, "seo": 100 }, … ],
     "note": "Vercel 실측(공개): / 89–96, /login 99. …"        # 선택
  },
  "rounds": [
     { "n": 1, "status": "rejected" | "accepted",
       "hypothesis": "jsDelivr CDN 폰트 → self-host next/font/local",
       "summary": "…", "cause": "…원인…", "note": "…선택…",
       "deltas": [ { "label": "Perf 평균", "from": "98.4", "to": "75", "worse": true },
                   { "label": "LCP (/)", "from": "2.03 s", "to": "12.0 s", "worse": true } ] } … ],
  "opportunities": [ { "rank": "01", "title": "렌더 차단 리소스 제거",
                       "desc": "…", "saving": "~750 ms", "tier": "big"|"mid"|"low" } … ],
  "recommendations": [ { "tag": "rec"|"opt"|"skip", "title": "지금 상태 유지",
                         "body": "…" } … ],
  "deliverables": [ { "path": "scripts/lighthouse-loop/measure.mjs", "desc": "…" } … ],
  "flow": ["제안 (코드 분석)", "적용 (워킹트리)", …]                # 선택, 없으면 기본값
}

사용: python3 build_report.py <input.json> --out <output.html>
"""
import argparse
import html
import json
import sys

CSS = """
:root{--ground:#f8fafc;--panel:#fff;--panel-2:#f1f5f9;--border:#e2e8f0;--border-strong:#cbd5e1;--ink:#0f172a;--body:#334155;--muted:#64748b;--accent:#2563eb;--accent-soft:#eff6ff;--good:#16a34a;--good-bg:#f0fdf4;--warn:#d97706;--warn-bg:#fffbeb;--bad:#dc2626;--bad-bg:#fef2f2;--shadow:0 1px 2px rgba(15,23,42,.06),0 1px 3px rgba(15,23,42,.10);--mono:ui-monospace,"SF Mono","SFMono-Regular",Menlo,Consolas,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
@media (prefers-color-scheme:dark){:root{--ground:#0b1120;--panel:#131c2e;--panel-2:#1a2436;--border:#24304a;--border-strong:#33415c;--ink:#f1f5f9;--body:#cbd5e1;--muted:#8ba0bd;--accent:#60a5fa;--accent-soft:#16233c;--good:#4ade80;--good-bg:#12251a;--warn:#fbbf24;--warn-bg:#2a2010;--bad:#f87171;--bad-bg:#2c1516;--shadow:0 1px 2px rgba(0,0,0,.4),0 2px 8px rgba(0,0,0,.3)}}
:root[data-theme="light"]{--ground:#f8fafc;--panel:#fff;--panel-2:#f1f5f9;--border:#e2e8f0;--border-strong:#cbd5e1;--ink:#0f172a;--body:#334155;--muted:#64748b;--accent:#2563eb;--accent-soft:#eff6ff;--good:#16a34a;--good-bg:#f0fdf4;--warn:#d97706;--warn-bg:#fffbeb;--bad:#dc2626;--bad-bg:#fef2f2;--shadow:0 1px 2px rgba(15,23,42,.06),0 1px 3px rgba(15,23,42,.10)}
:root[data-theme="dark"]{--ground:#0b1120;--panel:#131c2e;--panel-2:#1a2436;--border:#24304a;--border-strong:#33415c;--ink:#f1f5f9;--body:#cbd5e1;--muted:#8ba0bd;--accent:#60a5fa;--accent-soft:#16233c;--good:#4ade80;--good-bg:#12251a;--warn:#fbbf24;--warn-bg:#2a2010;--bad:#f87171;--bad-bg:#2c1516;--shadow:0 1px 2px rgba(0,0,0,.4),0 2px 8px rgba(0,0,0,.3)}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--body);font-family:var(--sans);line-height:1.6;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
.wrap{max-width:940px;margin:0 auto;padding:clamp(28px,5vw,64px) clamp(18px,4vw,40px) 96px}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:600;margin:0 0 12px}
h1{font-size:clamp(28px,4.4vw,42px);line-height:1.12;letter-spacing:-.02em;color:var(--ink);font-weight:750;margin:0 0 14px;text-wrap:balance}
.lede{font-size:clamp(16px,2vw,18px);color:var(--muted);margin:0;max-width:62ch}
h2{font-size:13px;font-family:var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600;margin:0 0 18px;display:flex;align-items:center;gap:12px}
h2::after{content:"";flex:1;height:1px;background:var(--border)}
section{margin-top:56px}
.verdict{margin-top:32px;display:grid;grid-template-columns:auto 1fr;gap:clamp(20px,4vw,40px);align-items:center;background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:clamp(22px,3.5vw,34px);box-shadow:var(--shadow);position:relative;overflow:hidden}
.verdict::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--vbar,var(--good))}
.gauge{display:grid;place-items:center;text-align:center}
.gauge .num{font-family:var(--mono);font-size:clamp(46px,8vw,68px);font-weight:700;color:var(--vbar,var(--good));line-height:1;letter-spacing:-.03em}
.gauge .den{font-family:var(--mono);font-size:15px;color:var(--muted);margin-top:4px}
.gauge .cap{font-size:12px;color:var(--muted);margin-top:8px;letter-spacing:.04em}
.verdict-text h3{margin:0 0 8px;font-size:20px;color:var(--ink);font-weight:700;letter-spacing:-.01em}
.verdict-text p{margin:0;color:var(--body);font-size:15px}
.verdict-text .pill{display:inline-block;margin-top:14px;font-family:var(--mono);font-size:12px;background:var(--good-bg);color:var(--good);border:1px solid color-mix(in srgb,var(--good) 30%,transparent);padding:4px 12px;border-radius:999px;font-weight:600}
.tablecard{border:1px solid var(--border);border-radius:14px;overflow:hidden;box-shadow:var(--shadow);background:var(--panel)}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px;min-width:640px}
thead th{text-align:right;font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:14px 16px;background:var(--panel-2);border-bottom:1px solid var(--border)}
thead th:first-child{text-align:left}
tbody td{padding:13px 16px;text-align:right;border-bottom:1px solid var(--border);font-family:var(--mono);color:var(--body)}
tbody tr:last-child td{border-bottom:none}
tbody td:first-child{text-align:left;font-family:var(--sans);color:var(--ink);font-weight:600}
tbody tr:hover td{background:var(--panel-2)}
.chip{display:inline-flex;align-items:center;justify-content:center;min-width:42px;font-family:var(--mono);font-weight:700;font-size:13px;padding:3px 9px;border-radius:8px}
.c-good{background:var(--good-bg);color:var(--good)}.c-warn{background:var(--warn-bg);color:var(--warn)}.c-bad{background:var(--bad-bg);color:var(--bad)}
.muted{color:var(--muted)}
.legend{display:flex;flex-wrap:wrap;gap:16px;margin-top:14px;font-size:12px;color:var(--muted);font-family:var(--mono)}
.legend span{display:inline-flex;align-items:center;gap:6px}
.dot{width:9px;height:9px;border-radius:3px}
.exp{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:clamp(20px,3vw,28px);box-shadow:var(--shadow);border-left:4px solid var(--ebar);margin-bottom:14px}
.exp-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:12px;margin-bottom:4px}
.exp-head .rnd{font-family:var(--mono);font-size:12px;color:var(--muted);letter-spacing:.06em}
.exp-head .vt{font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:.06em;padding:3px 10px;border-radius:999px;background:var(--etag-bg);color:var(--etag);border:1px solid color-mix(in srgb,var(--etag) 30%,transparent)}
.exp h3{margin:0 0 16px;font-size:18px;color:var(--ink);font-weight:700;letter-spacing:-.01em}
.exp p{margin:0 0 16px;font-size:14.5px}
.delta{display:grid;gap:14px;margin:20px 0 4px}
.delta-row{display:grid;grid-template-columns:110px 1fr auto;align-items:center;gap:14px}
.delta-row .lbl{font-family:var(--mono);font-size:12px;color:var(--muted)}
.bar-track{height:26px;background:var(--panel-2);border-radius:7px;overflow:hidden;display:flex;border:1px solid var(--border)}
.bar-fill{height:100%}
.delta-row .val{font-family:var(--mono);font-size:13px;text-align:right;white-space:nowrap}
.val .was{color:var(--muted)}.val .arw{color:var(--muted);margin:0 4px}
.val .is-bad{color:var(--bad);font-weight:700}.val .is-good{color:var(--good);font-weight:700}
.note{background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--accent) 25%,transparent);border-radius:12px;padding:20px 22px;font-size:14.5px;color:var(--body)}
.note strong{color:var(--ink)}
.opps{display:grid;gap:12px}
.opp{display:grid;grid-template-columns:auto 1fr auto;gap:16px;align-items:center;background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px 18px;box-shadow:var(--shadow)}
.opp .rank{font-family:var(--mono);font-size:12px;color:var(--muted);font-weight:600}
.opp .body h4{margin:0 0 3px;font-size:15px;color:var(--ink);font-weight:650}
.opp .body p{margin:0;font-size:13px;color:var(--muted)}
.opp .save{font-family:var(--mono);font-size:13px;font-weight:700;white-space:nowrap;text-align:right}
.save.big{color:var(--bad)}.save.mid{color:var(--warn)}.save.low{color:var(--muted)}
.recs{display:grid;gap:14px}
.rec{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:18px 20px;box-shadow:var(--shadow)}
.rec h4{margin:0 0 6px;font-size:15.5px;color:var(--ink);font-weight:680;display:flex;align-items:center;gap:10px}
.rec h4 .tag{font-family:var(--mono);font-size:10.5px;letter-spacing:.05em;padding:2px 8px;border-radius:999px;font-weight:700;text-transform:uppercase}
.tag-rec{background:var(--good-bg);color:var(--good)}.tag-opt{background:var(--accent-soft);color:var(--accent)}.tag-skip{background:var(--panel-2);color:var(--muted)}
.rec p{margin:0;font-size:13.5px;color:var(--body)}
.files{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.file{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
.file code{font-family:var(--mono);font-size:12.5px;color:var(--accent);font-weight:600}
.file p{margin:6px 0 0;font-size:12.5px;color:var(--muted)}
.flow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-family:var(--mono);font-size:12.5px;color:var(--muted);margin-top:6px}
.flow .step{background:var(--panel-2);border:1px solid var(--border);padding:5px 11px;border-radius:7px;color:var(--body)}
.flow .arr{color:var(--border-strong)}
footer{margin-top:64px;padding-top:20px;border-top:1px solid var(--border);font-size:12px;color:var(--muted);font-family:var(--mono);display:flex;flex-wrap:wrap;gap:8px 20px;justify-content:space-between}
"""

DEFAULT_FLOW = ["제안 (코드 분석)", "적용 (워킹트리)", "게이트 (test + build)",
                "측정 (prod build)", "유지 / 되돌리기", "정체까지 반복"]


def e(s):
    return html.escape(str(s), quote=True)


def score_class(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return ""
    return "c-good" if n >= 90 else ("c-warn" if n >= 50 else "c-bad")


def chip(v):
    return f'<span class="chip {score_class(v)}">{e(v)}</span>'


def render_baseline(bl):
    if not bl or not bl.get("routes"):
        return ""
    rows = []
    for r in bl["routes"]:
        label = f' <span class="muted">{e(r["label"])}</span>' if r.get("label") else ""
        rows.append(
            f'<tr><td>{e(r.get("path",""))}{label}</td>'
            f'<td>{chip(r.get("perf",""))}</td>'
            f'<td>{e(r.get("lcp",""))}</td><td>{e(r.get("tbt",""))}</td><td>{e(r.get("cls",""))}</td>'
            f'<td>{chip(r.get("a11y",""))}</td>'
            f'<td>{chip(r.get("bp","")) if isinstance(r.get("bp"),(int,float)) else e(r.get("bp",""))}</td>'
            f'<td>{chip(r.get("seo","")) if isinstance(r.get("seo"),(int,float)) else e(r.get("seo",""))}</td></tr>'
        )
    note = f'<p style="font-size:13.5px;color:var(--muted);margin-top:16px">{e(bl["note"])}</p>' if bl.get("note") else ""
    return f"""<section><h2>베이스라인 · 로컬 프로덕션 빌드</h2>
<div class="tablecard"><div class="scroll"><table>
<thead><tr><th>라우트</th><th>Perf</th><th>LCP</th><th>TBT</th><th>CLS</th><th>A11y</th><th>BP</th><th>SEO</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table></div></div>
<div class="legend">
<span><i class="dot" style="background:var(--good)"></i>양호 90–100</span>
<span><i class="dot" style="background:var(--warn)"></i>개선 50–89</span>
<span><i class="dot" style="background:var(--bad)"></i>불량 0–49</span>
<span>· 3회 실행 중앙값 · 모바일 스로틀</span></div>{note}</section>"""


def render_rounds(rounds):
    if not rounds:
        return ""
    blocks = []
    for rd in rounds:
        accepted = rd.get("status") == "accepted"
        bar = "var(--good)" if accepted else "var(--bad)"
        etag = "var(--good)" if accepted else "var(--bad)"
        etag_bg = "var(--good-bg)" if accepted else "var(--bad-bg)"
        tag = "채택 · 유지" if accepted else "거부 · 되돌림"
        deltas = ""
        for d in rd.get("deltas", []):
            worse = d.get("worse", False)
            fill = "var(--bad)" if worse else "var(--good)"
            cls = "is-bad" if worse else "is-good"
            deltas += (
                f'<div class="delta-row"><span class="lbl">{e(d.get("label",""))}</span>'
                f'<div class="bar-track"><span class="bar-fill" style="width:100%;background:color-mix(in srgb,{fill} 58%,transparent)"></span></div>'
                f'<span class="val"><span class="was">{e(d.get("from",""))}</span>'
                f'<span class="arw">→</span><span class="{cls}">{e(d.get("to",""))}</span></span></div>'
            )
        deltas = f'<div class="delta">{deltas}</div>' if deltas else ""
        cause = f'<p style="margin-top:20px"><strong>원인</strong>: {e(rd["cause"])}</p>' if rd.get("cause") else ""
        note = f'<div class="note" style="margin-top:6px">{e(rd["note"])}</div>' if rd.get("note") else ""
        summary = f'<p>{e(rd["summary"])}</p>' if rd.get("summary") else ""
        blocks.append(
            f'<div class="exp" style="--ebar:{bar};--etag:{etag};--etag-bg:{etag_bg}">'
            f'<div class="exp-head"><span class="rnd">ROUND {e(rd.get("n",""))}</span>'
            f'<span class="vt">{tag}</span></div>'
            f'<h3>{e(rd.get("hypothesis",""))}</h3>{summary}{deltas}{cause}{note}</div>'
        )
    return f'<section><h2>실험 저널 · autoresearch</h2>{"".join(blocks)}</section>'


def render_opps(opps):
    if not opps:
        return ""
    items = "".join(
        f'<div class="opp"><span class="rank">{e(o.get("rank",""))}</span>'
        f'<div class="body"><h4>{e(o.get("title",""))}</h4><p>{e(o.get("desc",""))}</p></div>'
        f'<span class="save {e(o.get("tier","low"))}">{e(o.get("saving",""))}</span></div>'
        for o in opps
    )
    return f'<section><h2>남은 최적화 기회 · 진단</h2><div class="opps">{items}</div></section>'


def render_recs(recs):
    if not recs:
        return ""
    items = "".join(
        f'<div class="rec"><h4><span class="tag tag-{e(r.get("tag","rec"))}">'
        f'{"기본" if r.get("tag")=="rec" else "선택" if r.get("tag")=="opt" else "보류"}</span>'
        f'{e(r.get("title",""))}</h4><p>{e(r.get("body",""))}</p></div>'
        for r in recs
    )
    return f'<section><h2>권장 사항</h2><div class="recs">{items}</div></section>'


def render_deliverables(files, flow):
    if not files:
        return ""
    flow = flow or DEFAULT_FLOW
    steps = '<span class="arr">→</span>'.join(f'<span class="step">{e(s)}</span>' for s in flow)
    cards = "".join(
        f'<div class="file"><code>{e(f.get("path",""))}</code><p>{e(f.get("desc",""))}</p></div>'
        for f in files
    )
    return f"""<section><h2>루프 구조 · 남긴 도구</h2>
<div class="flow">{steps}</div>
<div class="files" style="margin-top:22px">{cards}</div></section>"""


def build(data):
    meta = data.get("meta", {})
    v = data.get("verdict", {})
    optimized = meta.get("verdict") != "improved"
    vbar = "var(--good)" if optimized else "var(--accent)"
    score = meta.get("score", "")
    verdict = f"""<div class="verdict" style="--vbar:{vbar}">
<div class="gauge"><div class="num">{e(score)}</div><div class="den">/ 100</div>
<div class="cap">로컬 prod · perf 평균</div></div>
<div class="verdict-text"><h3>{e(v.get("headline",""))}</h3>
<p>{e(v.get("detail",""))}</p>
{f'<span class="pill">{e(v["pill"])}</span>' if v.get("pill") else ""}</div></div>"""

    lede = e(data.get("lede",
             "Karpathy autoresearch 방식으로 제안→적용→측정→유지/되돌리기→정체까지 반복 루프를 "
             "Lighthouse 성능 점수에 적용한 결과입니다."))
    body = "".join([
        f'<p class="eyebrow">Lighthouse · autoresearch loop</p>',
        f'<h1>{e(data.get("title","매듭 성능 최적화 루프 리포트"))}</h1>',
        f'<p class="lede">{lede}</p>',
        verdict,
        render_baseline(data.get("baseline")),
        render_rounds(data.get("rounds")),
        render_opps(data.get("opportunities")),
        render_recs(data.get("recommendations")),
        render_deliverables(data.get("deliverables"), data.get("flow")),
        f'<footer><span>매듭 · Lighthouse autoresearch loop</span>'
        f'<span>{e(meta.get("generated",""))} · 로컬 prod · 3회 중앙값</span></footer>',
    ])
    return (f'<title>{e(data.get("title","매듭 · Lighthouse 최적화 루프 리포트"))}</title>'
            f'<style>{CSS}</style><div class="wrap">{body}</div>')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    with open(a.input, encoding="utf-8") as f:
        data = json.load(f)
    out = build(data)
    with open(a.out, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"wrote {a.out} ({len(out)} bytes)", file=sys.stderr)


if __name__ == "__main__":
    main()
