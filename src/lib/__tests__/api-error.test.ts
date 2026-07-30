import { describe, expect, it } from "vitest";

import { GENERIC_ACTION_ERROR } from "@/lib/action-error";
import { GENERIC_API_ERROR } from "@/lib/api-error";

// #45: 라우트 핸들러가 Postgres/RPC 원본 메시지(제약조건·컬럼명·RLS 힌트)를 그대로
// 돌려주면 인증만 하면 내부 스키마를 열거할 수 있다. Server Action의 dbError와
// 같은 정책(고정 문구 + 서버 로그·에러 트래킹)을 쓴다.
describe("GENERIC_API_ERROR", () => {
  it("Server Action의 일반 오류 문구와 같은 정책을 쓴다", () => {
    expect(GENERIC_API_ERROR).toBe(GENERIC_ACTION_ERROR);
  });

  it("내부 구조를 드러내는 단어를 담지 않는다", () => {
    expect(GENERIC_API_ERROR).not.toMatch(/row-level|policy|constraint|relation/i);
  });
});
