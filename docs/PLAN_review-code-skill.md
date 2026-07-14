# PLAN: `/review-code` 차원별 서브에이전트 병렬 리뷰 스킬

> 상태: **구현 완료.** (아래 계획대로 구현하되 일부 구조 조정 — §0 참조)
> 결정: 메커니즘 = **Workflow 오케스트레이션**, MVP 3축 = **security · correctness · architecture**.
> 출력: **PR 인라인 코멘트(2층)**, 심각도 **4단계 = critical / major / minor / nit**.

## 0. 구현 결과 (계획 대비 조정)

- **스킬**: `.claude/skills/review-code/SKILL.md` — 워크플로우 스크립트를 **인라인 코드블록으로 내장**.
  별도 `.js` 파일을 두지 않는다(TDD 가드가 `.claude/**`의 `.js`도 막고, vitest는 `.claude/**`를 exclude → 테스트 불가한 config를 디스크 소스로 두지 않음). 에이전트가 Workflow 툴에 inline `script`로 전달.
- **집계·판정 분리**: 워크플로우는 **verify 통과 raw findings만 반환**. dedupe/정렬/집계/판정은 검증된 순수 모듈
  `src/lib/review/verdict.ts`(테스트 `src/lib/review/__tests__/verdict.test.ts`, 9 tests green)가 담당.
  CLI 겸용 → `cat findings.json | node --experimental-strip-types src/lib/review/verdict.ts`.
  이유: 순수 판정 로직은 CLAUDE.md TDD 대상인데 샌드박스 워크플로우 안에선 테스트가 불가능하므로 밖으로 뺐다.
- 나머지(3축·프롬프트·스키마·인라인 2층·게시·폴백)는 아래 계획과 동일.

## 1. 목적과 근거

변경 diff를 **차원별 전문 서브에이전트로 병렬 리뷰**하고, 각 지적을 adversarial verify로 거른 뒤,
dedup·severity 정렬해 하나의 리포트로 취합한다.

**왜 병렬로 쪼개는가**
- **차원별 전문성**: 각 서브에이전트는 자기 축의 규칙(예: 보안 = RLS/소유권/service_role)만 주입받아 집중도가 높다.
- **동시 실행 속도**: N개 축이 동시에 돌아 벽시계 시간 = 가장 느린 한 축.
- **오탐 억제**: 병렬 finder는 그럴듯하지만 틀린 지적을 낳는다 → verify 단계가 걸러낸다.

## 2. 기존 자산과의 관계 (중복 방지)

| 자산 | 성격 | `/review-code`와 차이 |
|------|------|----------------------|
| `/review` (프로젝트 커맨드) | 단일 에이전트, 체크리스트 5개, 테이블 | 병렬·차원별 전문성 없음. 유지. |
| `/code-review` (빌트인) | diff 버그/단순화. `ultra`는 사용자만 트리거 | 우리가 만드는 건 **자가 트리거 가능한** 차원 팬아웃 |
| `pr-review-toolkit` (공식) | 6개 Task 에이전트 | 구조적 참고. 우리는 Workflow로 결정론적 오케스트레이션 |

> 네이밍: 빌트인 `/code-review`와 헷갈릴 수 있으나, 스킬명 `review-code`로 구분. 실행 시 안내 문구에 명시.

## 3. 차원(dimension) 설계

### 3.1 MVP 3축 (이번 구현 범위)

| key | 초점 | 주입 규칙(FreeSign CLAUDE.md / ARCHITECTURE.md) |
|-----|------|-----------------------------------------------|
| `security` | 데이터 유출·권한 | RLS `USING`+`WITH CHECK (user_id = auth.uid())` 둘 다 · `user_id`는 항상 `getUser()` 출처 · service_role 요청 경로 금지 · zod allowlist(도메인 필드만) · FK 소유권 재조회 검증 · Storage private + signed URL |
| `correctness` | 상태·정합성 | 상태 전이 순서(도메인 UPDATE → 이벤트 INSERT, status를 앞에 두지 말 것) · 부분 실패 방지 · 서버 소유 필드(status·paid_at·doc_hash·금액 스냅샷 등) client 입력 금지 · `deleted_at IS NULL` 헬퍼 경유 |
| `architecture` | 경계·구조 | 읽기 = RSC 직접 조회 / 쓰기 = Server Action(+`revalidatePath`) · 내부 `/api` fetch 우회 금지 · 시크릿·외부 API는 서버 전용 · Provider 인터페이스 뒤로만 서명/결제 · components/ types/ lib/ 분리 |

