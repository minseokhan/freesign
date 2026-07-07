# Step 2: ai-draft

## 읽어야 할 파일

- `/docs/ADR.md` — **ADR-004**(AI 계약서 = 템플릿 골격(코드) + Claude 하이브리드). 반드시 정독: 골격·필수조항 체크리스트는 **코드가 소유**, Claude는 (a) 범위 서술 → 조항 문구 다듬기, (b) 조항별 평문 요약만. tool-use/JSON + zod 검증 `{title, body, plain_summary, needs_review}`. **AI는 필수 게이트가 아닌 보강** — 실패·타임아웃 시 템플릿 골격만 draft 저장 + 멱등 재시도. 프롬프트 가드레일("새 법조문/판례 창작 금지, 불명확하면 `[검토 필요]`")
- `/docs/ARCHITECTURE.md` — "데이터 흐름"의 **AI 초안**(구조화 입력 → app/api(Claude) → zod 검증 → 성공: draft / 실패·타임아웃: 골격만 draft + 재시도(기존 draft 갱신, 멱등)), "패턴"(시크릿·외부 API는 서버 전용 모듈/`app/api`에서만, 클라이언트 직접 호출 금지)
- `/docs/PRD.md` — AI 계약서는 항상 "초안·참고용·전문가 검토 권장" 면책 반복 노출
- `/AGENTS.md`, `/CLAUDE.md` — CRITICAL: 시크릿·외부 API(Claude)는 서버 전용 모듈에서만, AI는 필수 게이트가 아닌 보강(실패 시 골격 폴백)
- phase 0 산출물: `src/lib/env.ts` — `getServerEnv()`가 `ANTHROPIC_API_KEY`를 검증·반환(이 서비스가 서버 전용임을 강제하는 게이트)
- **모델 선택은 `claude-api` 스킬을 먼저 읽어라**(현재 모델 ID·tool-use 사용법 확인). 기본값 권장: `claude-sonnet-5`(계약 문구 다듬기엔 충분·저지연). 모델 ID는 서비스 내 상수로 두고 임의로 옛 ID를 박지 마라.

**배경**: 이 서비스는 phase 5(`/contracts/new`)의 `app/api` 라우트가 호출하는 **서버 전용 초안 생성 모듈**이다. 이 step은 그 모듈(`services/ai/`)만 만든다 — 페이지·라우트 핸들러·DB draft 저장은 phase 5 소관이다. 여기서 만드는 함수는 "구조화 입력 → 검증된 Draft(또는 골격 폴백 Draft)"를 반환하는 것까지다.

## 작업

`@anthropic-ai/sdk`를 **dependency**로 추가하고, `src/services/ai/`에 계약서 초안 생성 서비스를 만든다.

`.codex` TDD 가드는 `services/*.ts`를 **테스트 없이 편집 차단**한다(services는 로직 레이어). 따라서 **테스트를 먼저 작성**하라(`src/services/ai/__tests__/*.test.ts`). 순수 타입만 담는 파일이 필요하면 `src/types/`에 두어라(가드 예외) — 단, 아래 로직(템플릿 조립·검증·폴백·재시도)은 반드시 테스트 동반.

### 구조(ADR-004의 하이브리드를 코드로 반영)

1. **템플릿 골격(코드 소유)** — 범용 용역계약서 1종의 조항 골격 + 필수조항 체크리스트를 코드로 소유하는 모듈. 입력(당사자·범위·금액·기한 등 구조화 필드)을 받아 **AI 없이도** 완결된 골격 Draft를 조립할 수 있어야 한다. 이게 폴백의 실체다.
2. **AI 보강** — Claude **tool-use**(또는 JSON 강제 출력)로 (a) 범위 서술을 조항 문구로 다듬고, (b) 조항별 평문 요약을 생성. 결과를 **zod로 검증**한다.
3. **검증 스키마(zod)** — 최소 `{ title, body, plain_summary, needs_review }`. `needs_review`는 boolean(불명확·`[검토 필요]` 포함 시 true). 스키마 불일치 시 그 AI 결과는 **버리고 골격 폴백**으로.
4. **폴백** — API 오류·타임아웃·스키마 검증 실패 시, 예외를 밖으로 던지지 말고 **템플릿 골격 Draft**(`needs_review: true`)를 반환. AI 장애가 기능을 막지 않게(ADR-004: 필수 게이트 아님).
5. **재시도(멱등)** — 일시적 오류에 대해 **횟수 상한이 있는** 재시도(예: 2~3회, 짧은 backoff). 상한 소진 시 폴백. 재시도는 같은 입력으로 같은 Draft 형태를 낳아야 한다(부수효과·누적 없음).

### 시그니처(예시 — 정확한 형태·내부는 재량)

```ts
// 클라이언트가 채우는 구조화 입력(도메인 필드만)
export interface ContractDraftInput {
  clientName: string;
  scope: string;          // 범위 서술(자연어) — AI가 조항 문구로 다듬음
  amount: number;
  dueDate?: string;
  // ...계약 골격에 필요한 최소 필드
}

// zod 검증을 통과한 초안(또는 골격 폴백)
export interface ContractDraft {
  title: string;
  body: string;              // 조항 본문
  plain_summary: string;     // 조항별 평문 요약
  needs_review: boolean;
  source: "ai" | "skeleton"; // 폴백 여부를 상위(phase 5 UI 면책·이력)가 알 수 있게
}

// 서버 전용. 실패해도 throw 대신 skeleton Draft 반환.
export async function generateContractDraft(input: ContractDraftInput): Promise<ContractDraft>;
```

