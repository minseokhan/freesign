// 프롬프트 빌더 — 순수 문자열 조립. 모델 호출은 tracks/ 에서.
//
// 두 트랙의 컨텍스트 주입 방식이 다르다(의도적):
//  - review: 규칙 정본(.claude/rules.json)에서 파생한 CRITICAL 루브릭. 경량 리뷰어용 요약.
//  - qa: 런타임에 읽은 "라이브 CLAUDE.md 전문"을 컨텍스트로. 문서 자체가 정답 근거.
//
// review 루브릭을 손으로 적지 않는 이유: 문서에 CRITICAL을 추가하고 여기 옮기는 걸 잊으면
// eval이 그 경계를 영영 재지 않는다(실제로 DEFINER RPC 관련 규칙에서 그렇게 갈라졌다).

import { buildEvalRubric, type RulesFile } from "../../../src/lib/review/rules.ts";
import type { ParsedCase } from "./types.ts";

/**
 * review 트랙 피험 모델(경량 리뷰어)의 시스템 프롬프트.
 * 루브릭 본문은 `.claude/rules.json`의 CRITICAL 규칙에서 파생한다 — 손으로 적은 사본이 아니다.
 */
export function buildReviewSystemPrompt(rules: RulesFile): string {
  return `너는 매듭(Maedeup, Next.js 15 + Supabase) 코드의 경량 아키텍처 리뷰어다.
아래 CRITICAL 경계 규칙 위반만 잡는다. 스타일·성능·취향은 지적하지 않는다.

${buildEvalRubric(rules)}

어떤 규칙 위반인지 확신이 서지 않으면 위반으로 보고하지 말고 {"violations": []} 를 반환한다.

판정은 반드시 아래 JSON 한 개로만 답한다. 산문 금지.
{"violations": [{"rule": "<위 슬러그 중 하나>", "evidence": "<근거 한 줄>"}]}
위반이 없으면 {"violations": []} 를 반환한다.`;
}

/** review 피험 모델에게 줄 유저 메시지(리뷰 대상 코드). */
export function buildReviewSubjectUser(code: string): string {
  return `다음 코드를 위 규칙으로 리뷰하라:\n\n\`\`\`\n${code}\n\`\`\``;
}

/** qa 피험 모델의 시스템 프롬프트. 라이브 CLAUDE.md 전문을 근거로 박아 넣는다. */
export function buildQaSubjectSystem(claudeMd: string): string {
  return `너는 매듭 코드베이스 규약에 답하는 어시스턴트다.
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
