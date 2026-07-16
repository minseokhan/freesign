import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildCertificateProps,
  CERTIFICATE_DISCLAIMER,
  COUNTERPARTY_IDENTITY_LEVEL,
  OWNER_IDENTITY_LEVEL,
} from "@/lib/contracts/certificate";

const DOC_HASH =
  "3f9a1b2c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8";

const contract = {
  id: "contract-1",
  title: "웹사이트 제작 계약서",
  doc_hash: DOC_HASH,
  signature_meta: {
    signer: "owner@example.test",
    signed_at: "2026-07-15T01:00:00.000Z",
    ip: "198.51.100.1",
    ua: "OwnerAgent",
  },
};

const ownerSignature = {
  party: "owner",
  signer_name: "김하나",
  signer_email: "owner@example.test",
  signed_at: "2026-07-15T01:00:00.000Z",
  consent: {
    electronic_signature: true,
    privacy: true,
    consented_at: "2026-07-15T01:00:00.000Z",
  },
  meta: {},
};

const counterpartySignature = {
  party: "counterparty",
  signer_name: "박담당",
  signer_email: "counterparty@example.test",
  signed_at: "2026-07-16T02:00:00.000Z",
  consent: { electronic_signature: true, privacy: true },
  meta: { ip: "203.0.113.10", ua: "CounterpartyAgent" },
};

const request = {
  recipient_email: "counterparty@example.test",
  frozen_doc_hash: DOC_HASH,
  sent_tsa_token: Buffer.from("sent-token-der").toString("base64"),
  completion_tsa_token: null,
  completed_at: "2026-07-16T02:00:00.000Z",
};

const events = [
  {
    actor: "counterparty:counterparty@example.test",
    from_status: "sent",
    to_status: "signed",
    event_type: "contract.counterparty_signed",
    created_at: "2026-07-16T02:00:00.000Z",
  },
  {
    actor: "user-1",
    from_status: "draft",
    to_status: "sent",
    event_type: "signature_request.sent",
    created_at: "2026-07-15T01:00:00.000Z",
  },
  {
    actor: "counterparty:counterparty@example.test",
    from_status: "sent",
    to_status: "sent",
    event_type: "signature_request.viewed",
    created_at: "2026-07-15T09:00:00.000Z",
  },
];

const baseInput = {
  contract,
  signatures: [counterpartySignature, ownerSignature],
  request,
  events,
  generatedAt: "2026-07-17T00:00:00.000Z",
  tsaUrl: "https://freetsa.org/tsr",
};

describe("buildCertificateProps", () => {
  it("counterparty 서명이 없으면 null을 반환한다(미완결)", () => {
    expect(
      buildCertificateProps({ ...baseInput, signatures: [ownerSignature] }),
    ).toBeNull();
    expect(buildCertificateProps({ ...baseInput, signatures: [] })).toBeNull();
  });

  it("doc_hash 전문과 계약 메타를 담는다", () => {
    const props = buildCertificateProps(baseInput);

    expect(props).not.toBeNull();
    expect(props?.docHash).toBe(DOC_HASH);
    expect(props?.contractTitle).toBe("웹사이트 제작 계약서");
    expect(props?.contractId).toBe("contract-1");
    expect(props?.disclaimer).toBe(CERTIFICATE_DISCLAIMER);
  });

  it("서명자 블록을 owner 먼저 2개 생성하고 신원확인 수준을 명시한다", () => {
    const props = buildCertificateProps(baseInput);

    expect(props?.signers).toHaveLength(2);
    expect(props?.signers[0]).toMatchObject({
      party: "owner",
      name: "김하나",
      email: "owner@example.test",
      identityLevel: OWNER_IDENTITY_LEVEL,
    });
    expect(props?.signers[1]).toMatchObject({
      party: "counterparty",
      name: "박담당",
      email: "counterparty@example.test",
      identityLevel: COUNTERPARTY_IDENTITY_LEVEL,
      ip: "203.0.113.10",
      ua: "CounterpartyAgent",
    });
  });

  it("owner의 IP/UA는 서명 meta가 비면 contracts.signature_meta로 보강한다", () => {
    const props = buildCertificateProps(baseInput);

    expect(props?.signers[0]).toMatchObject({
      ip: "198.51.100.1",
      ua: "OwnerAgent",
    });
  });

  it("consent jsonb를 동의 라벨로 매핑하고 누락 필드는 방어한다", () => {
    const props = buildCertificateProps(baseInput);

    expect(props?.signers[0].consentLabels).toEqual([
      "전자서명 사용 약정 동의",
      "개인정보 수집·이용 동의",
    ]);

    const degraded = buildCertificateProps({
      ...baseInput,
      contract: { ...contract, signature_meta: null },
      signatures: [
        { ...ownerSignature, consent: null, meta: null, signer_name: null },
        { ...counterpartySignature, consent: "broken" },
      ],
    });

    expect(degraded?.signers[0].consentLabels).toEqual([]);
    expect(degraded?.signers[0].name).toBe("owner@example.test");
    expect(degraded?.signers[0].ip).toBe("기록 없음");
    expect(degraded?.signers[1].consentLabels).toEqual([]);
  });

  it("이벤트를 시각 오름차순으로 정렬해 타임라인을 만든다", () => {
    const props = buildCertificateProps(baseInput);

    expect(props?.timeline.map((item) => item.label)).toEqual([
      "서명 요청 발송",
      "상대방 열람",
      "상대방 서명(완결)",
    ]);
  });

  it("TSA 토큰이 없으면 미확보로 표시하고, 있으면 sha256 지문을 축약한다", () => {
    const props = buildCertificateProps(baseInput);

    expect(props?.tsa.tsaUrl).toBe("https://freetsa.org/tsr");
    expect(props?.tsa.completion.present).toBe(false);
    expect(props?.tsa.completion.fingerprint).toBeNull();
    expect(props?.tsa.sent.present).toBe(true);

    const expectedHex = createHash("sha256")
      .update(Buffer.from("sent-token-der"))
      .digest("hex");
    expect(props?.tsa.sent.fingerprint).toBe(
      `${expectedHex.slice(0, 16)}…${expectedHex.slice(-8)}`,
    );
  });

  it("TSA URL 미설정이면 null로 남긴다(과대표시 금지)", () => {
    const props = buildCertificateProps({ ...baseInput, tsaUrl: null });

    expect(props?.tsa.tsaUrl).toBeNull();
  });
});
