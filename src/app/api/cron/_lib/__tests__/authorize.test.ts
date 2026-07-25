import { describe, expect, it } from "vitest";

import { authorizeCron } from "../authorize";

function reqWith(header: string | null): Request {
  return new Request("https://freesign.example/api/cron/daily", {
    headers: header === null ? {} : { authorization: header },
  });
}

describe("authorizeCron", () => {
  const secret = "cron-secret-value";

  it("Bearer 시크릿이 일치하면 통과한다", () => {
    expect(authorizeCron(reqWith(`Bearer ${secret}`), secret)).toBe(true);
  });

  it("Authorization 헤더가 없으면 거부한다", () => {
    expect(authorizeCron(reqWith(null), secret)).toBe(false);
  });

  it("Bearer 접두사가 없으면 거부한다", () => {
    expect(authorizeCron(reqWith(secret), secret)).toBe(false);
  });

  it("시크릿이 불일치하면 거부한다", () => {
    expect(authorizeCron(reqWith("Bearer wrong"), secret)).toBe(false);
  });

  it("기대 시크릿이 빈 값이면 거부한다(fail-closed)", () => {
    expect(authorizeCron(reqWith("Bearer "), "")).toBe(false);
    expect(authorizeCron(reqWith("Bearer anything"), "")).toBe(false);
  });
});
