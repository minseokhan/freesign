---
name: lighthouse-loop
description: Lighthouse 성능 점수를 autoresearch 방식(제안→적용→측정→유지/되돌리기→정체까지 반복)으로 최적화한다. 로컬 프로덕션 빌드에서 라우트별 Lighthouse를 N회 중앙값으로 측정해 판정하고, 서브에이전트가 코드 분석으로 최적화를 제안·적용하며, test+build 게이트와 a11y/bp/seo 회귀 가드를 통과해야 유지한다. 개선 없는 라운드가 PATIENCE회 연속되면 정체로 판정하고 HTML 대시보드(Artifact)로 보고한다. 변경은 워킹트리에만, 커밋은 사용자 승인 후. "성능 최적화", "lighthouse 최적화", "성능 루프", "웹 성능 개선", "라이트하우스", "perf optimize", /lighthouse-loop 트리거 시, 또는 사용자가 웹사이트 성능을 Lighthouse 점수 기준으로 반복 최적화해달라고 할 때 사용.
---

# /lighthouse-loop — Lighthouse 성능 최적화 루프 (autoresearch)

Karpathy autoresearch 방식을 Lighthouse 성능 점수에 적용한다: **가설(최적화 제안) → 실험(적용) → 지표 평가(재측정) → 개선되면 유지·아니면 되돌리기 → 정체(개선 없는 라운드가 PATIENCE회 연속)까지 반복** → HTML 대시보드로 보고.

루프는 두 종류의 단계로 이뤄진다:
- **결정론적**(측정·점수 비교·판정): 프로젝트 스크립트 `scripts/lighthouse-loop/measure.mjs`·`diagnose.mjs`.
- **창의적**(다음 최적화 제안·코드 수정): 서브에이전트 + 오케스트레이터 판단. 이게 이 스킬이 인코딩하는 절차다.

## 핵심 계약 (사용자 합의)

1. **판정은 반드시 로컬 프로덕션 빌드(`next start`)로.** `next dev`는 온디맨드 컴파일+미니파이 미적용으로 LCP가 6~9배 부풀려져(실측 LCP 13s) **측정이 무의미**하다. dev로 판정하지 말 것.
2. **한 라운드 = 한 변경(또는 독립적 소규모 묶음).** 델타 귀속을 명확히 한다. 실패한 실험은 저널에 남겨 재시도를 막는다.
3. **유지/되돌리기는 측정이 결정한다.** `score > best + EPSILON` **그리고** guardrail(a11y·bp·seo) 회귀 없음 **그리고** test+build 통과일 때만 유지. 아니면 즉시 되돌린다.
4. **커밋은 사용자 승인 후.** 변경은 워킹트리에만. 되돌리기는 `git checkout <소스파일>` + 추가 에셋 `rm`.
5. **아키텍처 규칙 불가침.** 최적화가 RSC 읽기·Server Action 쓰기·RLS·서버 소유 필드 등 프로젝트 규칙(CLAUDE.md)을 깨면 그 제안은 거부한다.

## 함정 (반드시 지킬 것 — 실측으로 확인됨)

- **전체 폰트 self-host 금지.** 서브셋 안 된 Pretendard 가변 폰트(2.0MB)를 self-host하면 느린 4G 스로틀에서 다운로드에 ~10s가 걸려 **LCP를 12s로 폭락**시킨다(perf 98.4→75). 폰트를 self-host하려면 반드시 `pyftsubset`로 사용 글리프만 서브셋(~150-400KB)하거나, CDN dynamic-subset을 비차단 로드로 두는 쪽을 택한다.
- **localhost 판정의 맹점.** 외부 CDN 렌더 차단 같은 **네트워크 전달 경로 이득은 localhost(네트워크 0)에선 안 보인다.** 그런 변경은 localhost 판정이 구조적으로 거부한다(이득은 안 잡히고 비용만 잡힘). 이런 최적화는 무한 반복하지 말고, "Vercel 배포 후 검증 필요"로 분류해 사용자에게 보고한다.
- **빌드 전 잔여 프로세스 정리.** 이전 라운드의 `next dev/start`가 고아로 남으면 `.next`를 오염시켜 빌드가 `pages-manifest.json ENOENT`로 실패한다. `measure.mjs`는 프로세스 그룹째 종료하지만, 빌드 전 `lsof -ti:3100 | xargs kill -9` 및 `ps aux | grep 'next '`로 확인한다.
- **이미 고득점이면 솔직히 알린다.** 베이스라인 perf 평균이 ~97+이면 헤드룸이 거의 없다. 억지 최적화로 복잡도·리스크를 더하지 말고, 남은 여지가 네트워크 바운드임을 설명한 뒤 사용자에게 계속할지 확인한다.

## 파라미터 (기본값)

`PATIENCE=2` · `EPSILON=0.5`(perf 평균 점) · `runs=3`(라우트별 중앙값). 라우트·URL·포트는 `scripts/lighthouse-loop/measure.mjs` 상단 상수 참조(현재 5개 라우트, Vercel `https://freesign.vercel.app`, 포트 3100).

## 실행 절차

