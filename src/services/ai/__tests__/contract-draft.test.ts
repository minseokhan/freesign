import { beforeEach, describe, expect, it, vi } from "vitest";

const captureServerException = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/posthog-server", () => ({
  captureServerException: (...args: unknown[]) =>
    captureServerException(...args),
}));

import {
  ANTHROPIC_CONTRACT_MODEL,
  buildSkeletonContractDraft,
  generateContractDraft,
  REQUIRED_CONTRACT_CLAUSES,
  type AnthropicMessagesClient,
  type ContractDraftInput,
} from "@/services/ai/contract-draft";

const input: ContractDraftInput = {
  freelancerName: "김프리",
  clientName: "블루스튜디오",
  scope: "브랜드 랜딩 페이지 디자인과 반응형 퍼블리싱",
  amount: 3_000_000,
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  dueDate: "2026-09-10",
};

function createMockClient(result: unknown): AnthropicMessagesClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: "tool_use",
            name: "return_contract_draft",
            input: result,
          },
        ],
      }),
    },
  };
}

describe("buildSkeletonContractDraft", () => {
  it("builds a complete draft from structured input without AI", () => {
    const draft = buildSkeletonContractDraft(input);

    expect(draft.source).toBe("skeleton");
    expect(draft.needs_review).toBe(true);
    expect(draft.title).toBe("블루스튜디오 용역계약서 초안");
    expect(draft.body).toContain("브랜드 랜딩 페이지 디자인과 반응형 퍼블리싱");
    expect(draft.body).toContain("₩3,000,000");
    expect(draft.plain_summary).toContain("초안");

    for (const clause of REQUIRED_CONTRACT_CLAUSES) {
      expect(draft.body).toContain(clause);
    }
  });
});

describe("generateContractDraft", () => {
  beforeEach(() => {
    captureServerException.mockClear();
  });

  it("returns a validated AI draft when Claude returns schema-conformant tool input", async () => {
    const aiResult = {
      title: "블루스튜디오 용역계약서 초안",
      body: REQUIRED_CONTRACT_CLAUSES.map(
        (clause) => `${clause}: 검토된 조항 문구입니다.`,
      ).join("\n\n"),
      plain_summary: "작업 범위와 대금, 일정, 검수, 해지, 비밀유지를 확인하세요.",
      needs_review: false,
    };
    const client = createMockClient(aiResult);

    await expect(
      generateContractDraft(input, { client, retryCount: 0 }),
    ).resolves.toEqual({
      ...aiResult,
      source: "ai",
    });

    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: ANTHROPIC_CONTRACT_MODEL,
        tool_choice: { type: "tool", name: "return_contract_draft" },
      }),
    );
  });

  it("falls back to the skeleton draft when Claude returns invalid schema", async () => {
    const client = createMockClient({
      title: "필드 누락",
      body: "plain_summary와 needs_review가 없습니다.",
    });

    const draft = await generateContractDraft(input, { client, retryCount: 0 });

    expect(draft.source).toBe("skeleton");
    expect(draft.needs_review).toBe(true);
    expect(draft.body).toContain("브랜드 랜딩 페이지 디자인과 반응형 퍼블리싱");
  });

  it("retries transient API errors up to the configured limit and then falls back without throwing", async () => {
    const client: AnthropicMessagesClient = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error("timeout")),
      },
    };

    const draft = await generateContractDraft(input, {
      client,
      retryCount: 2,
      backoffMs: 0,
    });

    expect(draft.source).toBe("skeleton");
    expect(draft.needs_review).toBe(true);
    expect(client.messages.create).toHaveBeenCalledTimes(3);
  });

  it("폴백 시 마지막 에러를 PostHog로 캡처하고, AI 성공 시에는 캡처하지 않는다", async () => {
    const failingClient: AnthropicMessagesClient = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error("timeout")),
      },
    };

    await generateContractDraft(input, {
      client: failingClient,
      retryCount: 0,
      backoffMs: 0,
    });

    expect(captureServerException).toHaveBeenCalledTimes(1);
    const [captured, , properties] = captureServerException.mock.calls[0];
    expect((captured as Error).message).toBe("timeout");
    expect(properties).toEqual({ feature: "ai_contract_draft" });

    captureServerException.mockClear();

    const aiResult = {
      title: "정상 초안",
      body: REQUIRED_CONTRACT_CLAUSES.map(
        (clause) => `${clause}: 정상 문구입니다.`,
      ).join("\n\n"),
      plain_summary: "정상 요약입니다.",
      needs_review: false,
    };

    await generateContractDraft(input, {
      client: createMockClient(aiResult),
      retryCount: 0,
    });

    expect(captureServerException).not.toHaveBeenCalled();
  });

  it("returns AI output after a bounded retry succeeds", async () => {
    const aiResult = {
      title: "재시도 성공 초안",
      body: REQUIRED_CONTRACT_CLAUSES.map(
        (clause) => `${clause}: 재시도 후 생성된 문구입니다.`,
      ).join("\n\n"),
      plain_summary: "재시도 후 검증된 요약입니다.",
      needs_review: true,
    };
    const client: AnthropicMessagesClient = {
      messages: {
        create: vi
          .fn()
          .mockRejectedValueOnce(new Error("temporary"))
          .mockResolvedValueOnce({
            content: [
              {
                type: "tool_use",
                name: "return_contract_draft",
                input: aiResult,
              },
            ],
          }),
      },
    };

    const draft = await generateContractDraft(input, {
      client,
      retryCount: 2,
      backoffMs: 0,
    });

    expect(draft).toEqual({ ...aiResult, source: "ai" });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });
});
