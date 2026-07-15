---
name: db-advisor
description: Supabase 데이터베이스의 보안·성능을 Supabase MCP get_advisors(어드바이저 린트)로 점검하고, 발견 항목을 HTML 대시보드(Artifact)로 보고한 뒤 수정안을 마이그레이션 SQL로 제안한다. 사용자가 명시적으로 승인해야만 supabase/migrations 파일 생성 + 원격 apply_migration으로 적용한다. "DB 점검", "DB 어드바이저", "데이터베이스 보안 스캔", "데이터베이스 성능 점검", "supabase advisor", "get_advisors", "RLS 점검", "인덱스 점검", /db-advisor 트리거 시, 또는 사용자가 Supabase/Postgres 데이터베이스의 보안·성능을 점검·감사·개선해달라고 하거나 마이그레이션(DDL) 변경 후 부작용을 확인하려 할 때 반드시 사용.
---

# /db-advisor — Supabase DB 보안·성능 점검 & 수정 제안

Supabase MCP `get_advisors`로 데이터베이스의 **보안·성능 린트**를 받아 → **위험도로 3분류** → **HTML 대시보드로 보고** → **수정안을 마이그레이션 SQL로 제안**한다.
**절대 먼저 적용하지 않는다.** 사용자가 명시적으로 승인한 항목만 `supabase/migrations` 파일 생성 + 원격 `apply_migration`으로 반영한다.

> 이 스킬은 코드 스캔이 아니라 **살아있는 원격 DB 상태**를 점검한다(빌트인 `/security-review`·`owasp-scan`은 코드 대상). DDL(마이그레이션·함수·인덱스) 변경 직후 실행하면 RLS 누락·search_path·인덱스 문제를 잡아준다.

## 핵심 원칙 (사용자 합의)

1. **제안 우선, 적용은 승인 후.** 스킬은 수정 SQL까지 완성해 보여주되, **사용자가 "적용해"라고 승인하기 전엔 apply_migration/execute_sql을 절대 호출하지 않는다.**
2. **적용은 파일 + 원격 쌍으로.** 승인 시 `supabase/migrations`에 마이그레이션 파일을 만들고(git 추적) **동시에** 원격에 `apply_migration`으로 반영한다. 원격은 커밋만으로는 반영되지 않으므로 둘을 반드시 함께 한다.
3. **파괴적·비가역 변경은 자동 금지.** 인덱스/객체 DROP, 데이터 변형은 항상 "검토 필요"로 두고 자동 적용하지 않는다.

## 실행 절차

### 1. 대상 프로젝트 확정
- `mcp__supabase__list_projects`로 프로젝트를 조회한다. 이 레포는 기본이 **freesign**(ref `jbfxkcjeoqwcdsxuemug`)이다. 프로젝트가 하나면 그걸 쓰고, 여럿이면 이름으로 매칭하되 애매하면 사용자에게 확인한다.
- `project_id`(ref)를 확정한다. 이후 모든 어드바이저·SQL 호출에 쓴다.

### 2. 어드바이저 스캔 + 쓰기 가능 여부 프리플라이트
- **read-only 프리플라이트(중요):** `mcp__supabase__execute_sql`로 `show default_transaction_read_only;`를 한 번 확인한다. 값이 `on`이면 이 MCP 연결은 **읽기 전용**이라 6단계의 `apply_migration`·`execute_sql` 쓰기가 전부 실패한다(오류: `cannot execute ... in a read-only transaction`). 이 경우 사용자에게 **미리** 알린다: "스캔·보고·마이그레이션 파일 생성까지는 되지만 **원격 자동 적용은 불가**합니다. MCP를 쓰기 모드로 재연결하거나(호스팅형은 mcp.supabase.com 연결 설정에서 read-only 해제), 생성된 파일을 Supabase 대시보드 SQL 에디터/`supabase db push`로 수동 적용해야 합니다." 그리고 6단계에서 원격 적용 대신 **파일 생성까지만** 하고 수동 적용을 안내한다.
- `mcp__supabase__get_advisors`를 **security·performance 두 번**(가능하면 병렬) 호출한다. 각 호출은 `lints[]` 배열을 반환한다.
- 각 lint의 주요 필드: `name`(린트 슬러그), `title`, `level`(ERROR|WARN|INFO), `categories`([SECURITY|PERFORMANCE]), `detail`, `remediation`(문서 URL), `metadata`(대상 객체: schema·name·type·fkey_name 등).
- 결과가 0건이면 그 사실을 대시보드/보고에 명시한다(클린).

### 3. 위험도 3분류 + 수정 SQL 준비
각 lint를 `references/fix-recipes.md`의 레시피에 따라 **3버킷**으로 분류하고, 고칠 수 있으면 수정 SQL을 만든다. **아직 적용하지 않는다 — 준비만.**

- 🟢 **auto** — 확실히 안전·가역적. 수정 SQL을 완성한다. (예: `unindexed_foreign_keys`→`CREATE INDEX`, `function_search_path_mutable`→search_path 고정)
- 🟡 **review** — SQL은 만들되 **강한 경고**. 판단이 필요하거나 되돌리기 어렵다. (예: `unused_index`·`duplicate_index` DROP — "미사용"은 단지 트래픽이 없어서일 수 있음)
- ⚪ **manual** — SQL로 못 고침. 수동 안내만. (예: `auth_leaked_password_protection`·`auth_otp_long_expiry`는 대시보드/Auth 설정, SQL 아님)

**레시피에 없는 린트**를 만나면 추측하지 말고 `remediation` URL을 근거로 삼되, 안전성이 불확실하면 🟡 review로 보수적으로 분류하고 대시보드에 "레시피 미등록 — 수동 검토" 표시를 남긴다.