각 finder는 **자기 축 규칙 블록만** 주입 → 관심사 분리.

### 3.2 확장 세트 (다음 단계, 지금 구현 안 함)

원 요청의 10개는 실측상 겹침이 있어 **7축**으로 병합 권장:
- `performance` ← performance + CPU/perf patterns 통합
- `correctness` ← correctness + behavioral correctness 통합
- `conventions`는 `architecture`에 흡수 (FreeSign에선 사실상 동일 축)
- 남는 신규 축: `test-coverage`, `cross-file-consistency`, `privacy`

→ 확장은 스크립트의 `DIMENSIONS` 배열에 항목 추가만으로 완료 (아래 4.3).

## 4. 구현 설계

### 4.1 파일 위치
- 스킬: `.claude/skills/review-code/SKILL.md` (frontmatter `name`, `description`)
- Workflow 스크립트: SKILL.md 안에 인라인 전달하거나, 최초 실행 후 세션 디렉토리에 자동 저장된 경로로 재사용

### 4.2 실행 흐름

```
/review-code [PR번호?]
  1. (스킬, main 에이전트) 스코프 산정 — PR 대상
     - 인자로 PR번호 있으면: 그 PR
     - 없으면: gh pr view (현재 브랜치의 열린 PR) 자동 탐지
     - PR이 없으면: 폴백 = 터미널에 인라인 형식으로 출력 (게시 안 함) + 경고
     - 수집: PR diff, 변경 파일 경로, head commit SHA (인라인 앵커에 필요)
  2. Workflow 호출 (스킬이 지시 → opt-in 성립)
     args = { pr, headSha, paths: [...], diff: "<diff text>" }

     phase "Find": parallel 3 finders (security, correctness, architecture)
       - 각 finder: 축 규칙 주입 + diff + 변경 파일 Read 권한
       - schema로 구조화 findings[] 반환 (severity 4단계)
     phase "Verify": 각 finding마다 skeptic 1명 → confirmed/refuted (반박 시도)
     dedup: file+line+dimension 키로 중복 제거 (순수 코드)
     정렬: severity(critical→major→minor→nit) → file
     판정 산출: critical≥1 → Blocked / major≥1 → Changes Requested / else Approve
     return { verdict, tally, findings }
  3. (스킬) 게시
     - review body = 전체 요약(§4.6 2층 中 요약)
     - comments[] = 확정 finding별 인라인(§4.6 4줄 포맷), path+line+headSha 앵커
     - event = 판정 매핑 (Approve→APPROVE / 나머지→REQUEST_CHANGES)
     - gh api .../pulls/{pr}/reviews 로 단일 review 게시
     - 실패(자기 PR 승인 제한 등) 시 event=COMMENT로 재시도
```

### 4.3 Workflow 스크립트 골격

```js
export const meta = {
  name: 'review-code',
  description: '변경 diff를 차원별 서브에이전트로 병렬 리뷰하고 verify 후 취합',
  phases: [{ title: 'Find' }, { title: 'Verify' }],
}

const DIMENSIONS = [
  { key: 'security',     rules: `...RLS/소유권/service_role/zod allowlist/FK 재검증...` },
  { key: 'correctness',  rules: `...상태전이 순서/부분실패/서버소유필드/soft delete...` },
  { key: 'architecture', rules: `...RSC읽기/ServerAction쓰기/시크릿 서버전용/Provider...` },
  // 확장: performance / test-coverage / cross-file-consistency / privacy 여기에 추가
]

const FINDINGS_SCHEMA = { /* findings: [{file,line,severity,summary,detail,suggestedFix}] */ }
const VERDICT_SCHEMA  = { /* {confirmed: bool, reason: string} */ }

const results = await pipeline(
  DIMENSIONS,
  d => agent(finderPrompt(d, args), { label: `find:${d.key}`, phase: 'Find', schema: FINDINGS_SCHEMA }),
  (review, d) => parallel((review.findings || []).map(f => () =>
    agent(verifyPrompt(f), { label: `verify:${d.key}:${f.file}`, phase: 'Verify', schema: VERDICT_SCHEMA })
      .then(v => ({ ...f, dimension: d.key, verdict: v }))
  ))
)

const flat = results.flat().filter(Boolean).filter(f => f.verdict?.confirmed)
const deduped = dedupeByFileLineDim(flat)          // 순수 코드
return rankBySeverity(deduped)
```

