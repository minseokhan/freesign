import { describe, expect, it } from "vitest";

import OpengraphImage, { alt, contentType, size } from "../opengraph-image";

describe("opengraph-image", () => {
  it("OG 표준 크기(1200×630)와 PNG 타입을 선언한다", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(alt).toContain("FreeSign");
  });

  it("이미지 응답을 생성한다", async () => {
    const response = await OpengraphImage();

    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("content-type")).toContain("image/png");
  });
});