**함수 search_path 수정의 함정(중요):** `ALTER FUNCTION f() SET search_path = ''`(빈 값)은 함수 본문의 모든 객체 참조를 스키마 한정(`public.tbl`)으로 강제한다. 본문이 한정 없이 테이블을 참조하면 **깨진다**. 그러므로:
1. `mcp__supabase__execute_sql`로 `select pg_get_functiondef('public.<fn>'::regprocedure)`를 먼저 읽어 본문을 확인한다(읽기 전용, 안전).
2. 본문이 이미 스키마를 한정했으면 → `ALTER FUNCTION ... SET search_path = ''`로 안전하게 고정.
3. 한정 안 된 참조가 있으면 → 함수를 **재정의**(`CREATE OR REPLACE`)하며 참조를 `public.`으로 한정하거나, 최소한 `SET search_path = public, pg_temp`로 고정한다. 단순 ALTER로 밀어붙이지 말 것.
자세한 판단 기준은 `references/fix-recipes.md`의 `function_search_path_mutable` 항목 참조.

### 4. 대시보드 생성·게시
분류·SQL 준비가 끝나면 스크래치에 `db-advisor-findings.json`을 쓴다(스키마는 `scripts/build_dashboard.py` 상단 docstring 참조):

```json
{
  "meta": { "project": "freesign", "project_ref": "jbfx…", "generated": "<오늘 날짜>",
            "types": ["security", "performance"] },
  "findings": [
    { "lint": "function_search_path_mutable", "title": "Function Search Path Mutable",
      "level": "WARN", "category": "SECURITY",
      "detail": "Function public.set_updated_at has a role mutable search_path",
      "entity": "public.set_updated_at", "remediation_url": "https://…",
      "bucket": "auto", "fix_sql": "ALTER FUNCTION public.set_updated_at() SET search_path = '';",
      "fix_note": "본문이 public. 한정 확인됨 — 빈 search_path 안전" }
  ]
}
```

self-contained HTML 대시보드를 만든다(경로는 이 스킬 디렉터리 기준):

```bash
python3 scripts/build_dashboard.py <스크래치>/db-advisor-findings.json --out <스크래치>/db-advisor-dashboard.html
```

이 스크립트는 **판정 배너 → 레벨 타일(ERROR/WARN/INFO) → 카테고리(보안/성능) + 버킷(자동/검토/수동) 요약 → 항목별 상세(대상·수정 SQL·근거)**를 담은 라이트/다크 대응 HTML을 출력한다(Artifact가 감싸도록 래퍼 태그 없이 `<style>`+마크업만).

그다음 **Artifact 툴로 게시**한다:
- 게시 전 `artifact-design` 스킬을 로드해 디자인 기준을 확인한다(대시보드 디자인은 스크립트에 반영돼 있어 빠르게 통과).
- `Artifact({ file_path: "<스크래치>/db-advisor-dashboard.html", description: "Supabase DB 보안·성능 어드바이저 결과", favicon: "🩺" })`.

### 5. 보고 + 승인 대기 (게이트)
게시 후 사용자에게 **Artifact URL + 판정 + 집계(보안 N·성능 N, 자동수정가능 N·검토 N·수동 N)**를 2~4줄로 보고한다. 🟢 auto 항목이 있으면 "이 N건은 안전하게 자동 수정할 수 있다"고 제안하고, 🟡·⚪ 항목은 왜 자동으로 못/안 하는지 한 줄로 짚는다.

**그리고 멈춘다.** 사용자에게 무엇을 적용할지 물어본다(예: "🟢 전체 적용", "특정 항목만", "적용 안 함"). **여기서 절대 앞질러 apply하지 않는다** — 이게 이 스킬의 핵심 계약이다.

### 6. 승인된 항목만 적용
사용자가 적용을 승인하면, 승인 범위 안의 항목만:

1. **마이그레이션 파일 작성.** `supabase/migrations`의 마지막 번호를 확인해(`ls`) 다음 4자리 시퀀스로 파일을 만든다. 이름은 서술적으로: 보안 수정이면 `NNNN_advisor_security_fixes.sql`, 성능이면 `NNNN_advisor_perf_indexes.sql`. 한 번의 승인은 **한 파일에** 모으되, 보안·성능이 섞이면 두 파일로 나눠도 된다. 파일 상단에 어떤 린트를 고치는지 주석으로 남긴다.
2. **원격 적용.** (2단계 프리플라이트가 read-only가 **아닐** 때만) `mcp__supabase__apply_migration`에 `name`(파일명에서 확장자 뺀 것)과 `query`(파일 내용)를 넘겨 원격 freesign DB에 반영한다. 파일과 원격을 반드시 함께 — git↔DB 드리프트를 막는다. **read-only면** 원격 적용을 건너뛰고 파일만 남긴 뒤, 사용자에게 수동 적용 방법(대시보드 SQL 에디터 또는 `supabase db push`)과 파일 경로를 안내한다.
3. **검증.** 적용 후 `get_advisors`를 관련 타입으로 **재실행**해 해당 린트가 사라졌는지 확인한다. 남아 있으면 원인을 조사해 보고한다(예: 함수 재정의가 필요했는데 ALTER만 했다면 여기서 드러난다).

### 7. 마무리
적용 후 사용자에게 **무엇을 적용했는지(파일명 + 린트 목록) + 재스캔 결과(해소 N·잔여 N) + 남은 수동 항목**을 보고한다. 커밋은 사용자 지시가 있을 때만 한다(이 레포는 main 직접 커밋 선호).

> 어드바이저는 정적 린트라 완전하지 않다. 특히 성능 인덱스 제안은 실제 쿼리 패턴을 봐야 최종 판단할 수 있고, "미사용 인덱스"는 신규·저트래픽일 수 있음을 대시보드 하단에도 명시한다.