> pipeline 사용: security의 findings가 verify로 넘어가는 동안 architecture는 아직 Find 중일 수 있음 → 벽시계 절약.

### 4.4 findings 스키마

```
finding = {
  dimension:    'security' | 'correctness' | 'architecture'
  file:         string        // repo-relative (인라인 앵커 path)
  line:         number        // 1-indexed, diff에 포함된 라인 (인라인 앵커)
  severity:     'critical' | 'major' | 'minor' | 'nit'
  title:        string        // 인라인 1줄: [심각도] 제목
  tldr:         string        // 인라인 2줄: 무엇이/왜 문제인지 1문장
  good:         string        // 인라인 3줄: 잘한 점/전제 인정 1문장
  fix:          string        // 인라인 4줄: 수정 코드 스니펫 (```suggestion 또는 diff)
}
```

> 인라인 앵커: GitHub review comment는 `path`+`line`+ (review의 `commit_id`=headSha)로 붙는다.
> `line`은 반드시 **diff에 등장한 라인**이어야 게시된다 → finder 프롬프트에 "변경/인접 라인만 지목" 명시.

### 4.5 verify 정책 (MVP)
- **skeptic 1명** (단일 투표). finding을 반박하도록 프롬프트, 불확실하면 confirmed=false 편향.
- 비용 이유로 MVP는 1표. 확장 시 3표 다수결(perspective-diverse: correctness/security/repro 렌즈)로 승격.

### 4.6 출력 형식 — PR 인라인 2층

심각도 아이콘: 🔴 critical · 🟠 major · 🟡 minor · ⚪ nit

**1층 — 인라인 코멘트 (finding 1개당 1개, 라인 앵커, 4줄)**

```markdown
🟠 **[major] Server Action이 user_id를 client 입력으로 받음**
TL;DR: `user_id`가 zod 스키마에 있어 타 사용자 레코드로 위조 가능.
Good: allowlist zod로 입력을 좁힌 접근 자체는 맞음.
​```suggestion
const userId = (await getUser()).id  // client 입력 대신 세션에서
​```
```

**2층 — PR 전체 요약 (review body, 1개)**

```markdown
## /review-code — {판정}
> Approve / Changes Requested / Blocked

**심각도 집계**: 🔴 critical N · 🟠 major N · 🟡 minor N · ⚪ nit N

**Walkthrough** (2~3줄): 이 변경이 무엇을 하고, 리뷰가 어디에 집중했는지.

**잘된 점**: 눈에 띄는 좋은 결정 1~2개.

**주요 지적 (critical/major만)**:
- 🔴 `path/file.ts:42` — {title}
- 🟠 `path/other.ts:88` — {title}

**다음 액션**: 머지 전 반드시 고칠 것 → … / 확인 후 재리뷰 요청.

