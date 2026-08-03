// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  REDACTED_SIGN_PATH,
  sanitizeAnalyticsEvent,
  sanitizeAnalyticsProperties,
} from "@/lib/analytics-sanitize";

describe("sanitizeAnalyticsProperties", () => {
  it("서명 토큰이 든 URL 속성에서 토큰을 제거한다", () => {
    const props = sanitizeAnalyticsProperties({
      $current_url: "https://freesign.vercel.app/sign/9f8a7b6c5d4e3f2a1b0c",
      $pathname: "/sign/9f8a7b6c5d4e3f2a1b0c",
    });

    expect(props.$current_url).toBe(`https://freesign.vercel.app${REDACTED_SIGN_PATH}`);
    expect(props.$pathname).toBe(REDACTED_SIGN_PATH);
  });

  it("쿼리·프래그먼트·하위 경로가 붙어도 토큰만 지운다", () => {
    const props = sanitizeAnalyticsProperties({
      $current_url: "https://freesign.vercel.app/sign/tok_abc?utm_source=email#top",
      $referrer: "https://freesign.vercel.app/sign/tok_abc/certificate",
    });

    expect(props.$current_url).toBe(
      `https://freesign.vercel.app${REDACTED_SIGN_PATH}?utm_source=email#top`,
    );
    expect(props.$referrer).toBe(`https://freesign.vercel.app${REDACTED_SIGN_PATH}/certificate`);
  });

  it("속성 이름을 열거하지 않고 모든 문자열 값을 훑는다", () => {
    const props = sanitizeAnalyticsProperties({
      $initial_current_url: "https://freesign.vercel.app/sign/tok_abc",
      custom_link: "메일 링크: https://freesign.vercel.app/sign/tok_abc 확인",
    });

    expect(props.$initial_current_url).toBe(`https://freesign.vercel.app${REDACTED_SIGN_PATH}`);
    expect(props.custom_link).toBe(
      `메일 링크: https://freesign.vercel.app${REDACTED_SIGN_PATH} 확인`,
    );
  });

  it("서명 경로가 아닌 값과 비문자열 값은 그대로 둔다", () => {
    const props = sanitizeAnalyticsProperties({
      $current_url: "https://freesign.vercel.app/contracts/abc-123",
      $screen_height: 1080,
      $feature_flags: ["a", "b"],
      nothing: null,
    });

    expect(props.$current_url).toBe("https://freesign.vercel.app/contracts/abc-123");
    expect(props.$screen_height).toBe(1080);
    expect(props.$feature_flags).toEqual(["a", "b"]);
    expect(props.nothing).toBeNull();
  });
});

describe("sanitizeAnalyticsEvent", () => {
  it("properties·$set·$set_once의 토큰을 모두 지운다", () => {
    const event = sanitizeAnalyticsEvent({
      uuid: "u-1",
      event: "$pageview",
      properties: { $current_url: "https://freesign.vercel.app/sign/tok_abc" },
      $set: { $current_url: "https://freesign.vercel.app/sign/tok_abc" },
      $set_once: { $initial_current_url: "https://freesign.vercel.app/sign/tok_abc" },
    });

    const redacted = `https://freesign.vercel.app${REDACTED_SIGN_PATH}`;
    expect(event?.properties.$current_url).toBe(redacted);
    expect(event?.$set?.$current_url).toBe(redacted);
    expect(event?.$set_once?.$initial_current_url).toBe(redacted);
  });

  it("$set·$set_once가 없으면 만들지 않는다", () => {
    const event = sanitizeAnalyticsEvent({
      uuid: "u-2",
      event: "$pageview",
      properties: {},
    });

    expect(event).not.toHaveProperty("$set");
    expect(event).not.toHaveProperty("$set_once");
  });

  it("앞선 before_send가 드롭한 이벤트(null)는 그대로 흘린다", () => {
    expect(sanitizeAnalyticsEvent(null)).toBeNull();
  });
});