`source` 필드를 두는 이유: phase 5 UI가 "골격 폴백으로 생성됨"을 배지·면책으로 노출하고 이력 타임라인에 남기기 위함. 폴백을 성공처럼 숨기지 마라.

**서버 전용 강제**: 이 모듈은 `getServerEnv()`(또는 `ANTHROPIC_API_KEY`)에 의존하므로 클라이언트 번들에 새면 안 된다. 파일 상단 주석에 "server-only" 명시. `env.ts`처럼 `typeof window !== 'undefined'` 가드를 두거나, 최소한 클라이언트에서 import되지 않게 서버 경로에서만 쓰이도록 하라(실제 클라이언트 차단 배선은 phase 5).

### 프롬프트 가드레일 (반드시 포함)

- "새 법조문·판례를 창작하지 마라. 불명확하면 `[검토 필요]`로 표기하고 `needs_review=true`."
- 출력은 항상 "초안·비권위적". 어떤 행위도 자동 실행하지 않는다.
- 골격 필수조항을 삭제·대체하지 말고 **문구만 다듬어라**(구조는 코드가 소유).

### 테스트 (먼저 작성 — 실제 Claude API 호출 금지)

Anthropic SDK를 **목(mock)** 으로 주입/스텁하라(테스트가 네트워크·실 키를 쓰면 안 된다). 최소 케이스:
- **정상**: 목이 스키마에 맞는 tool-use 결과를 반환 → `generateContractDraft`가 검증된 Draft(`source: "ai"`)를 반환.
- **스키마 불일치**: 목이 필드 누락/형식 오류를 반환 → 골격 폴백(`source: "skeleton"`, `needs_review: true`).
- **API 오류/타임아웃**: 목이 throw/지연 → 재시도 상한 후 골격 폴백(throw 없음).
- **골격 단독 조립**: AI 없이 템플릿이 입력만으로 완결된 Draft를 만드는가(필수조항 포함).
- **재시도 상한**: 재시도가 무한 루프가 아니라 상한에서 멈추고 폴백하는가.
- (SDK 주입 배선을 위해 함수가 client/factory를 옵션 인자로 받게 하는 등 테스트 가능 구조를 택하라 — 단 기본은 서버 env 기반 실 클라이언트.)

## Acceptance Criteria

```bash
npm install       # @anthropic-ai/sdk 추가
npm run lint
npm run build
npm test          # ai 서비스 단위테스트(테스트 먼저·API 목) + 기존 테스트 green
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 체크리스트:
   - 템플릿 골격이 **코드 소유**이고 AI 없이도 완결 Draft를 만드는가(필수조항 포함)?
   - AI 결과가 **zod로 검증**되고 불일치 시 폴백하는가?
   - 실패·타임아웃에 **throw 대신 골격 폴백**(기능 안 막힘)인가? 재시도가 상한이 있는가?
   - `source` 필드로 폴백 여부가 드러나는가?
   - 모듈이 서버 전용(시크릿 클라이언트 노출 없음)인가? 모델 ID를 상수로 두고 `claude-api` 스킬 기준 현재 ID를 썼는가?
   - 테스트가 먼저 작성됐고 **실 API를 호출하지 않는가**(목)?
3. `phases/2-domain-logic/index.json`의 step 2를 업데이트:
   - 성공 → `completed` + summary(파일 경로·`generateContractDraft` 등)
   - `@anthropic-ai/sdk` 설치 불가 등 개입 필요 → `blocked` + `blocked_reason`(재시도 후)
   - 그 외 실패 → `error`

## 금지사항

- `app/contracts/new` 페이지·`app/api` 라우트 핸들러·DB draft 저장/갱신을 만들지 마라. 이유: phase 5(contract-create-ai·contract-edit-confirm) 소관. 이 step은 서버 전용 서비스 함수까지다.
- 실패 시 예외를 상위로 던지지 마라. 이유: ADR-004 — AI는 필수 게이트가 아니다. 골격 폴백으로 기능이 계속돼야 한다.
- 계약서 골격·필수조항을 AI에게 통째로 생성시키지 마라. 이유: 법조문 창작·필수조항 누락 위험. 골격은 코드가 소유하고 AI는 문구만 다듬는다.
- 시크릿(`ANTHROPIC_API_KEY`)을 클라이언트 컴포넌트에서 접근 가능하게 만들지 마라. 이유: CRITICAL 보안 규칙 — 외부 API·시크릿은 서버 전용.
- 테스트에서 실제 Claude API를 호출하지 마라. 이유: 비결정적·네트워크·비용·실 키 필요. SDK를 목으로.
- 재시도를 무한/무제한으로 두지 마라. 이유: 라우트 타임아웃·비용 폭주. 상한 후 폴백.
- 기존 테스트를 깨뜨리지 마라.
