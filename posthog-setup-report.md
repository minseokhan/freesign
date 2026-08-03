# PostHog post-wizard report

The wizard has completed a deep integration of PostHog into the Maedeup project. The following changes were made:

- **`instrumentation-client.ts`** (root) — 클라이언트 사이드 PostHog SDK 초기화. `/ingest` 리버스 프록시 경유, 예외 자동 캡처(`capture_exceptions: true`) 활성화.
- **`next.config.ts`** — `/ingest/static/*`, `/ingest/array/*`, `/ingest/*` 세 가지 리버스 프록시 rewrites 추가 및 `skipTrailingSlashRedirect: true` 설정.
- **`src/lib/posthog-server.ts`** (신규) — 서버 사이드 PostHog 싱글톤 클라이언트 (`posthog-node`, `flushAt: 1`, `flushInterval: 0`).
- **`src/components/posthog-identify.tsx`** (신규) — 대시보드 레이아웃에서 로그인된 사용자를 클라이언트 사이드로 식별하는 컴포넌트.
- **`src/app/(dashboard)/layout.tsx`** — `<PostHogIdentify userId email name />` 마운트로 페이지 새로고침 시에도 사용자 식별 유지.
- **`src/components/user-menu.tsx`** — 로그아웃 폼의 `onSubmit`에 `posthog.reset()` 추가.
- **`src/app/(auth)/actions.ts`** — `signOut` 서버 액션에 `user_signed_out` 이벤트 서버 사이드 캡처 추가.
- **`src/app/auth/callback/route.ts`** — OAuth 콜백 성공 시 `posthog.identify` + `user_signed_in` 이벤트 서버 사이드 캡처 추가.
- **`src/app/(dashboard)/contracts/actions.ts`** — `contract_draft_created`, `contract_imported`, `contract_status_changed`, `contract_deleted` 이벤트 추가.
- **`src/app/(dashboard)/invoices/actions.ts`** — `invoice_created`, `invoice_payment_marked`, `invoice_deleted` 이벤트 추가.
- **`src/app/(dashboard)/clients/actions.ts`** — `client_created` 이벤트 추가.
- **`src/app/api/contracts/[id]/sign/route.ts`** — `contract_signed` 이벤트 추가.

## Events

| 이벤트 이름 | 설명 | 파일 |
|---|---|---|
| `user_signed_in` | Google OAuth 로그인 완료 후 서버 사이드 캡처 | `src/app/auth/callback/route.ts` |
| `user_signed_out` | 로그아웃 실행 시 서버 사이드 캡처 | `src/app/(auth)/actions.ts` |
| `contract_draft_created` | AI로 계약서 초안 생성 또는 업데이트 (is_update 프로퍼티 포함) | `src/app/(dashboard)/contracts/actions.ts` |
| `contract_imported` | 기존 서명 계약서 PDF 불러오기 | `src/app/(dashboard)/contracts/actions.ts` |
| `contract_status_changed` | 계약 상태 전이 (from_status, to_status 프로퍼티 포함) | `src/app/(dashboard)/contracts/actions.ts` |
| `contract_deleted` | 계약 물리 삭제 | `src/app/(dashboard)/contracts/actions.ts` |
| `contract_signed` | 전자서명 완료 | `src/app/api/contracts/[id]/sign/route.ts` |
| `invoice_created` | 인보이스 발행 (invoice_id, contract_id 포함) | `src/app/(dashboard)/invoices/actions.ts` |
| `invoice_payment_marked` | 결제 상태 변경 (to_status: paid/unpaid) | `src/app/(dashboard)/invoices/actions.ts` |
| `invoice_deleted` | 인보이스 소프트 삭제 | `src/app/(dashboard)/invoices/actions.ts` |
| `client_created` | 새 클라이언트 등록 | `src/app/(dashboard)/clients/actions.ts` |

### 추가 계측 (post-wizard, 2026-07-16)

| 이벤트 이름 | 설명 | 파일 |
|---|---|---|
| `contract_draft_previewed` | AI 초안 미리보기 (source: ai/skeleton — AI 가용률 관측) | `src/app/api/contracts/draft/route.ts` |
| `contract_pdf_parsed` | 계약서 PDF AI 파싱 (source: ai/fallback) | `src/app/api/contracts/import/parse/route.ts` |
| `contract_pdf_downloaded` | 계약서 PDF 다운로드 (증빙 활용) | `src/app/api/contracts/[id]/pdf/route.ts` |
| `invoice_pdf_downloaded` | 인보이스 PDF 다운로드 | `src/app/api/invoices/[id]/pdf/route.ts` |
| `contract_source_pdf_downloaded` | 불러온 원본 계약서 PDF 열람 | `src/app/api/contracts/[id]/source-pdf/route.ts` |
| `report_exported` | 세금 장부 CSV 내보내기 (year, row_count) | `src/app/api/reports/route.ts` |
| `demo_seeded` / `demo_cleared` | 데모 데이터 시드/정리 (온보딩 활성화) | `src/app/(dashboard)/demo/actions.ts` |

