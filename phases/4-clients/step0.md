# Step 0: client-read

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — **이 step의 1차 스펙**. "데이터 흐름"의 **읽기**(`보호 라우트(RSC) → getUser() 인가 → Supabase 직접 조회`), 라우트 표(`/clients` 목록 = 채널 태그 배지·필터, `/clients/[id]` 상세), clients 모델(`channel` CHECK: `linkedin|instagram|youtube|direct|kmong|referral|other`, `contact_email`·`contact_phone`·`memo`)
- `/docs/UI_GUIDE.md` — 테이블(목록)·상태/채널 배지·빈 상태·타이포. **채널 태그(인스타·링크드인·유튜브·직거래·크몽·추천·기타)는 색 배지 + 텍스트 라벨**(브랜드 로고 남용 금지). 시맨틱 색은 상태 배지에만, 일반 강조는 블루 포인트만.
- `/docs/UX_PRINCIPLES.md` — 계층·3초 판독·빈 상태 원칙
- `/CLAUDE.md` — CRITICAL: **읽기는 RSC에서 Supabase 직접 조회**(RLS 스코프). 읽기를 내부 `/api` fetch로 우회하지 말 것. `deleted_at IS NULL` 필터는 RLS가 아니라 공용 쿼리 헬퍼에서.
- 이전 phase 산출물(실제 경로):
  - `src/app/(dashboard)/clients/page.tsx` — 현재 **플레이스홀더 빈 상태 카드**("이후 단계에서 연결됩니다"). 이 step에서 실제 목록으로 교체한다.
  - `src/lib/db/index.ts` — `notDeleted(query)` 쿼리 헬퍼(`deleted_at IS NULL` 적용). 목록/상세 조회에 반드시 사용.
  - `src/lib/supabase/server.ts` — `createClient()`(RLS 스코프 서버 클라이언트, RSC에서 직접 조회)
  - `src/lib/auth.ts` — `requireUser()`(가드 헬퍼). (dashboard) 레이아웃이 이미 그룹 전체를 가드하므로 **page에 중복 가드 금지**. 페이지에서 `user_id`가 필요하면 재사용은 가능하나 조회 스코프는 RLS가 처리한다.
  - `src/types/database.ts` — `Database["public"]["Tables"]["clients"]["Row"]`(조회 결과 타입)
  - `src/components/ui/{card,badge,button}.tsx` — `Card`, `Badge`(variant: success/warning/danger/neutral), `Button` 프리미티브
  - `src/app/(dashboard)/loading.tsx`, `src/app/(dashboard)/error.tsx` — 그룹 공용 로딩/에러 경계(이미 존재, 재사용)

**배경**: 이 step은 **제품 첫 CRUD 수직 슬라이스의 "읽기" 절반**이다. 여기서 정립하는 **RSC 직접 조회 패턴**을 phase 5(계약)·6(인보이스) 목록/상세가 그대로 따른다. 쓰기(Server Action)는 step 1, 폼 UI는 step 2 소관 — 이 step은 **읽기 전용**이다.

## 작업

### 1) 목록 — `src/app/(dashboard)/clients/page.tsx` 교체

- **RSC(async Server Component)에서 `createClient()`로 Supabase를 직접 조회**한다. `.from("clients").select(...)`에 **`notDeleted(...)`를 적용**해 soft-delete 행을 제외한다. 정렬은 `created_at desc`(또는 `name`) 재량.
- **내부 `/api` fetch로 읽지 마라.** RLS가 `user_id` 스코프를 처리하므로 쿼리에 `user_id` 조건을 수동으로 넣을 필요는 없다(넣어도 무해하나 RLS가 경계).
- 목록 UI: UI_GUIDE **테이블(목록)** 규격 — 행 hover, 이름·채널 배지·연락처 열. 채널은 **색 배지 + 한국어 텍스트 라벨**(예: 인스타그램·링크드인·유튜브·직거래·크몽·추천·기타).
- **채널 필터**: 채널별 필터 UI(예: `searchParams`의 `channel`로 서버에서 필터, 또는 배지 토글). 서버 필터를 권장(RSC에서 쿼리 조건 추가). 구현 형태는 재량이나 **읽기는 서버에서** 끝낸다.
- **빈 상태**: 클라이언트가 0건이면 기존 플레이스홀더와 동일한 톤의 빈 상태(제목·설명 + "클라이언트 만들기" 유도). 단, 실제 등록 동작(폼)은 step 2에서 연결되므로 여기서는 링크/자리만(비활성 또는 `/clients/new`로의 링크 자리, 실제 폼은 아직 없음).

