import { parseRateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

describe("parseRateLimitResponse", () => {
  it("allowed=true면 통과시킨다", () => {
    expect(
      parseRateLimitResponse({ allowed: true, remaining: 3 }, null, 60),
    ).toEqual({ allowed: true });
  });

  it("allowed=false면 retry_after와 함께 차단한다", () => {
    expect(
      parseRateLimitResponse({ allowed: false, retry_after: 42 }, null, 60),
    ).toEqual({ allowed: false, retryAfter: 42 });
  });

  it("차단인데 retry_after가 없으면 윈도우 길이로 대체한다", () => {
    expect(parseRateLimitResponse({ allowed: false }, null, 60)).toEqual({
      allowed: false,
      retryAfter: 60,
    });
  });

  it("RPC 에러 시 가용성을 위해 fail-open(통과)하고 로깅한다", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      parseRateLimitResponse(null, { message: "boom" }, 60),
    ).toEqual({ allowed: true });
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });

  it("AI 엔드포인트별 버킷 설정이 정의돼 있다", () => {
    expect(RATE_LIMITS.aiPdfParse.bucket).toBe("ai_pdf_parse");
    expect(RATE_LIMITS.aiDraft.bucket).toBe("ai_draft");
    expect(RATE_LIMITS.aiPdfParse.max).toBeGreaterThan(0);
    expect(RATE_LIMITS.aiPdfParse.windowSeconds).toBeGreaterThan(0);
  });
});
