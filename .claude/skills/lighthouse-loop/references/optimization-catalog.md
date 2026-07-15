# 최적화 후보 카탈로그 & 함정

Next.js 15 (App Router, RSC) + Tailwind + Supabase 스택 기준. 제안 단계 서브에이전트의 참고 목록.
각 항목은 **진단 신호 → 조치 → 리스크/함정**. 함정 표시(⛔)는 실측으로 확인된 것이다.

## LCP / 렌더 경로

- **렌더 차단 리소스** (`render-blocking-insight`): 외부 CDN CSS/폰트 `<link rel=stylesheet>`가 렌더를 막음.
  - 조치: `next/font`로 self-host(비차단·preload·swap), 또는 CSS를 비차단 로드.
  - ⛔ **전체 폰트 self-host 금지.** 서브셋 안 된 Pretendard 가변 woff2(2.0MB)를 `next/font/local`로 넣으면 느린 4G에서 ~10s 다운로드 → **LCP 2s→12s, perf 98.4→75**. 반드시 `pyftsubset --unicodes`로 사용 글리프(Latin + 쓰이는 한글)만 ~150-400KB로 서브셋하거나, CDN dynamic-subset을 비차단으로만 바꾼다.
  - ⚠️ 이 이득은 **실제 네트워크에서만** 크게 드러난다. localhost 판정은 거의 못 본다 → "Vercel 배포 후 검증" 분류.
- **LCP 이미지**: `next/image` 사용, LCP 이미지에 `priority`, 정확한 `sizes`/`width`/`height`. 히어로 이미지 preload.
- **폰트 swap**: `display: "swap"`로 폰트 로딩이 텍스트 페인트를 막지 않게. 단 큰 텍스트가 swap 시 재페인트되어 LCP로 재집계될 수 있음(주의).

## JS / TBT / 번들

- **불필요한 `"use client"` 제거**: 서버 컴포넌트로 유지 가능한 것은 유지 → 클라이언트 번들 축소. 인터랙션 없는 컴포넌트가 client면 후보.
- **동적 import**: 무거운 클라이언트 전용 위젯(차트·PDF 뷰어·에디터)은 `next/dynamic`으로 분할, 필요 시 `ssr: false`.
- **Legacy JavaScript** (`legacy-javascript-insight`): 폴리필/레거시 변환. `browserslist`를 현대 타깃으로 좁혀 축소.
  - ⚠️ 구형 브라우저 지원 축소라는 **제품 결정** 동반. 절감폭이 작으면(수 KB) 우선순위 낮음.
- **미사용 JS/CSS** (`unused-javascript`, `unused-css-rules`): 코드 스플리팅·Tailwind purge(content 경로) 확인. 외부 CSS의 미사용은 위 폰트 항목과 겹치는 경우 많음.

## 데이터 페치 / 캐시

- **워터폴 쿼리 병렬화**: RSC에서 순차 `await` 여러 개를 `Promise.all`로. 단 소유권 검증 순서·트랜잭션 의미를 깨지 말 것.
- **집계는 SQL로**: JS에서 큰 배열 reduce 대신 SQL 집계(프로젝트 규칙과도 일치).
- **정적화/`revalidate`**: 사용자별 데이터 없는 페이지는 SSG 가능. 캐시 헤더/`revalidate` 설정.
  - ⛔ 인증·사용자 스코프 페이지를 함부로 정적화하면 RLS·데이터 유출 위험. 공개 페이지만.
- **효율적 캐시 수명** (`cache-insight`): 외부 CDN 리소스는 제어 불가 → self-host로 옮겨야 캐시 통제 가능.

## 기타

- **bfcache 차단** (`bf-cache`): `Cache-Control: no-store`, `unload`/`beforeunload` 리스너 등이 원인. 초기 로드 점수엔 영향 미미, 우선순위 낮음.
- **CLS**: 이미지·광고·폰트 swap로 인한 레이아웃 이동. 크기 예약(`width`/`height`, `aspect-ratio`).

## 판정 가드 (모든 제안 공통)

- a11y·bp·seo 점수가 베이스라인 아래로 내려가면 거부.
- `npm run test`·`npm run build` 통과 필수.
- 아키텍처 규칙(RSC 읽기·Server Action 쓰기·RLS·서버 소유 필드·서비스 롤 금지) 위반 시 거부.
- 번들/에셋이 크게 늘어나는 변경(예: 큰 폰트·이미지 추가)은 perf 점수가 올라도 **바이트 비용을 리포트에 명시**(measure.mjs는 바이트를 추적하지 않으므로 수동 확인).
