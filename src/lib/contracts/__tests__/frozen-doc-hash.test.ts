import { createV1SignatureProvider } from "@/services/signature/provider";

import { isFrozenDocHashIntact } from "../frozen-doc-hash";

// 발송 RPC(send_signature_request_with_event)는 doc_hash를 파라미터로 받는다.
// Server Action은 서버에서 계산하지만 RPC 자체가 authenticated에 열려 있어,
// PostgREST 직접 호출로 "본문과 무관한 지문"을 동결할 수 있다.
// 상대방이 서명하기 전 이 함수가 걸러 위조된 지문이 증거로 굳지 않게 한다.
describe("isFrozenDocHashIntact", () => {
  const clauses = [
    { title: "당사자", body: "발주자와 수행자는…", source: "ai", needs_review: true },
    { title: "대금 및 지급", body: "총 용역대금은 3,000,000원", source: "ai", needs_review: true },
  ];

  const validHash = createV1SignatureProvider().computeDocHash(clauses);

  // 실제 경로는 PostgREST → JSON 직렬화 → 파싱이므로 그 왕복을 재현한다.
  function asJsonRoundTrip(value: unknown) {
    return JSON.parse(JSON.stringify(value));
  }

  it("발송 시점 지문이 본문과 일치하면 통과시킨다", () => {
    expect(isFrozenDocHashIntact(asJsonRoundTrip(clauses), validHash)).toBe(true);
  });

  it("JSON 왕복으로 키 순서가 뒤바뀌어도 통과시킨다", () => {
    const reordered = clauses.map((clause) => ({
      needs_review: clause.needs_review,
      body: clause.body,
      source: clause.source,
      title: clause.title,
    }));

    expect(isFrozenDocHashIntact(asJsonRoundTrip(reordered), validHash)).toBe(true);
  });

  it("본문과 무관한 지문을 거부한다", () => {
    const forged = createV1SignatureProvider().computeDocHash([
      { title: "대금 및 지급", body: "총 용역대금은 30,000,000원" },
    ]);

    expect(isFrozenDocHashIntact(asJsonRoundTrip(clauses), forged)).toBe(false);
  });

  it("본문이 바뀌면 거부한다", () => {
    const tampered = [{ ...clauses[0] }, { ...clauses[1], body: "총 용역대금은 300원" }];

    expect(isFrozenDocHashIntact(asJsonRoundTrip(tampered), validHash)).toBe(false);
  });

  it("지문이 비어 있으면 거부한다(fail-closed)", () => {
    expect(isFrozenDocHashIntact(asJsonRoundTrip(clauses), null)).toBe(false);
    expect(isFrozenDocHashIntact(asJsonRoundTrip(clauses), undefined)).toBe(false);
    expect(isFrozenDocHashIntact(asJsonRoundTrip(clauses), "")).toBe(false);
  });

  it("조항이 배열이 아니면 거부한다(fail-closed)", () => {
    expect(isFrozenDocHashIntact(null, validHash)).toBe(false);
    expect(isFrozenDocHashIntact({ title: "당사자" }, validHash)).toBe(false);
    expect(isFrozenDocHashIntact(undefined, validHash)).toBe(false);
  });
});
