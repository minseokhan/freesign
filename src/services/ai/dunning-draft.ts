// server-only: Claude 클라이언트를 서버 env로 생성하므로 클라이언트 컴포넌트에서 import 금지.
// contract-draft.ts 골격 복제: tool_use 강제 + strict schema + zod 검증 + 결정론적 폴백 +
// 재시도 + captureServerException. Claude는 게이트가 아니라 향상 요소 — 실패 시 폴백 초안.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { getAnthropicEnv } from "@/lib/env";
import { formatKRW } from "@/lib/metrics";
import { captureServerException } from "@/lib/posthog-server";
import { ANTHROPIC_CONTRACT_MODEL } from "@/services/ai/contract-draft";

const DUNNING_DRAFT_TOOL_NAME = "return_dunning_draft";
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_BACKOFF_MS = 150;

export interface DunningDraftInput {
  clientName: string;
  contractTitle: string;
  amountNet: number;
  dueDate: string; // YYYY-MM-DD
  daysOverdue: number;
  freelancerName: string | null;
}

export interface DunningDraft {
  subject: string;
  body: string;
  source: "ai" | "fallback";
}

export interface AnthropicMessagesClient {
  messages: {
    create: (params: unknown) => Promise<unknown>;
  };
}

interface GenerateDunningDraftOptions {
  client?: AnthropicMessagesClient;
  retryCount?: number;
  backoffMs?: number;
}

const aiDraftSchema = z.object({
  subject: z.string().trim().min(1),
  body: z.string().trim().min(1),
});

const toolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  name: z.literal(DUNNING_DRAFT_TOOL_NAME),
  input: z.unknown(),
});

const messageResponseSchema = z.object({
  content: z.array(z.unknown()),
});

function freelancerLabel(name: string | null): string {
  return name?.trim() || "담당자";
}

export function buildDunningFallback(input: DunningDraftInput): DunningDraft {
  const subject = `[안내] "${input.contractTitle}" 대금 지급 안내`;
  const body = [
    `${input.clientName}님, 안녕하세요.`,
    `"${input.contractTitle}" 관련 대금(실수령 기준 ${formatKRW(input.amountNet)})의 지급기한(${input.dueDate})이 ${input.daysOverdue}일 지났습니다.`,
    "확인 후 지급을 진행해 주시면 감사하겠습니다. 이미 처리하셨다면 이 안내는 무시해 주세요.",
    "궁금하신 점이 있으면 회신 부탁드립니다.",
    `감사합니다.\n${freelancerLabel(input.freelancerName)} 드림`,
  ].join("\n\n");

  return { subject, body, source: "fallback" };
}

export async function generateDunningDraft(
  input: DunningDraftInput,
  options: GenerateDunningDraftOptions = {},
): Promise<DunningDraft> {
  const fallback = buildDunningFallback(input);
  const retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const maxAttempts = Math.max(1, retryCount + 1);

  let client: AnthropicMessagesClient;
  try {
    client = options.client ?? createAnthropicClient();
  } catch (error) {
    await captureServerException(error, undefined, {
      feature: "ai_dunning_draft",
    });
    return fallback;
  }

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await client.messages.create(buildClaudeRequest(input));
      const aiDraft = parseClaudeDraft(response);

      if (aiDraft) {
        return { ...aiDraft, source: "ai" };
      }
    } catch (error) {
      // Claude는 게이트가 아니라 향상 요소. 재시도 소진 후 폴백 초안 반환.
      lastError = error;
    }

    if (attempt < maxAttempts) {
      await sleep(backoffMs * attempt);
    }
  }

  await captureServerException(
    lastError ?? new Error("Claude 독촉 초안 응답이 스키마와 불일치해 폴백"),
    undefined,
    { feature: "ai_dunning_draft" },
  );

  return fallback;
}

function createAnthropicClient(): AnthropicMessagesClient {
  if (typeof window !== "undefined") {
    throw new Error("Dunning draft generation is only available on the server.");
  }

  const env = getAnthropicEnv();
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  return {
    messages: {
      create: (params) => anthropic.messages.create(params as never),
    },
  };
}

function buildClaudeRequest(input: DunningDraftInput) {
  return {
    model: ANTHROPIC_CONTRACT_MODEL,
    max_tokens: 1500,
    thinking: { type: "disabled" },
    system: [
      "You draft polite Korean payment-reminder (dunning) emails for a freelancer on FreeSign.",
      "Write subject and body in natural, courteous Korean. Never threaten or use aggressive language.",
      "Do not invent facts, statutes, or late fees that were not provided.",
      "Acknowledge the client may have already paid and ask them to ignore the notice if so.",
      "The output is a draft the freelancer will review before sending; do not execute any action.",
    ].join("\n"),
    tools: [
      {
        name: DUNNING_DRAFT_TOOL_NAME,
        description: "Return a polite Korean payment reminder draft (subject + body).",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            subject: { type: "string" },
            body: { type: "string" },
          },
          required: ["subject", "body"],
        },
        strict: true,
      },
    ],
    tool_choice: { type: "tool", name: DUNNING_DRAFT_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                client_name: input.clientName,
                contract_title: input.contractTitle,
                amount_net_krw: input.amountNet,
                due_date: input.dueDate,
                days_overdue: input.daysOverdue,
                freelancer_name: freelancerLabel(input.freelancerName),
              },
              null,
              2,
            ),
          },
        ],
      },
    ],
  };
}

function parseClaudeDraft(response: unknown) {
  const parsedResponse = messageResponseSchema.safeParse(response);

  if (!parsedResponse.success) {
    return null;
  }

  for (const block of parsedResponse.data.content) {
    const toolUse = toolUseBlockSchema.safeParse(block);

    if (!toolUse.success) {
      continue;
    }

    const draft = aiDraftSchema.safeParse(toolUse.data.input);
    return draft.success ? draft.data : null;
  }

  return null;
}

function sleep(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