### 2) 상세 — `src/app/(dashboard)/clients/[id]/page.tsx` 신규

- **RSC 직접 조회**. `params.id`로 단건 조회(`notDeleted` 적용, `maybeSingle()`). 없거나 soft-delete면 `notFound()`(`next/navigation`).
- 상세 표시: 이름·채널 배지·연락처(email/phone)·메모. UI_GUIDE 상세/카드 규격.
- 여기서도 **읽기는 서버에서**. 수정/삭제 버튼 UI 자리는 둬도 되나 실제 동작 배선은 step 1/2 소관(비활성 또는 자리만).

### 3) 채널 배지 라벨 매핑

- 채널 코드(`linkedin` 등) → 한국어 라벨 + 배지 색을 **한 곳에서** 매핑(목록·상세 공유). 순수 매핑이면 `src/lib/`의 작은 모듈로 빼도 되고(그 경우 **테스트 먼저**), 표시 전용 상수면 `src/components/`의 배지 컴포넌트로 co-locate해도 된다. **`lib/`에 로직을 두면 대응 테스트가 없으면 편집이 차단**되니, 순수 매핑을 `lib/`에 둘 경우 매핑 테스트를 먼저 작성하라. 단순 표시 상수는 컴포넌트 쪽에 두어 TDD 가드 예외로 처리하는 편이 간단하다.

## Acceptance Criteria

```bash
npm run lint
npm run build     # /clients 목록·[id] 상세 RSC가 컴파일
npm test          # 기존 테스트 green + (lib에 순수 매핑을 추가했다면 그 테스트)
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 목록·상세가 **RSC에서 Supabase를 직접 조회**하는가(내부 `/api` fetch 우회 없음)?
   - 조회에 **`notDeleted` 헬퍼**를 적용해 soft-delete 행을 제외하는가(수동 `deleted_at` 조건 남발 금지)?
   - 채널이 **색 배지 + 텍스트 라벨**로 표시되는가(로고 남용·색만으로 구분 금지)?
   - 상세에서 없는 id는 `notFound()`로 처리하는가?
   - (dashboard) 레이아웃 가드가 그룹을 덮으므로 **page에 `requireUser()` 중복 가드를 넣지 않았는가**?
   - 빈 상태가 존재하는가(0건)?
3. `phases/4-clients/index.json`의 step 0을 업데이트(성공 `completed`+`summary` / 3회 실패 `error`+`error_message` / 개입 필요 `blocked`+`blocked_reason`).

## 금지사항

- 읽기를 내부 `/api` route로 우회하지 마라. 이유: CRITICAL — 읽기는 RSC 직접 조회가 아키텍처 규칙. `/api`는 시크릿/외부 API 전용.
- **Server Action·mutation을 만들지 마라.** 이유: 쓰기(생성·수정·삭제)는 step 1(client-actions) 소관. 이 step은 읽기 전용 — 스코프 크립 금지.
- **폼 UI(react-hook-form)를 만들지 마라.** 이유: step 2(client-form) 소관.
- `deleted_at` 필터를 RLS나 여기저기 흩어진 수동 조건으로 넣지 마라. 이유: 공용 `notDeleted` 헬퍼가 단일 출처(복원·감사·CSV 보존 규칙과 정합).
- page에 `requireUser()` 가드를 중복 삽입하지 마라. 이유: (dashboard) 레이아웃 가드가 그룹 전체를 덮는다(phase 3 확정).
- 계약·인보이스 목록/상세를 미리 만들지 마라. 이유: phase 5·6 소관.
- 기존 테스트를 깨뜨리지 마라.
