# Supabase 어드바이저 린트 수정 레시피

`get_advisors`가 반환하는 린트 슬러그(`name`)별 **위험도 버킷 + 수정 방법 + 주의사항**. 스킬 3단계(분류)와 6단계(적용)의 근거.

버킷 정의:
- 🟢 **auto** — 확실히 안전·가역. SQL 완성해 제안, 승인 시 적용.
- 🟡 **review** — 되돌리기 어렵거나 판단 필요. SQL은 만들되 강한 경고, 자동 적용 금지.
- ⚪ **manual** — SQL로 못 고침(대시보드/Auth 설정 등). 안내만.

레시피에 **없는** 린트를 만나면: `remediation` URL을 근거로 삼되 안전성이 불확실하면 🟡 review로 보수 분류하고 "레시피 미등록" 표시.

---

## 목차
- [보안(SECURITY)](#보안security)
  - function_search_path_mutable 🟢
  - rls_disabled_in_public / policy_exists_rls_disabled 🟡
  - rls_enabled_no_policy 🟡
  - security_definer_view 🟡
  - extension_in_public 🟡
  - auth_leaked_password_protection / auth_otp_long_expiry / auth_* ⚪
- [성능(PERFORMANCE)](#성능performance)
  - unindexed_foreign_keys 🟢
  - unused_index 🟡
  - duplicate_index 🟡
  - multiple_permissive_policies 🟡
  - auth_rls_initplan 🟢
  - no_primary_key 🟡

---

## 보안(SECURITY)

### `function_search_path_mutable` 🟢 auto (단, 본문 확인 필수)
**뜻:** 함수의 `search_path`가 고정돼 있지 않다. 공격자가 세션 `search_path`를 조작해 동명의 악성 객체를 우선 해석시키는 하이재킹 위험(특히 `SECURITY DEFINER` 함수에서 위험).

**함정:** `SET search_path = ''`(빈 값)로 고정하면 함수 본문의 **모든 비한정 참조가 깨진다**(`select * from foo` → `foo`를 어느 스키마에서도 못 찾음). 그래서 반드시 본문을 먼저 읽는다.

**절차:**
1. 본문 확인(읽기 전용):
   ```sql
   select pg_get_functiondef('public.set_updated_at()'::regprocedure);
   ```
   (인자 있는 함수는 시그니처를 정확히: `'public.consume_rate_limit(text,int,int)'::regprocedure`. 시그니처를 모르면
   `select oid::regprocedure from pg_proc where proname = 'consume_rate_limit' and pronamespace = 'public'::regnamespace;`)
2. 본문의 테이블/함수 참조가 **이미 `public.` 등으로 한정**돼 있으면 → 안전하게 고정:
   ```sql
   alter function public.set_updated_at() set search_path = '';
   ```
3. 본문에 **비한정 참조가 있으면** → 두 선택지:
   - (권장) 함수를 `CREATE OR REPLACE`로 재정의하며 참조를 `public.`으로 한정 + `SET search_path = ''`. 원본 정의를 1번에서 얻었으니 그걸 기반으로 고친다.
   - (차선) 참조가 쓰는 스키마로 고정: `alter function ... set search_path = public, pg_temp;` — 린터는 만족시키되 빈 값보다 덜 엄격. 트리거/도메인 함수엔 실용적.
4. 트리거 함수(`set_updated_at` 등)도 동일. `SECURITY DEFINER` 함수는 특히 `''` 또는 명시 고정이 중요.

**fix_note 예:** "본문 public. 한정 확인 → 빈 search_path 안전" / "본문 비한정 참조 존재 → CREATE OR REPLACE로 한정 후 고정".

---

### `rls_disabled_in_public` / `policy_exists_rls_disabled` 🟡 review
**뜻:** public 스키마 테이블에 RLS가 꺼져 있다(후자는 정책은 있는데 RLS가 disabled — 정책이 무력화됨). 사용자 데이터 테이블이면 **심각(노출 위험)**.

**수정 SQL:**
```sql
alter table public.<tbl> enable row level security;
```
**왜 review인가:** RLS를 켜는 순간 **정책이 없으면 전부 차단**돼 앱이 즉시 깨질 수 있다. 켜기 전에 반드시 확인:
- 이 테이블에 이미 적절한 정책이 있는가? (`select * from pg_policies where tablename = '<tbl>';`)
- 정책이 없다면 RLS만 켜지 말고 **정책도 함께** 만들어야 한다. 이 레포 규칙: `USING`+`WITH CHECK (user_id = (select auth.uid()))` 둘 다.
- 공용/참조 테이블이라 의도적으로 RLS를 뺀 것인지 확인. 사용자에게 테이블 성격을 물어라.

---

### `rls_enabled_no_policy` 🟡 review
**뜻:** RLS는 켜졌는데 정책이 하나도 없다 → 소유자 외 전부 차단(읽기도 안 됨). 보안상 안전하나 기능이 죽어 있을 수 있음.
**수정:** 의도된 정책을 추가. 이 레포는 `user_id = (select auth.uid())` 스코프. 어떤 접근을 허용할지는 도메인 판단이라 자동 생성 금지 — 정책안을 제시하고 승인받는다.

---

### `security_definer_view` 🟡 review
**뜻:** 뷰가 `SECURITY DEFINER`로 정의돼 뷰 생성자의 권한으로 실행 → RLS 우회 가능.
**수정:** 대개 `security_invoker`로 바꾼다:
```sql
alter view public.<view> set (security_invoker = true);
```
**왜 review인가:** 의도적으로 권한 상승이 필요한 뷰였을 수 있다. invoker로 바꾸면 RLS가 적용돼 결과가 달라지거나 비면 앱이 깨진다. 뷰의 목적을 확인 후.

---

### `extension_in_public` 🟡 review
**뜻:** 확장이 public 스키마에 설치돼 이름 충돌·search_path 하이재킹 표면을 넓힌다.
**수정:** 전용 스키마로 이동(`alter extension <ext> set schema extensions;`). **왜 review:** 이동하면 해당 확장 함수를 참조하던 코드가 깨질 수 있다. 확장 종류·의존성 확인 필요. 되돌리기 번거로움.

---

### `auth_leaked_password_protection`, `auth_otp_long_expiry`, `auth_*` ⚪ manual
**뜻:** Auth 설정 항목(유출 비번 차단, OTP 만료 등). **SQL로 못 고친다** — Supabase 대시보드 Auth 설정 또는 Management API 영역.
**처리:** 수정하지 말고 안내만. **대상 앱 맥락을 반영**하라 — 예: freesign은 Google OAuth 전용이라 `auth_leaked_password_protection`(비밀번호 로그인용)은 **실질적으로 무관**하다. 이런 경우 "무관 — 조치 불필요"로 명시해 소음을 줄인다. 비번 로그인을 쓰는 앱이면 대시보드에서 켜라고 안내.

---

## 성능(PERFORMANCE)

### `unindexed_foreign_keys` 🟢 auto
**뜻:** FK 컬럼에 커버링 인덱스가 없어 조인·부모행 삭제·CASCADE 검사 시 순차 스캔.
**수정 SQL:**
```sql
create index if not exists idx_<tbl>_<col> on public.<tbl> (<col>);
```
`metadata.fkey_columns`는 컬럼 **번호**이므로 실제 컬럼명이 필요하면 확인:
```sql
select a.attname from pg_attribute a
 where a.attrelid = 'public.<tbl>'::regclass and a.attnum = any(array[<nums>]) order by a.attnum;
```
**주의(경미):** 인덱스는 쓰기 비용·저장공간을 조금 늘린다. INFO 레벨이고 안전·가역(`drop index`로 취소)이라 auto로 둔다. 이름은 관례에 맞춰 `idx_<tbl>_<col>`. 이미 다른 이름의 동등 인덱스가 없는지 확인하면 더 좋다.

---

### `unused_index` 🟡 review — **자동 삭제 절대 금지**
**뜻:** 통계상 한 번도 안 쓰인 인덱스 → 삭제 후보.
**수정 SQL(제안만):**
```sql
drop index if exists public.<index_name>;
```
**왜 절대 자동이 아닌가:**
- "미사용"은 단지 **신규 인덱스**거나 **저트래픽/최근 통계 리셋**일 수 있다. freesign처럼 초기 단계 앱은 대부분의 인덱스가 아직 "미사용"으로 뜬다.
- 의도적으로 만든 인덱스(예: 레이트리밋 조회용 `rate_limit_events_lookup`)를 지우면 나중에 트래픽이 늘 때 성능이 급락한다.
- DROP은 되돌리려면 재생성 비용이 든다.
→ **삭제하지 말고 "관찰"로 보고**. 정말 지우려면 사용자가 트래픽·통계 기간을 근거로 판단하게 한다. 통계 확인:
```sql
select relname, idx_scan from pg_stat_user_indexes where indexrelname = '<index_name>';
```

---

### `duplicate_index` 🟡 review
**뜻:** 동일 컬럼 집합에 인덱스가 중복. 하나는 지워도 됨.
**수정:** 중복 중 하나 `drop index`. **왜 review:** 어느 쪽을 지울지(제약이 만든 인덱스 vs 수동 인덱스), UNIQUE/PK 백업 인덱스는 아닌지 확인 필요. 잘못 지우면 제약이 깨질 수 있다.

---

### `multiple_permissive_policies` 🟡 review
**뜻:** 같은 role·action에 permissive 정책이 여럿 → 매 쿼리마다 모두 평가돼 성능 저하.
**수정:** 정책을 하나로 통합(`or`로 조건 합치기). **왜 review:** 정책 통합은 **인가 로직 변경**이다. 잘못하면 접근 범위가 넓어지거나 좁아진다. 반드시 사람이 검토. 자동 생성 금지.

---

### `auth_rls_initplan` 🟢 auto
**뜻:** RLS 정책에서 `auth.uid()`·`current_setting()`을 행마다 재평가 → `(select auth.uid())`로 감싸면 InitPlan으로 한 번만 평가돼 대폭 빨라진다.
**수정:** 정책의 `auth.uid()`를 `(select auth.uid())`로 교체. 이 레포는 이미 이 패턴을 쓰지만 누락분이 뜨면 안전한 개선(동작 동일, 성능만 향상)이라 auto. 단 정책 재정의(`drop policy`+`create policy` 또는 `alter policy ... using (...)`)라 SQL을 정확히 만들려면 기존 정책 정의를 먼저 읽어라:
```sql
select policyname, cmd, qual, with_check from pg_policies where tablename = '<tbl>';
```

---

### `no_primary_key` 🟡 review
**뜻:** PK 없는 테이블 → 복제·일부 도구·성능에 불리.
**수정:** PK 추가. **왜 review:** 어떤 컬럼(들)을 PK로 할지는 도메인 판단. 기존 데이터에 중복이 있으면 추가가 실패한다. 사람이 결정.

---

## 적용 시 공통 규칙
- 승인된 auto 항목은 **한 마이그레이션 파일에 모아** 다음 시퀀스 번호로 저장(`supabase/migrations/NNNN_advisor_*.sql`), 상단에 대상 린트 주석.
- `apply_migration`(파일+원격 쌍)으로 반영 후 `get_advisors` 재실행으로 해소 검증.
- review/manual은 승인해도 신중히 — 특히 DROP·정책 변경·RLS enable은 앱을 깨뜨릴 수 있으니 한 번 더 확인.
