// server-only: this module creates Claude clients from server env and must not be imported by client components.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { getServerEnv } from "@/lib/env";
import { REQUIRED_CONTRACT_CLAUSES } from "@/lib/validation/contract";

export { REQUIRED_CONTRACT_CLAUSES };

export const ANTHROPIC_CONTRACT_MODEL = "claude-sonnet-5";
const CONTRACT_DRAFT_TOOL_NAME = "return_contract_draft";
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_BACKOFF_MS = 150;

export interface ContractDraftInput {
  freelancerName: string;
  clientName: string;
  scope: string;
  amount: number;
  startDate?: string;
  endDate?: string;
  dueDate?: string;
}

export interface ContractDraft {
  title: string;
  body: string;
  plain_summary: string;
  needs_review: boolean;
  source: "ai" | "skeleton";
}

export interface AnthropicMessagesClient {
  messages: {
    create: (params: unknown) => Promise<unknown>;
  };
}

interface GenerateContractDraftOptions {
  client?: AnthropicMessagesClient;
  retryCount?: number;
  backoffMs?: number;
}

const contractDraftInputSchema = z.object({
  freelancerName: z.string().trim().min(1),
  clientName: z.string().trim().min(1),
  scope: z.string().trim().min(1),
  amount: z.number().int().positive(),
  startDate: z.string().trim().min(1).optional(),
  endDate: z.string().trim().min(1).optional(),
  dueDate: z.string().trim().min(1).optional(),
});

const aiDraftSchema = z.object({
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
  plain_summary: z.string().trim().min(1),
  needs_review: z.boolean(),
});

const toolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  name: z.literal(CONTRACT_DRAFT_TOOL_NAME),
  input: z.unknown(),
});

const messageResponseSchema = z.object({
  content: z.array(z.unknown()),
});

export function buildSkeletonContractDraft(input: ContractDraftInput): ContractDraft {
  const parsed = contractDraftInputSchema.parse(input);
  const title = `${parsed.clientName} 용역계약서 초안`;
  const period = formatPeriod(parsed.startDate, parsed.endDate);
  const paymentDue = parsed.dueDate ?? "[검토 필요: 지급기한]";
  const amount = formatKRW(parsed.amount);

  const body = [
    `1. 당사자\n발주자 ${parsed.clientName}와 수행자 ${parsed.freelancerName}는 아래 용역 수행을 위해 본 초안을 작성합니다. [검토 필요: 당사자 식별 정보]`,
    `2. 용역 범위\n수행자는 다음 업무를 제공합니다: ${parsed.scope}. 구체 산출물, 제외 범위, 전달 형식은 확정 전 별도 확인이 필요합니다. [검토 필요]`,
    `3. 계약 기간\n계약 기간은 ${period}입니다. 일정 변경이 필요한 경우 양 당사자가 서면 또는 기록 가능한 방식으로 확인합니다.`,
    `4. 대금 및 지급\n총 용역대금은 ${amount}이며, 지급기한은 ${paymentDue}입니다. 세금, 원천징수, 부가 비용 포함 여부는 확정 전 확인합니다. [검토 필요]`,
    "5. 검수 및 수정\n발주자는 산출물 수령 후 합리적인 기간 내 검수 의견을 전달하고, 수행자는 합의된 범위 안에서 수정합니다. 수정 횟수와 기준은 확정 전 확인합니다. [검토 필요]",
    "6. 자료 제공 및 협조\n발주자는 업무 수행에 필요한 자료와 피드백을 적시에 제공하고, 지연 시 일정은 조정될 수 있습니다.",
    "7. 비밀유지\n양 당사자는 계약 수행 중 알게 된 비공개 정보를 목적 외로 사용하거나 제3자에게 공개하지 않습니다.",
    "8. 지식재산권\n산출물의 권리 이전 범위와 시점은 대금 지급 및 별도 합의 조건에 따릅니다. 사용 범위는 확정 전 확인합니다. [검토 필요]",
    "9. 해지\n중대한 계약 위반 또는 업무 지속이 어려운 사유가 발생한 경우 상대방에게 통지하고 계약을 해지할 수 있습니다. 이미 수행된 업무의 정산 기준은 별도 확인합니다. [검토 필요]",
    "10. 분쟁 해결\n분쟁이 발생하면 우선 협의로 해결하고, 합의되지 않는 사항은 관련 법령과 관할 기준에 따릅니다. 본 문서는 초안이며 법적 자문이 아닙니다.",
  ].join("\n\n");

  return {
    title,
    body,
    plain_summary:
      "범용 용역계약서 골격으로 생성된 초안입니다. 범위, 금액, 지급기한, 권리 이전, 해지 조건은 전문가 검토를 권장합니다.",
    needs_review: true,
    source: "skeleton",
  };
}

