// server-only: this module creates Claude clients from server env and must not be imported by client components.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { normalizeImportedClauses } from "@/lib/contracts/draft";
import { getAnthropicEnv } from "@/lib/env";
import { captureServerException } from "@/lib/posthog-server";
import type { ContractClauseInput } from "@/lib/validation/contract";
import {
  ANTHROPIC_CONTRACT_MODEL,
  REQUIRED_CONTRACT_CLAUSES,
} from "@/services/ai/contract-draft";

const CONTRACT_IMPORT_TOOL_NAME = "return_imported_contract";
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_BACKOFF_MS = 150;

export interface ImportedContractExtract {
  title: string | null;
  scope: string | null;
  amount: number | null;
  start_date: string | null;
  end_date: string | null;
  // 계약 전체 평문요약. 상단에 1회만 노출한다(조항별 요약은 생략).
  plain_summary: string | null;
  clauses: ContractClauseInput[];
  source: "ai" | "fallback";
}

export interface AnthropicMessagesClient {
  messages: {
    create: (params: unknown) => Promise<unknown>;
  };
}

interface ExtractContractFromPdfOptions {
  client?: AnthropicMessagesClient;
  retryCount?: number;
  backoffMs?: number;
}

const nullableTextSchema = z.string().trim().min(1).nullable();

const importedClauseSchema = z.object({
  title: z.string().trim().min(1),
  body: z.string(),
  plain_summary: z.string(),
  needs_review: z.boolean(),
});

const importedContractSchema = z.object({
  title: nullableTextSchema,
  scope: nullableTextSchema,
  amount: z.number().int().positive().nullable(),
  start_date: nullableTextSchema,
  end_date: nullableTextSchema,
  // 빈 문자열도 허용해 파싱 실패를 막고, 정규화 단계에서 null로 접는다.
  plain_summary: z.string().nullable(),
  clauses: z.array(importedClauseSchema),
});

const toolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  name: z.literal(CONTRACT_IMPORT_TOOL_NAME),
  input: z.unknown(),
});

const messageResponseSchema = z.object({
  content: z.array(z.unknown()),
});

export async function extractContractFromPdf(
  base64Pdf: string,
  options: ExtractContractFromPdfOptions = {},
): Promise<ImportedContractExtract> {
  const fallback = buildFallbackImportedContractExtract();
  const retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const maxAttempts = Math.max(1, retryCount + 1);

  let client: AnthropicMessagesClient;
  try {
    client = options.client ?? createAnthropicClient();
  } catch (error) {
    await captureServerException(error, undefined, {
      feature: "ai_contract_import",
    });
    return fallback;
  }

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await client.messages.create(buildClaudeRequest(base64Pdf));
      const parsed = parseClaudeImport(response);

      if (parsed) {
        return {
          ...parsed,
          plain_summary: parsed.plain_summary?.trim() || null,
          clauses: normalizeImportedClauses(parsed.clauses),
          source: "ai",
        };
      }
    } catch (error) {
      // Claude is an enhancement, not a gate. Exhaust retries, then return fallback.
      lastError = error;
    }

    if (attempt < maxAttempts) {
      await sleep(backoffMs * attempt);
    }
  }

  // 폴백은 조용히 넘어가지 않고 에러 트래킹에 남긴다(키 누락·API 장애 조기 발견).
  await captureServerException(
    lastError ?? new Error("Claude PDF 추출 응답이 스키마와 불일치해 폴백"),
    undefined,
    { feature: "ai_contract_import" },
  );

  return fallback;
}

function buildFallbackImportedContractExtract(): ImportedContractExtract {
  return {
    title: null,
    scope: null,
    amount: null,
    start_date: null,
    end_date: null,
    plain_summary: null,
    clauses: normalizeImportedClauses([]),
    source: "fallback",
  };
}

function createAnthropicClient(): AnthropicMessagesClient {
  if (typeof window !== "undefined") {
    throw new Error("Contract PDF import is only available on the server.");
  }

  const env = getAnthropicEnv();
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  return {
    messages: {
      create: (params) => anthropic.messages.create(params as never),
    },
  };
}

function buildClaudeRequest(base64Pdf: string) {
  return {
    model: ANTHROPIC_CONTRACT_MODEL,
    // 다페이지 표준계약서는 10개 조항(본문+요약) 출력이 3000 토큰을 넘어 잘리며,
    // 잘린 tool JSON은 파싱 실패 → 폴백(빈 결과)으로 떨어진다. 넉넉한 상한을 둔다.
    max_tokens: 8000,
    thinking: { type: "disabled" },
    system: [
      "You extract non-authoritative structured data from Korean freelance service contract PDFs for Maedeup.",
      "Write every generated text field (plain_summary and any [검토 필요] notes) in natural Korean; do not leak English words or transliterations into the output.",
      "Do not invent statutes, legal articles, case law, facts, dates, amounts, parties, or authoritative legal claims.",
      "If a value is not actually present in the PDF, return null for title, scope, amount, start_date, and end_date.",
      "If a required clause is unclear or absent, use [검토 필요] for body and plain_summary and set needs_review=true.",
      "The output is always a review aid, not legal advice or a final contract.",
    ].join("\n"),
    tools: [
      {
        name: CONTRACT_IMPORT_TOOL_NAME,
        description:
          "Return structured, non-authoritative contract fields extracted from an uploaded PDF for human review.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: ["string", "null"] },
            scope: { type: ["string", "null"] },
            amount: { type: ["number", "null"] },
            start_date: { type: ["string", "null"] },
            end_date: { type: ["string", "null"] },
            plain_summary: { type: ["string", "null"] },
            clauses: {
              type: "array",
              items: {
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
            },
          },
          required: [
            "title",
            "scope",
            "amount",
            "start_date",
            "end_date",
            "plain_summary",
            "clauses",
          ],
        },
        strict: true,
      },
    ],
    tool_choice: { type: "tool", name: CONTRACT_IMPORT_TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64Pdf,
            },
          },
          {
            type: "text",
            text: JSON.stringify(
              {
                task: "Extract title, scope, amount, start/end dates, a whole-contract plain_summary, and map clauses into the required Maedeup clause categories.",
                required_clauses: REQUIRED_CONTRACT_CLAUSES,
                rules: [
                  "Return null for any missing title, scope, amount, start_date, or end_date.",
                  "Return dates as YYYY-MM-DD only if the PDF provides enough information.",
                  "Write plain_summary as 2-3 natural Korean sentences summarizing the whole contract for a freelancer; return null if the PDF has too little to summarize.",
                  "For each clause, use one of the required_clauses titles exactly.",
                  "Mark needs_review=true when the PDF text is ambiguous, missing, or needs human confirmation.",
                ],
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

function parseClaudeImport(response: unknown) {
  const parsedResponse = messageResponseSchema.safeParse(response);

  if (!parsedResponse.success) {
    return null;
  }

  for (const block of parsedResponse.data.content) {
    const toolUse = toolUseBlockSchema.safeParse(block);

    if (!toolUse.success) {
      continue;
    }

    const extracted = importedContractSchema.safeParse(toolUse.data.input);
    return extracted.success ? extracted.data : null;
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
