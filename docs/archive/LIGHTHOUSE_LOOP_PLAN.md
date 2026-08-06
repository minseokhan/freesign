# Lighthouse 성능 최적화 루프 (autoresearch 스타일)

> ✅ **실행 완료(2026-07-31, 커밋 `361a820`)** — `scripts/lighthouse-loop/`와 `lighthouse`·`chrome-launcher`
> 의존성으로 구현됐고 루프를 돌려 성능 86.6 → 98.6을 얻었다. 이후 재사용은 `/lighthouse-loop` 스킬로 한다.
> 아래는 설계 원본이므로 §5 선행 준비 체크박스·§6 미해결 항목은 실행 시점에 이미 해소됐다.

> Karpathy `autoresearch`의 "가설 → 실험 → 지표 평가 → 개선 유지 → 정체까지 반복" 루프를
> Lighthouse 성능 점수에 적용한다. 지표가 더 오르지 않을 때까지 자동으로 최적화를 반복한다.

## 0. 확정된 결정

| 항목 | 결정 |
|------|------|
| 측정 대상 | 배포 Vercel(베이스라인·최종 검증) + **로컬 프로덕션 빌드(루프 내부)** |
| 대상 페이지 | 공개(`/`, `/login`) + 인증 대시보드(`/dashboard` 등) |
| 변경 적용 | 워킹트리에만 적용, **커밋 보류** (사용자가 최종 리뷰 후 커밋) |
| 오케스트레이션 | Claude Code 서브에이전트 (API 키 스크립트 아님) |

### 측정 위치가 3단계로 나뉘는 이유
워킹트리 변경은 커밋·배포 전엔 Vercel에 안 보인다. 따라서:
- **베이스라인/최종**: Vercel 실측 (실세계 숫자)
- **루프 내부 재측정**: 로컬 `next build && next start` (Vercel과 동일한 production 산출물 → 델타 대표성 O, 커밋 불필요)

## 1. 지표 정의 (Objective)

**Primary**: Lighthouse Performance 점수(0–100). Core Web Vitals 분해 추적:
- LCP, TBT, CLS, FCP, Speed Index, TTI

**Guardrail (회귀 금지)**: Accessibility · Best-Practices · SEO 점수가 베이스라인 아래로 내려가면 그 변경은 **거부**.
추가 게이트: `npm run test` 통과 + `npm run build` 성공.

**측정 안정화**: 노이즈 제거를 위해 라우트마다 Lighthouse **N=3회 실행 → 중앙값(median)** 사용. throttling 프리셋(모바일 기본 or desktop) 하나로 **고정**해 라운드 간 비교 가능성 확보.

## 2. 대상 라우트

| 라우트 | 인증 | 비고 |
|--------|------|------|
| `/` | 공개 | 랜딩(LCP 중요) |
| `/login` | 공개 | 진입점 |
| `/dashboard` | 인증 | 메인 대시보드(집계·차트) |
| `/contracts` | 인증 | 리스트 렌더 부하 |
| `/invoices` | 인증 | 리스트 + 금액 집계 |

인증 라우트는 로컬 `dev/test-login` 라우트로 세션 쿠키 주입 후 측정(메모리: browser-test-infra, 전용 테스트 유저).

## 3. 산출물

### (A) 측정 하버스트 — `scripts/lighthouse-loop/measure.mjs`
결정론적. 지능 없음.
1. (옵션) `npm run build`
2. `next start -p 3100` 기동 → readiness 대기
3. 인증 세션 쿠키 확보(test-login)
4. 라우트별 Lighthouse N회 → 중앙값 산출
5. `scripts/lighthouse-loop/reports/round-NN.json` 저장 + `journal.jsonl` append
6. 서버 종료

출력 스키마(라운드당):
```json
{
  "round": 3, "target": "local-prod",
  "routes": {
    "/":         {"perf": 82, "lcp": 2100, "tbt": 120, "cls": 0.02, "a11y": 95, "bp": 100, "seo": 100},
    "/dashboard":{"perf": 74, "lcp": 3200, "tbt": 380, "cls": 0.05, "a11y": 92, "bp": 100, "seo": 100}
  },
  "score": 78.0   // 라우트 perf 가중 평균(primary objective)
}
```

