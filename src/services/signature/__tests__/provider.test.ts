import { describe, expect, it } from "vitest";

import {
  createV1SignatureProvider,
  type Clause,
} from "@/services/signature/provider";

describe("V1SignatureProvider.computeDocHash", () => {
  it("returns the same hash for semantically identical clauses with different object key order", () => {
    const provider = createV1SignatureProvider();
    const clauses: Clause[] = [
      {
        heading: "용역 범위",
        body: "랜딩 페이지 디자인과 반응형 퍼블리싱을 제공합니다.",
        plain_summary: "작업 범위를 확인하세요.",
        needs_review: false,
        meta: {
          order: 1,
          tags: ["scope", "delivery"],
        },
      },
    ];
    const reorderedClauses: Clause[] = [
      {
        meta: {
          tags: ["scope", "delivery"],
          order: 1,
        },
        needs_review: false,
        plain_summary: "작업 범위를 확인하세요.",
        body: "랜딩 페이지 디자인과 반응형 퍼블리싱을 제공합니다.",
        heading: "용역 범위",
      },
    ];

    expect(provider.computeDocHash(reorderedClauses)).toBe(
      provider.computeDocHash(clauses),
    );
  });

  it("changes the hash when any clause content changes", () => {
    const provider = createV1SignatureProvider();
    const clauses: Clause[] = [
      {
        heading: "대금 및 지급",
        body: "총 용역대금은 300만원입니다.",
      },
    ];
    const changedClauses: Clause[] = [
      {
        heading: "대금 및 지급",
        body: "총 용역대금은 301만원입니다.",
      },
    ];

    expect(provider.computeDocHash(changedClauses)).not.toBe(
      provider.computeDocHash(clauses),
    );
  });

  it("returns a SHA-256 hex digest", () => {
    const provider = createV1SignatureProvider();

    expect(provider.computeDocHash([{ heading: "당사자", body: "본문" }])).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it("is pure and deterministic across repeated calls", () => {
    const provider = createV1SignatureProvider();
    const clauses: Clause[] = [
      {
        heading: "검수 및 수정",
        body: "합의된 범위 안에서 수정합니다.",
        needs_review: true,
      },
    ];

    const firstHash = provider.computeDocHash(clauses);

    expect(provider.computeDocHash(clauses)).toBe(firstHash);
    expect(provider.computeDocHash(clauses)).toBe(firstHash);
  });
});