export async function generateContractDraft(
  input: ContractDraftInput,
  options: GenerateContractDraftOptions = {},
): Promise<ContractDraft> {
  const skeleton = buildSkeletonContractDraft(input);
  const retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const maxAttempts = Math.max(1, retryCount + 1);

  let client: AnthropicMessagesClient;
  try {
    client = options.client ?? createAnthropicClient();
  } catch {
    return skeleton;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await client.messages.create(buildClaudeRequest(input, skeleton));
      const aiDraft = parseClaudeDraft(response);

      if (aiDraft) {
        return {
          ...aiDraft,
          needs_review:
            aiDraft.needs_review ||
            aiDraft.body.includes("[검토 필요]") ||
            aiDraft.plain_summary.includes("[검토 필요]"),
          source: "ai",
        };
      }
    } catch {
      // Claude is an enhancement, not a gate. Exhaust retries, then return skeleton.
    }

    if (attempt < maxAttempts) {
      await sleep(backoffMs * attempt);
    }
  }

  return skeleton;
}

function createAnthropicClient(): AnthropicMessagesClient {
  if (typeof window !== "undefined") {
    throw new Error("Contract draft generation is only available on the server.");
  }

  const env = getServerEnv();
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  return {
    messages: {
      create: (params) => anthropic.messages.create(params as never),
    },
  };
}

function buildClaudeRequest(input: ContractDraftInput, skeleton: ContractDraft) {
  return {
    model: ANTHROPIC_CONTRACT_MODEL,
    max_tokens: 1800,
    thinking: { type: "disabled" },
    system: [
      "You refine Korean freelance service contract drafts for FreeSign.",
      "The contract skeleton and required clauses are owned by application code.",
      "Do not invent statutes, legal articles, case law, or authoritative legal claims.",
      "If any detail is unclear, mark it with [검토 필요] and set needs_review=true.",
      "The output is always a non-authoritative draft and must not execute any action.",
      "Do not delete, replace, or reorder required skeleton clauses; only refine wording and write a plain-language summary.",
    ].join("\n"),
    tools: [
      {
        name: CONTRACT_DRAFT_TOOL_NAME,
        description:
          "Return the refined non-authoritative Korean contract draft while preserving the code-owned skeleton clauses.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            body: { type: "string" },
            plain_summary: { type: "string" },
            needs_review: { type: "boolean" },
          },
          required: ["title", "body", "plain_summary", "needs_review"],
        },
        strict: true,
      },
    ],
    tool_choice: { type: "tool", name: CONTRACT_DRAFT_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                structured_input: input,
                required_clauses: REQUIRED_CONTRACT_CLAUSES,
                skeleton_draft: {
                  title: skeleton.title,
                  body: skeleton.body,
                  plain_summary: skeleton.plain_summary,
                },
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

function formatPeriod(startDate?: string, endDate?: string) {
  if (startDate && endDate) {
    return `${startDate}부터 ${endDate}까지`;
  }

  if (startDate) {
    return `${startDate}부터 [검토 필요: 종료일]까지`;
  }

  if (endDate) {
    return `[검토 필요: 시작일]부터 ${endDate}까지`;
  }

  return "[검토 필요: 시작일]부터 [검토 필요: 종료일]까지";
}

function formatKRW(amount: number) {
  return `₩${new Intl.NumberFormat("ko-KR").format(amount)}`;
}

function sleep(ms: number) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