<sub>3축(security·correctness·arch) · verify 1표 · 확장축(perf/test/privacy 등) 미포함</sub>
```

**판정 규칙**: critical≥1 → **Blocked** · (critical=0, major≥1) → **Changes Requested** · else → **Approve**
**event 매핑**: Approve→`APPROVE` · Changes Requested/Blocked→`REQUEST_CHANGES` · 게시 거부 시 폴백 `COMMENT`

## 5. 검증 기준 (실행 시 성공 조건)

1. `/review-code` 실행 → 3개 finder가 **병렬로** 뜨는 게 `/workflows`에 보인다.
2. 의도적으로 심은 결함(예: Server Action에서 `user_id`를 client 입력으로 받음)을 security 축이 잡는다.
3. verify가 명백한 오탐(정상 코드에 대한 트집)을 refuted로 거른다.
4. 같은 file:line 중복 지적이 dedup된다.
5. 테스트 PR에 **인라인 코멘트가 라인 앵커로 실제 게시**되고, **전체 요약 1개 + 판정**이 붙는다.
6. critical 있는 diff → Blocked, 없으면 규칙대로 판정된다. 자기 PR이면 COMMENT 폴백이 동작한다.

## 6. 열린 질문 / 실행 전 확인

- **PR 필수 vs 폴백**: 인라인 코멘트는 열린 PR이 있어야 한다. main 직접 커밋 습관상 PR이 없을 때가 잦음
  → 기본 폴백 = **터미널에 동일 4줄 포맷 인라인 출력**(게시 안 함). PR 없으면 자동으로 이 모드. (원하면 "PR 없으면 임시 PR 생성"으로 바꿀 수 있음)
- **자기 PR 승인 제한**: 리뷰어=PR작성자면 GitHub가 APPROVE/REQUEST_CHANGES 거부 가능 → `event: COMMENT` 폴백으로 자동 재시도.
- **verify 표 수**: MVP 1표로 확정. 오탐이 많으면 3표로 승격.
- **diff 라인 앵커**: 인라인은 diff에 등장한 라인에만 붙는다. finder가 diff 밖 라인을 지목하면 그 finding은 인라인 게시 불가 → 요약의 "주요 지적"으로만 노출(폴백).
- **파일 크기**: diff가 매우 크면 args 대신 스크래치 파일 경로 전달로 전환.
```

## 6.5 스모크 테스트 실측 관찰 (2026-07-15)

합성 diff(보안·아키텍처 위반 + 깨끗한 파일)로 실제 워크플로우를 2회 실행해 확인:

- ✅ **finder 3축 병렬 정상**: 심은 결함을 전부 포착(service_role 클라 노출·client user_id·status allowlist·FK 미검증·paid_at 무조건·에러 삼킴·revalidatePath 누락), 심각도(critical/major)도 정확.
- ✅ **verify 고품질**: 합성 diff가 디스크 파일과 불일치하자 verifier가 "파일 없음/해당 라인은 타입 정의"라며 정확히 refute. 실제 PR(diff=디스크)에선 confirm된다. → 오탐 억제 실동작.
- ✅ **집계/판정/렌더 정상**: verdict.ts로 dedupe(15→13)·정렬·판정(Blocked)·집계(🔴9·🟠4) 확인.
- ⚠️ **비용**: 3파일 리뷰에 verify 팬아웃 포함 ~405k 토큰/18에이전트. verify가 finding마다 파일을 Read해 무거움. → MVP는 verify 1표 유지하되, finding 많은 PR은 상한/샘플링 고려. 확장(7축)은 비용 급증 주의.
- ✅ **인접 라인 중복 → 병합 도입(해결, 부분적)**: `verdict.ts`의 `mergeFindings`가 ① 같은 `(file,line)` 차원 통합, ② 인접(±2)+title 유사(자카드≥0.3) 병합 수행. 실측 PR에서 10건→5건으로 감소, `dimensions[]` 부여. 잔여: 한국어 활용형 차이로 유사도 낮은 인접 2줄은 여전히 분리(형태소 분석 미도입, 임계값 하향은 오병합 위험이라 0.3 고정).
- ✅ **게시 검증(PR #1, 2026-07-15)**: 실제 PR에 인라인 6→(병합 후)코멘트 게시 성공, 라인 앵커 정확, 요약 2층 렌더 확인. 자기 PR이라 REQUEST_CHANGES 422 → COMMENT 폴백 동작 확인.
- ⚠️ **args 문자열 도착**: Workflow에 넘긴 args가 스크립트에 문자열로 도착 → `const A = typeof args==='string'?JSON.parse(args):(args||{})` 정규화 필수(반영 완료).

## 7. 실행 단계 (지시 오면)

```
1. .claude/skills/review-code/SKILL.md 작성          → 검증: Skill 목록에 노출
2. Workflow 스크립트 인라인/파일 작성 (DIMENSIONS 3축) → 검증: 3 finder 병렬 확인
3. 게시 로직 작성 (gh review API + 폴백 2종)          → 검증: dry-run으로 payload 확인
4. 의도적 결함 심은 테스트 PR로 스모크 테스트         → 검증: 6장 성공 조건 통과
5. 네이밍 안내(빌트인 /code-review와 구분) 마무리
```
