import { dbError, GENERIC_ACTION_ERROR } from "@/lib/action-error";

const captureServerException = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/posthog-server", () => ({
  captureServerException: (...args: unknown[]) =>
    captureServerException(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dbError", () => {
  it("항상 고정 메시지를 반환하고 내부 DB 에러 메시지를 노출하지 않는다", async () => {
    const result = await dbError({
      message:
        'duplicate key value violates unique constraint "invoices_pkey"',
    });

    expect(result).toEqual({ ok: false, error: GENERIC_ACTION_ERROR });
    expect(result.error).not.toContain("invoices_pkey");
    expect(result.error).not.toContain("constraint");
  });

  it("null·undefined 입력도 안전하게 처리한다", async () => {
    expect(await dbError(null)).toEqual({
      ok: false,
      error: GENERIC_ACTION_ERROR,
    });
    expect(await dbError(undefined)).toEqual({
      ok: false,
      error: GENERIC_ACTION_ERROR,
    });
    expect(captureServerException).not.toHaveBeenCalled();
  });

  it("내부 에러 메시지는 서버 로그로만 남긴다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await dbError({ message: "secret internal detail" });

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[action]"),
      "secret internal detail",
    );
    spy.mockRestore();
  });

  it("에러를 PostHog 에러 트래킹으로 캡처한다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await dbError({ message: "connection refused" });

    expect(captureServerException).toHaveBeenCalledTimes(1);
    const [captured, distinctId, properties] =
      captureServerException.mock.calls[0];
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe("connection refused");
    expect(distinctId).toBeUndefined();
    expect(properties).toEqual({ source: "server_action" });
    spy.mockRestore();
  });
});
