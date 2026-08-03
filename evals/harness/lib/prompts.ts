// 프롬프트 빌더 — 순수 문자열 조립. 모델 호출은 tracks/ 에서.
//
// 두 트랙의 컨텍스트 주입 방식이 다르다(의도적):
//  - review: CLAUDE.md의 CRITICAL 규칙을 "요약"해 baked 시스템 프롬프트로. 경량 리뷰어 루브릭.
//  - qa: 런타임에 읽은 "라이브 CLAUDE.md 전문"을 컨텍스트로. 문서 자체가 정답 근거.

import type { ParsedCase } from "./types.ts";

/**
 * review 트랙 피험 모델(경량 리뷰어)의 시스템 프롬프트.
 * CLAUDE.md의 CRITICAL 규칙 요약 = 리뷰 루브릭. 라이브 문서가 아니라 박제된 요약이다.
 */
export const REVIEW_SYSTEM_PROMPT = `너는 FreeSign(Next.js 15 + Supabase) 코드의 경량 아키텍처 리뷰어다.
아래 CRITICAL 경계 규칙 위반만 잡는다. 스타일·성능·취향은 지적하지 않는다.

[read-boundary] 읽기는 RSC에서 Supabase 직접 조회(RLS 스코프). 읽기를 내부 /api fetch로 우회 금지.
[write-boundary] 쓰기는 Server Action에서만. 클라이언트 컴포넌트/RSC에서 직접 insert·update·delete 금지.
[secret-boundary] Claude·서명 해시·PDF·CSV·service_role 등 시크릿/외부 API는 app/api 라우트나 서버 전용 모듈에서만. service_role 키는 요청 경로에서 절대 금지(CLI 시드 전용). 클라이언트 직접 호출 금지.
[zod-allowlist] Server Action은 client 입력 전용 zod allowlist(도메인 필드만) 수신. user_id는 항상 getUser()에서. 서버 소유 필드(status·paid_at·doc_hash·signature_meta·is_demo·금액 스냅샷·pdf 경로)는 client 입력 금지. FK 참조는 소유권 재조회 검증 후 insert.
[provider-boundary] 전자서명·결제는 services/ 의 Provider 인터페이스 뒤로만 접근. AI 계약서 결과는 항상 "초안" 취급, 실패 시 골격 폴백(필수 게이트 아님).
[definer-rpc-scope] SECURITY DEFINER 함수는 RLS를 우회한다. 세션 있는 경계의 파괴적 RPC(계정 삭제 등)는 대상을 클라이언트 인자(p_user_id 등)로 받지 말고 auth.uid()로 정해야 한다. 앱이 옳게 넘겨준다는 주석은 근거가 아니다 — PostgREST로 직접 호출 가능하다.

[정상 패턴 — 위반으로 보고하지 말 것]
아래는 CLAUDE.md가 오히려 요구하는 올바른 코드다. 절대 위반으로 지목하지 말 것:
- user_id를 getUser()에서 얻어 insert에 넣는 것 (client 입력이 아니라 서버에서 취득 → 정상).
- FK(client_id·contract_id 등)를 insert 전에 소유권 재조회로 검증하는 것 (요구되는 방식 → 정상).
  읽기(select)는 RLS로 이미 user_id 스코프되므로, 소유 테이블에서 .eq("id", ...)로 재조회하는 것만으로 소유권이 검증된다.
  명시적 user_id 필터가 없다는 이유로 위반이라 하지 말 것.
- status·paid_at 등 서버 소유 필드를 서버 코드에서 직접(하드코딩) 세팅하는 것 (정상).
  위반은 오직 그 서버 소유 필드를 "client 입력"(zod 스키마 필드·요청 본문)으로 받을 때만이다.
- 세션 없는 경계(webhook·크론)의 DEFINER 함수가 p_*_secret 시크릿 인자를 받아 여러 사용자 행을 쓰는 것
  (ADR-010·011이 요구하는 방식 → 정상). definer-rpc-scope 위반은 "삭제 대상 식별자"를 인자로 받을 때다.
어떤 규칙 위반인지 확신이 서지 않으면 위반으로 보고하지 말고 {"violations": []} 를 반환한다.

판정은 반드시 아래 JSON 한 개로만 답한다. 산문 금지.
{"violations": [{"rule": "<위 슬러그 중 하나>", "evidence": "<근거 한 줄>"}]}
위반이 없으면 {"violations": []} 를 반환한다.`;

/** review 피험 모델에게 줄 유저 메시지(리뷰 대상 코드). */
export function buildReviewSubjectUser(code: string): string {
  return `다음 코드를 위 규칙으로 리뷰하라:\n\n\`\`\`\n${code}\n\`\`\``;
}

/** qa 피험 모델의 시스템 프롬프트. 라이브 CLAUDE.md 전문을 근거로 박아 넣는다. */
export function buildQaSubjectSystem(claudeMd: string): string {
  return `너는 FreeSign 코드베이스 규약에 답하는 어시스턴트다.
아래 CLAUDE.md(프로젝트 규약)만을 근거로 간결하게 답하라. 문서에 근거가 없으면 모른다고 답한다.
질문의 전제가 문서와 어긋나면 전제를 먼저 바로잡아라.

<CLAUDE.md>
${claudeMd}
</CLAUDE.md>`;
}

const JUDGE_JSON_INSTRUCTION = `반드시 아래 JSON 한 개로만 답하라. 산문·코드펜스 없이:
{"verdict": "pass" | "fail", "reason": "<한 줄 근거>"}`;

/** review 트랙 judge(Opus) 프롬프트. 기대 라벨 대비 리뷰어 출력을 채점. */
export function buildReviewJudgePrompt(c: ParsedCase, subjectOutput: string): string {
  const expectation =
    c.expect === "violation"
      ? `이 코드에는 [${c.rule}] 규칙 위반이 실제로 존재한다. 리뷰어가 그 위반(rule 슬러그 일치)을 잡아냈으면 pass, 놓쳤으면 fail.`
      : `이 코드에는 CRITICAL 위반이 없다(정상). 리뷰어가 위반을 하나도 보고하지 않았으면 pass, 없는 위반을 지어냈으면(오탐) fail.`;

  return `너는 코드 리뷰 품질 채점자다. 아래 리뷰어 출력이 정답 라벨에 부합하는지 판정하라.

[정답 라벨]
expect = ${c.expect}${c.rule ? `\nrule   = ${c.rule}` : ""}

[채점 기준]
${expectation}

[리뷰어 출력]
${subjectOutput}

${JUDGE_JSON_INSTRUCTION}`;
}

/** qa 트랙 judge(Opus) 프롬프트. 응답을 must/must_not 사실로 채점. */
export function buildQaJudgePrompt(c: ParsedCase, subjectOutput: string): string {
  const must = (c.must ?? []).map((m) => `  - ${m}`).join("\n");
  const mustNot = (c.must_not ?? []).map((m) => `  - ${m}`).join("\n");

  return `너는 코드베이스 QA 답변의 사실성 채점자다. 아래 응답을 정답 사실 목록으로 채점하라.

[질문]
${c.body}

[반드시 담겨야 하는 사실(must) — 하나라도 빠지면 fail]
${must}

[담기면 안 되는 사실(must_not) — 하나라도 담기면 fail]
${mustNot}

[응답]
${subjectOutput}

의미가 통하면 표현이 달라도 인정한다(문자열 완전일치 아님).
${JUDGE_JSON_INSTRUCTION}`;
}
