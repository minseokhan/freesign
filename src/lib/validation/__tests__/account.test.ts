import { describe, expect, it } from "vitest";

import {
  ACCOUNT_DELETE_CONFIRM_PHRASE,
  deleteAccountInputSchema,
} from "@/lib/validation/account";

describe("deleteAccountInputSchema", () => {
  it("확인 문구가 정확히 일치할 때만 통과한다", () => {
    expect(
      deleteAccountInputSchema.safeParse({
        confirm: ACCOUNT_DELETE_CONFIRM_PHRASE,
      }).success,
    ).toBe(true);
  });

  it.each([
    ["빈 값", ""],
    ["일부만 입력", "계정 삭제"],
    ["앞뒤 공백", ` ${ACCOUNT_DELETE_CONFIRM_PHRASE} `],
    ["다른 문구", "삭제합니다"],
  ])("%s는 거부한다", (_label, confirm) => {
    expect(deleteAccountInputSchema.safeParse({ confirm }).success).toBe(false);
  });

  it("confirm 외의 필드는 통과 여부에 영향을 주지 않는다", () => {
    const parsed = deleteAccountInputSchema.safeParse({
      confirm: ACCOUNT_DELETE_CONFIRM_PHRASE,
      user_id: "attacker-user",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ confirm: ACCOUNT_DELETE_CONFIRM_PHRASE });
    }
  });
});
