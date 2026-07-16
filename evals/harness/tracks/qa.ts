// qa 트랙: 응답자(Sonnet·temp0)가 라이브 CLAUDE.md를 근거로 규약 질문에 답하는지 Opus가 사실 채점.
// 라이브(네트워크·비용) — 순수 조각(prompts·judge)만 조립.

import { complete, SUBJECT_MODEL, JUDGE_MODEL } from "../lib/anthropic.ts";
import { buildQaSubjectSystem, buildQaJudgePrompt } from "../lib/prompts.ts";
import { parseJudgeVerdict } from "../lib/judge.ts";
import type { CaseResult, ParsedCase } from "../lib/types.ts";

const JUDGE_SYSTEM = "너는 엄격하고 일관된 사실성 채점자다. 요구된 JSON 한 개로만 답한다.";

/** claudeMd: 런타임에 읽은 프로젝트 CLAUDE.md 전문(라이브 컨텍스트). */
export async function runQaCase(c: ParsedCase, claudeMd: string): Promise<CaseResult> {
  const subjectOutput = await complete({
    model: SUBJECT_MODEL,
    system: buildQaSubjectSystem(claudeMd),
    user: c.body,
  });

  const judgeRaw = await complete({
    model: JUDGE_MODEL,
    system: JUDGE_SYSTEM,
    user: buildQaJudgePrompt(c, subjectOutput),
  });

  const verdict = parseJudgeVerdict(judgeRaw);
  return {
    id: c.id,
    track: "qa",
    verdict: verdict.verdict,
    reason: verdict.reason,
    subjectOutput,
  };
}