`contract_draft_created`에는 `draft_source`(ai/skeleton) 프로퍼티가 추가되었다.

## Error tracking (post-wizard, 2026-07-16)

- **`instrumentation.ts`** (루트) — `onRequestError`로 서버에서 처리되지 않은 모든 예외(RSC·라우트 핸들러·Server Action)를 캡처. PostHog 쿠키에서 distinct_id를 파싱해 사용자와 연결.
- **`src/lib/posthog-server.ts`** — `captureServerException` 헬퍼(토큰 없으면 no-op, 비Error 래핑, 캡처 실패 무해화)와 `parsePostHogDistinctId` 추가.
- **`src/lib/action-error.ts`** — `dbError()`가 모든 Server Action의 DB/RPC 오류를 PostHog로 캡처 (`source: server_action`).
- **`src/app/global-error.tsx`** — 루트 에러 바운더리가 잡은 렌더링 예외를 `posthog.captureException`으로 명시 캡처.
- **API 라우트 500 분기** — sign·contract pdf·invoice pdf·source-pdf·reports·draft·parse 라우트의 처리된 오류를 `route` 프로퍼티와 함께 캡처.
- **AI 폴백** — `generateContractDraft`·`extractContractFromPdf`가 skeleton/fallback으로 떨어질 때 마지막 에러를 캡처 (`feature: ai_contract_draft` / `ai_contract_import`). API 키 누락·장애를 조기 발견.

## Next steps

PostHog 대시보드와 인사이트가 생성되어 있습니다. 아래 링크에서 확인하세요:

- **대시보드**: [Analytics basics (wizard)](https://us.posthog.com/project/514785/dashboard/1857081)
- **인사이트 1**: [신규 로그인 추세 (wizard)](https://us.posthog.com/project/514785/insights/82RwzT2S)
- **인사이트 2**: [계약→서명→인보이스 전환 퍼널 (wizard)](https://us.posthog.com/project/514785/insights/zgAxIfMs)
- **인사이트 3**: [인보이스 결제 완료 추세 (wizard)](https://us.posthog.com/project/514785/insights/2VpgmEoD)
- **인사이트 4**: [계약 생성 및 서명 추세 (wizard)](https://us.posthog.com/project/514785/insights/P75SueDG)
- **인사이트 5**: [핵심 비즈니스 이벤트 요약 (wizard)](https://us.posthog.com/project/514785/insights/uMBhGgwz)

## Verify before merging

- [ ] 프로덕션 빌드(`npm run build`)를 실행하여 wizard가 수정한 파일 외의 lint·타입 오류가 없는지 확인하세요.
- [ ] 테스트 스위트(`npm run test`)를 실행하세요 — 계측이 추가된 서버 액션과 API 라우트의 기존 테스트 모크가 `getPostHogClient`를 처리하는지 확인이 필요할 수 있습니다.
- [ ] `.env.example`(또는 팀 온보딩 문서)에 `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`과 `NEXT_PUBLIC_POSTHOG_HOST` 두 환경 변수를 추가해 협업자가 설정할 수 있도록 하세요. Vercel 프로젝트 환경 변수에도 동일하게 등록하세요.
- [ ] CI에 소스맵 업로드(`posthog-cli sourcemap` 또는 번들러 플러그인)를 연결하여 프로덕션 스택 트레이스가 난독화 해제되도록 하세요.
- [ ] 이미 로그인된 상태에서 페이지를 새로고침할 때 `PostHogIdentify`가 올바르게 `identify`를 호출하는지 확인하세요 — returning visitor 경로에서 익명 distinct ID로 남는 세션이 없어야 합니다.

### Agent skill

`.claude/skills/integration-nextjs-app-router/` 디렉터리에 에이전트 스킬이 설치되어 있습니다. Claude Code에서 추가 PostHog 개발 시 이 컨텍스트를 활용하면 최신 통합 패턴을 적용할 수 있습니다.
