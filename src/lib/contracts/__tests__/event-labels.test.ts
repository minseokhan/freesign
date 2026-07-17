import { describe, expect, it } from "vitest";

import {
  contractEventLabel,
  formatContractEventActor,
} from "@/lib/contracts/event-labels";

describe("contractEventLabel", () => {
  it("maps signature v2 event types to Korean labels", () => {
    expect(contractEventLabel("signature_request.sent")).toBe("서명 요청 발송");
    expect(contractEventLabel("signature_request.viewed")).toBe("상대방 열람");
    expect(contractEventLabel("signature_request.revoked")).toBe("서명 요청 철회");
    expect(contractEventLabel("contract.counterparty_signed")).toBe(
      "상대방 서명(완결)",
    );
  });

  it("keeps existing v1 labels and falls back to the raw type", () => {
    expect(contractEventLabel("signed")).toBe("간이 서명 완료");
    expect(contractEventLabel("contract.status_changed")).toBe("계약 상태 변경");
    expect(contractEventLabel("contract.imported")).toBe(
      "기존 계약 불러오기(성사)",
    );
    expect(contractEventLabel("unknown.event")).toBe("unknown.event");
  });
});

describe("formatContractEventActor", () => {
  it("labels counterparty actors with their email", () => {
    expect(formatContractEventActor("counterparty:kim@example.test")).toBe(
      "상대방(kim@example.test)",
    );
  });

  it("labels owner uuid actors as the owner", () => {
    expect(
      formatContractEventActor("e494ff4b-e114-4534-982f-f15302c73bbc"),
    ).toBe("소유자");
  });

  it("passes through other actors unchanged", () => {
    expect(formatContractEventActor("system")).toBe("system");
  });
});
