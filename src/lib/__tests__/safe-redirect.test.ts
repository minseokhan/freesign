import { getSafeRedirectPath } from "@/lib/safe-redirect";

const ORIGIN = "https://app.example.com";

describe("getSafeRedirectPath", () => {
  it("정상 내부 경로는 그대로 통과시킨다", () => {
    expect(getSafeRedirectPath("/contracts", ORIGIN)).toBe("/contracts");
  });

  it("내부 경로의 query·hash를 보존한다", () => {
    expect(getSafeRedirectPath("/contracts?tab=paid#top", ORIGIN)).toBe(
      "/contracts?tab=paid#top",
    );
  });

  it("next가 없거나 빈 문자열이면 fallback으로 돌린다", () => {
    expect(getSafeRedirectPath(null, ORIGIN)).toBe("/dashboard");
    expect(getSafeRedirectPath(undefined, ORIGIN)).toBe("/dashboard");
    expect(getSafeRedirectPath("", ORIGIN)).toBe("/dashboard");
  });

  it("백슬래시 우회(/\\evil.com)를 차단한다 — 보고된 취약점", () => {
    expect(getSafeRedirectPath("/\\evil.com", ORIGIN)).toBe("/dashboard");
  });

  it("프로토콜-상대(//evil.com) 오픈 리다이렉트를 차단한다", () => {
    expect(getSafeRedirectPath("//evil.com", ORIGIN)).toBe("/dashboard");
  });

  it("탭 우회(/\\t/evil.com)를 차단한다", () => {
    expect(getSafeRedirectPath("/\t/evil.com", ORIGIN)).toBe("/dashboard");
  });

  it("절대 외부 URL을 차단한다", () => {
    expect(getSafeRedirectPath("https://evil.com/phish", ORIGIN)).toBe(
      "/dashboard",
    );
  });

  it("사용자 지정 fallback을 존중한다", () => {
    expect(getSafeRedirectPath("//evil.com", ORIGIN, "/login")).toBe("/login");
  });
});