### (B) 루프 오케스트레이션 (Claude Code가 실행)
```
baseline = measure(Vercel 실측)          # 1회, 실세계 기준
local_base = measure(로컬 프로덕션 빌드)  # 루프 비교 기준
best = local_base
journal = [];  plateau = 0;  PATIENCE = 3;  EPSILON = 0.5

while plateau < PATIENCE:
    snapshot = git diff 저장(되돌리기용 역패치)
    idea = 서브에이전트: journal·최근리포트 보고 "다음 최적화 1건" 제안(가설)
    서브에이전트: idea를 워킹트리에 외과적 적용(1건만)
    npm run build → 실패 시 revert, plateau += 1, continue
    npm run test  → 실패 시 revert, plateau += 1, continue
    new = measure(로컬 프로덕션 빌드)
    if new.score > best.score + EPSILON AND guardrail 회귀 없음:
        accept;  best = new;  plateau = 0
    else:
        revert(snapshot);  plateau += 1
    journal.append({idea, delta, accepted, 이유})

리포트: journal 전체 + baseline→best 개선표 (HTML Artifact 대시보드)
```

**한 라운드 = 한 변경**: 델타 귀속을 명확히(autoresearch의 "한 번에 한 실험"). 실패한 실험은 journal에 남겨 재시도 방지.

**되돌리기**: 커밋 안 하므로 라운드 시작 시 `git diff`(또는 `git stash create`)로 워킹트리 스냅샷 → 거부 시 해당 파일만 복원.

### (C) 최종 리포트 — HTML Artifact
- 베이스라인(Vercel) vs 최적화 후(로컬 프로덕션) 라우트별 점수·CWV 표
- 채택된 최적화 목록 + 각 델타 (git log 스타일 저널)
- 다음 액션: "커밋 → 배포 → Vercel 재측정으로 실세계 확인"

## 4. 최적화 후보 카탈로그 (서브에이전트 참고)
Next.js 15 + Tailwind + Supabase 스택 기준 흔한 개선 축:
- `next/image` 최적화·`priority`·크기 명시, LCP 이미지 preload
- `next/font` self-host(현재 Pretendard TTF 확인), font-display swap
- 서버 컴포넌트 유지 / 불필요한 `"use client"` 제거로 JS 번들 축소
- 동적 import·code splitting(무거운 차트·PDF 뷰어)
- 대시보드 집계를 SQL로(이미 규칙), 워터폴 쿼리 병렬화
- `revalidate`/캐시 헤더, 정적화 가능 페이지 SSG
- 미사용 JS/CSS 제거, Tailwind purge 확인
- Third-party script defer

**규칙 준수**: 모든 변경은 프로젝트 아키텍처 규칙(RSC 읽기·Server Action 쓰기·RLS)을 깨지 않아야 함. 최적화가 보안 경계를 건드리면 거부.

## 5. 선행 준비 (실행 시)
- [ ] `lighthouse` + `chrome-launcher` devDependency 설치 (현재 미설치, Chrome 앱은 있음)
- [ ] `scripts/lighthouse-loop/` 디렉터리 + measure.mjs
- [ ] test-login 기반 인증 쿠키 확보 로직
- [ ] Vercel 베이스라인 1회 실측

## 6. 미해결/판단 필요
- throttling: 모바일 기본(느린 4G) vs desktop — **모바일 기본 권장**(Vercel Lighthouse 기본과 일치, 개선 여지 큼)
- 인증 대시보드 Vercel 실측: 프로덕션 Supabase 로그인 세션 필요 → 복잡. **베이스라인은 공개 페이지만 Vercel 실측**, 대시보드는 로컬 프로덕션으로 통일하는 절충 제안.
- PATIENCE·N·EPSILON 값은 첫 라운드 노이즈 관측 후 튜닝.
