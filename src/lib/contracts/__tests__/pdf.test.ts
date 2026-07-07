import { describe, expect, it } from "vitest";

import {
  CONTRACT_PDF_DISCLAIMER,
  mapContractPdfProps,
} from "@/lib/contracts/pdf";

const clauses = [
  {
    title: "용역 범위",
    body: "랜딩 페이지 디자인 및 구현을 수행한다.",
    plain_summary: "랜딩 페이지 작업을 합니다.",
    needs_review: false,
  },
  {
    title: "검수",
    body: "검수 기준은 별도 협의한다.",
    plain_summary: "검수 기준 확인이 필요합니다.",
    needs_review: true,
  },
];

describe("mapContractPdfProps", () => {
  it("maps a contract row into a Korean PDF document model", () => {
    const document = mapContractPdfProps({
      contract: {
        id: "contract-1",
        title: "웹사이트 제작 계약서",
        scope: "기업 웹사이트 제작",
        amount: 1500000,
        start_date: "2026-07-01",
        end_date: "2026-07-31",
        status: "signed",
        clauses,
        doc_hash: "abc123",
        signature_meta: {
          signer: "freelancer@example.test",
          signed_at: "2026-07-07T03:00:00.000Z",
          ip: "203.0.113.10",
          ua: "Vitest",
        },
      },
      clientName: "테스트 클라이언트",
      signatureImageDataUri: "data:image/png;base64,abc",
    });

    expect(document.title).toBe("웹사이트 제작 계약서");
    expect(document.clientName).toBe("테스트 클라이언트");
    expect(document.amountLabel).toBe("₩1,500,000");
    expect(document.periodLabel).toBe("2026.07.01 - 2026.07.31");
    expect(document.docHash).toBe("abc123");
    expect(document.signature?.signer).toBe("freelancer@example.test");
    expect(document.signatureImageDataUri).toBe("data:image/png;base64,abc");
    expect(document.clauses).toHaveLength(2);
    expect(document.clauses[1]).toMatchObject({
      needsReview: true,
      plainSummary: "검수 기준 확인이 필요합니다.",
    });
    expect(document.disclaimer).toBe(CONTRACT_PDF_DISCLAIMER);
  });

  it("uses safe fallbacks for missing clauses and hash", () => {
    const document = mapContractPdfProps({
      contract: {
        id: "contract-1",
        title: "초안 계약서",
        scope: "업무 범위",
        amount: 1000,
        start_date: "bad-date",
        end_date: "2026-07-31",
        status: "draft",
        clauses: null,
        doc_hash: null,
        signature_meta: null,
      },
      clientName: null,
      signatureImageDataUri: null,
    });

    expect(document.clientName).toBe("클라이언트 없음");
    expect(document.periodLabel).toBe("bad-date - 2026.07.31");
    expect(document.docHash).toBe("서명 전 문서 해시 없음");
    expect(document.signature).toBeNull();
    expect(document.signatureImageDataUri).toBeNull();
    expect(document.clauses).toEqual([]);
  });
});
