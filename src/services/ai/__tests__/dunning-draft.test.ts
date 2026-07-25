import { describe, expect, it, vi } from "vitest";

import {
  buildDunningFallback,
  generateDunningDraft,
  type DunningDraftInput,
  type AnthropicMessagesClient,
} from "../dunning-draft";

const input: DunningDraftInput = {
  clientName: "ACME 주식회사",
  contractTitle: "웹사이트 유지보수 계약",
  amountNet: 1_000_000,
  dueDate: "2026-07-01",
  daysOverdue: 24,
  freelancerName: "김프리",
};

describe("buildDunningFallback", () => {
  it("정중한 한국어 폴백 초안을 만든다(고객명·계약·금액·연체일 포함)", () => {
    const draft = buildDunningFallback(input);
    expect(draft.source).toBe("fallback");
    expect(draft.subject.length).toBeGreaterThan(0);
    expect(draft.body).toContain("ACME 주식회사");
    expect(draft.body).toContain("웹사이트 유지보수 계약");
    expect(draft.body).toContain("김프리");
  });
});

describe("generateDunningDraft", () => {
  function clientReturning(input: unknown): AnthropicMessagesClient {
    return {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: "tool_use",
              name: "return_dunning_draft",
              input,
            },
          ],
        }),
      },
    };
  }

  it("tool_use 응답을 파싱해 AI 초안을 반환한다", async () => {
    const client = clientReturning({
      subject: "[안내] 대금 지급 요청",
      body: "안녕하세요, ACME 주식회사님. 웹사이트 유지보수 계약 대금 안내드립니다.",
    });

    const draft = await generateDunningDraft(input, { client, retryCount: 0 });
    expect(draft.source).toBe("ai");
    expect(draft.subject).toBe("[안내] 대금 지급 요청");
  });

  it("스키마 불일치 응답이면 폴백으로 떨어진다", async () => {
    const client = clientReturning({ subject: "" });
    const draft = await generateDunningDraft(input, { client, retryCount: 0 });
    expect(draft.source).toBe("fallback");
  });

  it("클라이언트 생성 예외 시 폴백", async () => {
    const client: AnthropicMessagesClient = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error("api down")),
      },
    };
    const draft = await generateDunningDraft(input, { client, retryCount: 0 });
    expect(draft.source).toBe("fallback");
  });
});
