import { describe, expect, it } from "vitest";

import {
  parseContractSnapshot,
  resolveContractLabel,
} from "@/lib/contract-snapshot";

describe("parseContractSnapshot", () => {
  it("parses a well-formed snapshot", () => {
    expect(
      parseContractSnapshot({
        title: "블루스튜디오 계약",
        amount: 3_000_000,
        start_date: "2026-08-01",
        end_date: "2026-08-31",
      }),
    ).toEqual({
      title: "블루스튜디오 계약",
      amount: 3_000_000,
      start_date: "2026-08-01",
      end_date: "2026-08-31",
    });
  });

  it("returns null for missing, non-object, or array values", () => {
    expect(parseContractSnapshot(null)).toBeNull();
    expect(parseContractSnapshot("계약")).toBeNull();
    expect(parseContractSnapshot([{ title: "x" }])).toBeNull();
  });

  it("returns null when the title is not a string", () => {
    expect(parseContractSnapshot({ amount: 100 })).toBeNull();
  });

  it("defaults non-string dates and non-number amount", () => {
    expect(parseContractSnapshot({ title: "제목만" })).toEqual({
      title: "제목만",
      amount: 0,
      start_date: "",
      end_date: "",
    });
  });
});

describe("resolveContractLabel", () => {
  it("uses the live contract title when the contract still exists", () => {
    expect(
      resolveContractLabel({ title: "살아있는 계약" }, { title: "옛 스냅샷" }),
    ).toBe("살아있는 계약");
  });

  it("falls back to the snapshot title with a deleted prefix", () => {
    expect(
      resolveContractLabel(null, {
        title: "삭제된 계약 제목",
        amount: 1_000_000,
        start_date: "2026-08-01",
        end_date: "2026-08-31",
      }),
    ).toBe("삭제된 계약: 삭제된 계약 제목");
  });

  it("falls back to a generic label when neither contract nor snapshot exists", () => {
    expect(resolveContractLabel(null, null)).toBe("계약 없음");
  });
});
