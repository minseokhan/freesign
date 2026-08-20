// review 트랙: 경량 리뷰어(Sonnet·temp0)가 CRITICAL 위반을 잡는지 Opus가 채점.
// 라이브(네트워크·비용) — 순수 조각(prompts·judge·anthropic.textFromContent)만 조립.

import { complete, SUBJECT_MODEL, JUDGE_MODEL } from "../lib/anthropic.ts";
import {
  buildReviewSystemPrompt,
  buildReviewSubjectUser,
  buildReviewJudgePrompt,
} from "../lib/prompts.ts";
import { parseJudgeVerdict } from "../lib/judge.ts";
import type { RulesFile } from "../../../src/lib/review/rules.ts";
import type { CaseResult, ParsedCase } from "../lib/types.ts";

const JUDGE_SYSTEM = "너는 엄격하고 일관된 채점자다. 요구된 JSON 한 개로만 답한다.";

export async function runReviewCase(c: ParsedCase, rules: RulesFile): Promise<CaseResult> {
  const subjectOutput = await complete({
    model: SUBJECT_MODEL,
    system: buildReviewSystemPrompt(rules),
    user: buildReviewSubjectUser(c.body),
  });

  const judgeRaw = await complete({
    model: JUDGE_MODEL,
    system: JUDGE_SYSTEM,
    user: buildReviewJudgePrompt(c, subjectOutput),
  });

  const verdict = parseJudgeVerdict(judgeRaw);
  return {
    id: c.id,
    track: "review",
    verdict: verdict.verdict,
    reason: verdict.reason,
    subjectOutput,
  };
}
