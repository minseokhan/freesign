// Anthropic SDK 래퍼 — 라이브 전용(ANTHROPIC_API_KEY 필요). textFromContent 만 순수.

import Anthropic from "@anthropic-ai/sdk";

/** 피험 모델(subject): 경량·temp0 리뷰어/응답자. */
export const SUBJECT_MODEL = "claude-sonnet-5";
/** 채점 모델(judge): subject와 다른 모델로 독립성 확보. */
export const JUDGE_MODEL = "claude-opus-4-8";

type ContentBlock = { type: string; text?: string };

/** 메시지 콘텐츠 블록에서 text만 이어붙인다. 순수. */
export function textFromContent(content: ContentBlock[]): string {
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("");
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY 가 없습니다. 라이브 채점은 `npm run eval` 로 키와 함께 실행하세요.");
  }
  client ??= new Anthropic();
  return client;
}

export interface CompleteOptions {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}

/**
 * 단일 턴 완성 호출 → 응답 텍스트. 라이브(네트워크·비용).
 * 최신 모델(Opus 4.8·Sonnet 5)은 temperature 파라미터를 제거(보내면 400)했으므로
 * 샘플링 파라미터를 넣지 않는다. 결정성은 낮은 온도가 아니라 명확한 골든셋·프롬프트로 담보한다.
 */
export async function complete(opts: CompleteOptions): Promise<string> {
  const msg = await getClient().messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1024,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  return textFromContent(msg.content as ContentBlock[]);
}
