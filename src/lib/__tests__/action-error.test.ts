import { dbError, GENERIC_ACTION_ERROR } from "@/lib/action-error";

describe("dbError", () => {
  it("항상 고정 메시지를 반환하고 내부 DB 에러 메시지를 노출하지 않는다", () => {
    const result = dbError({
      message:
        'duplicate key value violates unique constraint "invoices_pkey"',
    });

    expect(result).toEqual({ ok: false, error: GENERIC_ACTION_ERROR });
    expect(result.error).not.toContain("invoices_pkey");
    expect(result.error).not.toContain("constraint");
  });

  it("null·undefined 입력도 안전하게 처리한다", () => {
    expect(dbError(null)).toEqual({ ok: false, error: GENERIC_ACTION_ERROR });
    expect(dbError(undefined)).toEqual({
      ok: false,
      error: GENERIC_ACTION_ERROR,
    });
  });

  it("내부 에러 메시지는 서버 로그로만 남긴다", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    dbError({ message: "secret internal detail" });

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("[action]"),
      "secret internal detail",
    );
    spy.mockRestore();
  });
});
