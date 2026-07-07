# Step 2: client-form

## 읽어야 할 파일

- `/docs/UI_GUIDE.md` — **이 step의 1차 스펙**. 폼(라벨·인풋·헬프텍스트·에러·버튼)·채널 select·라디우스(인풋 sm 6px)·포커스 링(blue)·상태 색. 채널 태그 7종(인스타·링크드인·유튜브·직거래·크몽·추천·기타).
- `/docs/UX_PRINCIPLES.md` — 피드백(성공 토스트·인라인 에러)·점진적 노출·접근성(라벨 연결·색+텍스트 병기)
- `/CLAUDE.md` — react-hook-form + zod. **동일 스키마로 클라이언트 검증 = 서버 재검증**(step 1 스키마 재사용). 쓰기는 Server Action.
- 이전 phase/step 산출물(실제 경로):
  - `src/lib/validation/client.ts`(또는 step 1에서 실제로 만든 경로) — **step 1의 zod allowlist 스키마. 이 폼이 그대로 재사용**(단일 출처).
  - `src/app/(dashboard)/clients/actions.ts` — step 1의 `createClient`/`updateClient`/`deleteClient` Server Actions. 폼 submit이 이걸 호출.
  - `src/components/ui/{input,button,card}.tsx` — `Input`, `Button`, `Card` 프리미티브(재사용)
  - `src/app/(dashboard)/clients/page.tsx`, `.../[id]/page.tsx` — step 0 목록/상세(폼 진입/복귀 지점)
- **참고**: `package.json`에서 `react-hook-form`·`@hookform/resolvers`·`zod` 설치 여부 확인(없으면 이 step에서 설치).

**배경**: 이 step은 수직 슬라이스의 **UI 절반**이다. step 1 Server Action에 **폼을 배선**해 clients CRUD를 사용자 눈앞에서 완성한다. 여기서 정립하는 **폼(rhf+zod) → Server Action** 배선을 phase 5·6이 따른다. 폼 컴포넌트는 TDD 가드 예외(`components/`·page)지만, **검증 스키마는 step 1에서 이미 테스트됨**(재사용).

## 작업

### 1) 클라이언트 폼 컴포넌트 — `src/components/client-form.tsx`

- **client component**(`"use client"`) + `react-hook-form` + `zodResolver(step 1 스키마)`. **스키마를 새로 만들지 말고 step 1 것을 import**(클라이언트 검증 = 서버 재검증 동일 출처).
- 필드: `name`(텍스트, 필수), `channel`(**select**, 7개 값 + 한국어 라벨), `contact_email`·`contact_phone`(텍스트, optional), `memo`(textarea, optional). UI_GUIDE 폼 규격(라벨-인풋 연결·인라인 에러·포커스 링).
- **생성/수정 겸용**: `defaultValues`(수정 시 기존 값)로 두 모드 지원. submit 시 해당 Server Action(`createClient`/`updateClient`) 호출.
- **서버 액션 결과 처리**: 성공 → 목록/상세로 복귀 + 성공 피드백(토스트 또는 UX_PRINCIPLES 피드백), 서버 검증 실패 → 인라인 에러 반영. `useTransition`/pending 상태로 submit 중 버튼 비활성.

### 2) 생성 라우트 — `src/app/(dashboard)/clients/new/page.tsx`

- 폼 컴포넌트를 생성 모드로 렌더. step 0 목록의 "클라이언트 만들기" 진입점을 여기로 연결(step 0에서 비활성/자리만 뒀다면 활성화).

### 3) 수정/삭제 배선 — 상세(`.../[id]/page.tsx`)

- 상세 페이지의 수정 버튼 → 폼 수정 모드(별도 `edit` 라우트 또는 상세 내 폼, 재량). 삭제 버튼 → `deleteClient` 호출(soft-delete) + 확인 UX. **외과적 변경**: step 0 상세 마크업을 크게 갈아엎지 말고 액션 배선만 추가.

### 검증 일관성

- 폼은 편의(즉시 피드백)일 뿐 **신뢰 경계가 아니다.** 서버 액션(step 1)이 항상 재검증한다 — 폼 검증을 우회해도 서버가 막는다. 이 관계를 깨지 마라(클라이언트에서만 검증하고 서버를 느슨하게 하지 마라 — step 1이 이미 엄격).

## Acceptance Criteria

```bash
npm run lint
npm run build     # 폼·new 라우트·수정/삭제 배선이 컴파일
npm test          # 기존 테스트 green(스키마 테스트는 step 1에서 이미 존재)
```

빌드 후, 개발 서버에서 생성 폼이 렌더되고 채널 select·필수 필드 에러가 표시되는지 육안 확인(선택).

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 폼이 **step 1의 zod 스키마를 재사용**하는가(중복 스키마 금지 — 단일 출처)?
   - submit이 **Server Action**(step 1)을 호출하고, 성공/실패 피드백이 있는가?
   - 채널이 **select + 한국어 라벨**이고, 필수/형식 에러가 인라인 표시되는가?
   - 삭제가 **soft-delete 액션**을 호출하고 확인 UX가 있는가?
   - UI_GUIDE 폼·색·라디우스 규격을 따르고 안티슬롭(글래스·그라데이션·보라)을 어기지 않았는가?
   - step 0 상세 마크업을 불필요하게 리팩터하지 않았는가(외과적 변경)?
3. `phases/4-clients/index.json`의 step 2를 업데이트(성공 `completed`+`summary` / 3회 실패 `error`+`error_message` / 개입 필요 `blocked`+`blocked_reason`). 완료 시 **phase 4 전체 완료** — `phases/index.json`의 `4-clients`도 `completed`로.

## 금지사항

- 폼용 zod 스키마를 새로 만들지 마라. 이유: step 1 스키마가 단일 출처(클라이언트 검증 = 서버 재검증). 분기되면 검증 규칙이 어긋난다.
- 폼 제출을 `fetch("/api/...")`나 클라이언트 직접 DB 호출로 처리하지 마라. 이유: CRITICAL — 쓰기는 Server Actions 전용.
- 클라이언트 검증만 믿고 서버 액션을 느슨하게 만들지 마라. 이유: 폼은 신뢰 경계가 아니다. 서버(step 1)가 항상 재검증한다.
- step 0/1의 조회·액션 로직을 이 step에서 수정하지 마라(배선 외). 이유: 외과적 변경 — 확정된 산출물.
- 계약·인보이스 폼을 미리 만들지 마라. 이유: phase 5·6 소관.
- 기존 테스트를 깨뜨리지 마라.
