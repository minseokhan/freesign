// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  parseCertificateData,
  parseSignedContractData,
} from "@/lib/contracts/public-sign";
import type { Json } from "@/types/database";

const DOC_HASH = "a".repeat(64);
const IMAGE_DATA_URL =
  "data:image/png;base64," + Buffer.from("counterparty-png").toString("base64");

function signedContractData(): Json {
  return {
    owner_user_id: "owner-user-1",
    client_name: "발주사",
    contract: {
      id: "contract-1",
      title: "웹사이트 구축",
      scope: "랜딩 페이지 제작",
      amount: 2500000,
      start_date: "2026-07-01",
      end_date: "2026-07-31",
      status: "signed",
      clauses: [
        { title: "제1조", body: "본문", plain_summary: "요약" },
      ],
      plain_summary: null,
      doc_hash: DOC_HASH,
      signature_meta: {
        signer: "owner@example.test",
        signed_at: "2026-07-16T09:00:00.000Z",
        ip: "198.51.100.1",
        ua: "OwnerAgent",
      },
    },
    counterparty_signature: {
      signer_name: "김담당",
      signer_email: "counterparty@example.test",
      signed_at: "2026-07-17T01:00:00.000Z",
      signature_image_data: IMAGE_DATA_URL,
    },
  };
}

function certificateData(): Json {
  return {
    contract: {
      id: "contract-1",
      title: "웹사이트 구축",
      clauses: [],
      doc_hash: DOC_HASH,
    },
    signatures: [
      {
        party: "counterparty",
        signer_name: "김담당",
        signer_email: "counterparty@example.test",
        signed_at: "2026-07-17T01:00:00.000Z",
        consent: { electronic_signature: true, privacy: true },
        meta: { ip: "203.0.113.9", ua: "CounterAgent" },
      },
      {
        party: "owner",
        signer_name: "한프리",
        signer_email: "owner@example.test",
        signed_at: "2026-07-16T09:00:00.000Z",
        consent: { electronic_signature: true, privacy: true },
        meta: {},
      },
    ],
    events: [
      {
        actor: "owner-user-1",
        from_status: "draft",
        to_status: "sent",
        event_type: "signature_request.sent",
        created_at: "2026-07-16T09:00:00.000Z",
      },
      {
        actor: "counterparty:counterparty@example.test",
        from_status: "sent",
        to_status: "signed",
        event_type: "contract.counterparty_signed",
        created_at: "2026-07-17T01:00:00.000Z",
      },
    ],
    tsa: {
      sent_tsa_token: Buffer.from("sent-token").toString("base64"),
      completion_tsa_token: null,
    },
    completed_at: "2026-07-17T01:00:00.000Z",
  };
}

describe("parseSignedContractData", () => {
  it("maps the RPC payload to a contract pdf model with the counterparty slot", () => {
    const parsed = parseSignedContractData(signedContractData());

    expect(parsed).not.toBeNull();
    expect(parsed?.ownerUserId).toBe("owner-user-1");
    expect(parsed?.contractId).toBe("contract-1");
    expect(parsed?.contractTitle).toBe("웹사이트 구축");
    expect(parsed?.docHash).toBe(DOC_HASH);
    expect(parsed?.model.clientName).toBe("발주사");
    expect(parsed?.model.docHash).toBe(DOC_HASH);
    expect(parsed?.model.clauses).toHaveLength(1);
    // owner 서명 이미지는 Storage key라 anon 렌더에는 포함하지 않는다(메타만).
    expect(parsed?.model.signatureImageDataUri).toBeNull();
    expect(parsed?.model.signature?.signer).toBe("owner@example.test");
    expect(parsed?.model.counterpartySignature).toMatchObject({
      imageDataUri: IMAGE_DATA_URL,
      name: "김담당",
    });
  });

  it("returns null for malformed payloads", () => {
    expect(parseSignedContractData(null)).toBeNull();
    expect(parseSignedContractData("oops")).toBeNull();
    expect(parseSignedContractData({ contract: null })).toBeNull();
    expect(
      parseSignedContractData({
        owner_user_id: "owner-user-1",
        client_name: null,
        contract: { id: "contract-1", title: "제목만 있음" },
        counterparty_signature: null,
      }),
    ).toBeNull();
  });
});

describe("parseCertificateData", () => {
  it("maps the RPC payload to certificate document props", () => {
    const props = parseCertificateData(certificateData(), {
      tsaUrl: "https://tsa.example.test/tsr",
    });

    expect(props).not.toBeNull();
    expect(props?.contractTitle).toBe("웹사이트 구축");
    expect(props?.docHash).toBe(DOC_HASH);
    // owner 우선 정렬(buildCertificateProps)과 서명자 2인.
    expect(props?.signers.map((signer) => signer.party)).toEqual([
      "owner",
      "counterparty",
    ]);
    expect(props?.timeline).toHaveLength(2);
    expect(props?.tsa.tsaUrl).toBe("https://tsa.example.test/tsr");
    expect(props?.tsa.sent.present).toBe(true);
    expect(props?.tsa.completion.present).toBe(false);
  });

  it("returns null for malformed payloads or when the counterparty signature is missing", () => {
    expect(parseCertificateData(null)).toBeNull();
    expect(parseCertificateData([])).toBeNull();

    const withoutCounterparty = certificateData() as Record<string, Json>;
    withoutCounterparty.signatures = (
      withoutCounterparty.signatures as Json[]
    ).filter(
      (signature) =>
        typeof signature === "object" &&
        signature !== null &&
        !Array.isArray(signature) &&
        signature.party !== "counterparty",
    );

    expect(parseCertificateData(withoutCounterparty)).toBeNull();
  });
});