### 0. 프리플라이트
- 잔여 next 프로세스 정리: `ps aux | grep -E 'next (dev|start)' | grep -v grep` 확인 후 있으면 종료, `lsof -ti:3100 | xargs kill -9`.
- 의존성 확인: `lighthouse`·`chrome-launcher` devDep(없으면 `npm i -D lighthouse chrome-launcher`), Chrome 앱 존재.

### 1. 베이스라인 측정 (판정 기준선)
- **로컬 prod**: `npm run build` → `node scripts/lighthouse-loop/measure.mjs --target=local --round=baseline --runs=3`. 이 점수가 유지/되돌리기의 앵커(`best`)다.
- **Vercel 실측(참고)**: `node scripts/lighthouse-loop/measure.mjs --target=vercel --round=vercel-baseline --runs=3` — 공개 페이지만. localhost와의 격차가 실제(네트워크) 헤드룸이다.
- 베이스라인 perf 평균이 ~97+이면 위 "이미 고득점" 함정대로 사용자에게 먼저 알리고 계속 여부를 확인한다.

### 2. 진단으로 표적 확보
`node scripts/lighthouse-loop/diagnose.mjs https://freesign.vercel.app/`(및 헤드룸 큰 라우트)로 **실행 가능한 최적화 기회**(렌더 차단·미사용 CSS/JS·이미지·캐시·bfcache 등)를 뽑는다. 이 목록을 제안 단계 서브에이전트에 먹인다. 후보 유형은 `references/optimization-catalog.md` 참조.

### 3. 루프 (정체까지 반복)
`best = baseline`, `journal = []`, `plateau = 0`. `plateau < PATIENCE` 동안 반복:

1. **스냅샷.** 변경 대상이 될 소스의 현재 상태를 안다(`git diff` 확인). 되돌리기 대비.
2. **제안(서브에이전트).** 진단 목록 + 코드 + 지금까지의 `journal`을 주고 **다음 최적화 1건(또는 독립적 소규모 묶음)**을 제안받는다: 근거·기대 지표·수정 파일·리스크. **저널에 이미 있는(거부된) 가설은 다시 제안하지 않는다.** 카탈로그의 함정을 위반하는 제안(예: 전체 폰트 self-host)은 오케스트레이터가 반려한다.
3. **적용.** 워킹트리에 외과적으로 적용(직접 또는 서브에이전트). 새 파일이 TDD 가드에 막히면 기존 파일에 인라인하거나 테스트를 함께 작성한다.
4. **게이트.** `npm run test` + `npm run build`. 실패 → 되돌리기, `plateau++`, `journal`에 `rejected(gate)` 기록, 다음 라운드.
5. **측정.** `node scripts/lighthouse-loop/measure.mjs --target=local --round=N --runs=3`(4단계 빌드 산출물을 `next start`로 잰다).
6. **판정.** `new.score > best.score + EPSILON` 그리고 a11y·bp·seo 회귀 없음이면 → **유지**(`best = new`, `plateau = 0`). 아니면 → **되돌리기**(`git checkout <소스>` + 추가 에셋 `rm`), `plateau++`.
7. **저널 기록.** `{round, hypothesis, files, score_from, score_to, lcp, accepted, cause}`.

`plateau >= PATIENCE`면 정체로 보고 루프 종료.

### 4. 리포트 생성·게시
스크래치에 `lighthouse-report.json`을 쓴다(스키마는 `scripts/build_report.py` 상단 docstring 참조): `meta`(verdict·score)·`verdict`·`baseline.routes[]`·`rounds[]`(실험 저널)·`opportunities[]`(남은 진단)·`recommendations[]`·`deliverables[]`. `journal.jsonl`과 `reports/*.json`의 실측치를 그대로 옮긴다.

```bash
python3 scripts/build_report.py <스크래치>/lighthouse-report.json --out <스크래치>/lighthouse-report.html
```

self-contained HTML(라이트/다크, 점수 임계값 색상, tabular-nums)이 나온다. 게시:
- 게시 전 `artifact-design` 스킬 로드(디자인 기준은 스크립트에 반영돼 빠르게 통과).
- `Artifact({ file_path: "<스크래치>/lighthouse-report.html", description: "FreeSign Lighthouse 최적화 루프 리포트", favicon: "📊", title: "FreeSign · Lighthouse 최적화 루프 리포트" })`.

### 5. 마무리
사용자에게 **Artifact URL + 판정(정체/개선) + 베이스라인→best 요약 + 채택/거부 라운드 수 + 워킹트리 상태(무엇이 바뀌었나·소스 변경 여부)**를 보고한다. 채택된 변경이 있으면 커밋 여부를 묻는다(이 레포는 main 직접 커밋 선호, 단 커밋은 승인 후). 채택이 0이면 소스가 베이스라인으로 복원됐음을 명시한다.

> 측정은 노이즈가 있다(특히 Vercel 실측·CLS). 그래서 N회 중앙값을 쓰고, EPSILON 미만의 미세 변동은 개선으로 치지 않는다. 저널(`scripts/lighthouse-loop/journal.jsonl`)이 라운드별 실측을 누적하므로, 재실행 시 이전 맥락을 이어받는다.
