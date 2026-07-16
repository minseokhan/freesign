import { beforeEach, describe, expect, it, vi } from "vitest";

const captureServerException = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/posthog-server", () => ({
  captureServerException: (...args: unknown[]) =>
    captureServerException(...args),
}));

import { contractClausesSchema } from "@/lib/validation/contract";
import {
  ANTHROPIC_CONTRACT_MODEL,
  REQUIRED_CONTRACT_CLAUSES,
} from "@/services/ai/contract-draft";
import {
  extractContractFromPdf,
  type AnthropicMessagesClient,
} from "@/services/ai/contract-import";

function createMockClient(input: unknown): AnthropicMessagesClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: "tool_use",
            name: "return_imported_contract",
            input,
          },
        ],
      }),
    },
  };
}

describe("extractContractFromPdf", () => {
  beforeEach(() => {
    captureServerException.mockClear();
  });

  it("폴백 시 마지막 에러를 PostHog로 캡처한다", async () => {
    const failingClient: AnthropicMessagesClient = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error("overloaded")),
      },
    };

    const extracted = await extractContractFromPdf("base64-pdf", {
      client: failingClient,
      retryCount: 0,
      backoffMs: 0,
    });

    expect(extracted.source).toBe("fallback");
    expect(captureServerException).toHaveBeenCalledTimes(1);
    const [captured, , properties] = captureServerException.mock.calls[0];
    expect((captured as Error).message).toBe("overloaded");
    expect(properties).toEqual({ feature: "ai_contract_import" });
  });

  it("returns normalized AI extraction when Claude returns valid tool input", async () => {
    const rawClauses = REQUIRED_CONTRACT_CLAUSES.map((title) => ({
      title,
      body: `${title} 본문입니다.`,
      plain_summary: `${title} 요약입니다.`,
      needs_review: false,
    }));
    const client = createMockClient({
      title: "브랜드 리뉴얼 계약서",
      scope: "브랜드 리뉴얼과 랜딩 페이지 제작",
      amount: 3_000_000,
      start_date: "2026-08-01",
      end_date: "2026-08-31",
      plain_summary: "브랜드 리뉴얼과 랜딩 페이지 제작 계약입니다.",
      clauses: rawClauses,
    });

    const extracted = await extractContractFromPdf("base64-pdf", {
      client,
      retryCount: 0,
    });

    expect(extracted).toEqual({
      title: "브랜드 리뉴얼 계약서",
      scope: "브랜드 리뉴얼과 랜딩 페이지 제작",
      amount: 3_000_000,
      start_date: "2026-08-01",
      end_date: "2026-08-31",
      plain_summary: "브랜드 리뉴얼과 랜딩 페이지 제작 계약입니다.",
      clauses: rawClauses,
      source: "ai",
    });
    expect(() => contractClausesSchema.parse(extracted.clauses)).not.toThrow();
    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: ANTHROPIC_CONTRACT_MODEL,
        tool_choice: { type: "tool", name: "return_imported_contract" },
      }),
    );
    expect(vi.mocked(client.messages.create).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: expect.arrayContaining([
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: "base64-pdf",
                },
              },
            ]),
          }),
        ],
      }),
    );
  });

  it("falls back without throwing when Claude throws", async () => {
    const client: AnthropicMessagesClient = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error("timeout")),
      },
    };

    const extracted = await extractContractFromPdf("base64-pdf", {
      client,
      retryCount: 1,
      backoffMs: 0,
    });

    expect(extracted.source).toBe("fallback");
    expect(extracted.title).toBeNull();
    expect(extracted.scope).toBeNull();
    expect(extracted.amount).toBeNull();
    expect(extracted.plain_summary).toBeNull();
    expect(extracted.clauses).toHaveLength(REQUIRED_CONTRACT_CLAUSES.length);
    expect(extracted.clauses.every((clause) => clause.needs_review)).toBe(true);
    expect(() => contractClausesSchema.parse(extracted.clauses)).not.toThrow();
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it("coerces a blank contract-level plain_summary to null", async () => {
    const rawClauses = REQUIRED_CONTRACT_CLAUSES.map((title) => ({
      title,
      body: `${title} 본문입니다.`,
      plain_summary: `${title} 요약입니다.`,
      needs_review: false,
    }));
    const client = createMockClient({
      title: "요약 없는 계약서",
      scope: "업무 범위",
      amount: 1_000_000,
      start_date: "2026-08-01",
      end_date: "2026-08-31",
      plain_summary: "   ",
      clauses: rawClauses,
    });

    const extracted = await extractContractFromPdf("base64-pdf", {
      client,
      retryCount: 0,
    });

    expect(extracted.source).toBe("ai");
    expect(extracted.plain_summary).toBeNull();
  });

  it("falls back without throwing when Claude returns invalid tool input", async () => {
    const client = createMockClient({
      title: "금액 타입이 잘못된 응답",
      scope: "업무 범위",
      amount: "300만원",
      start_date: "2026-08-01",
      end_date: "2026-08-31",
      clauses: [],
    });

    const extracted = await extractContractFromPdf("base64-pdf", {
      client,
      retryCount: 0,
    });

    expect(extracted.source).toBe("fallback");
    expect(extracted.clauses).toHaveLength(REQUIRED_CONTRACT_CLAUSES.length);
    expect(extracted.clauses.every((clause) => clause.needs_review)).toBe(true);
    expect(() => contractClausesSchema.parse(extracted.clauses)).not.toThrow();
  });
});
