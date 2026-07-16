// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPostHogClient } from "@/lib/posthog-server";
import { createAnonClient } from "@/lib/supabase/anon";
import { getEmailProvider } from "@/services/email/provider";
import { getTimestampProvider } from "@/services/timestamp/provider";
import type { Json } from "@/types/database";

import { POST } from "../route";

vi.mock("@/lib/supabase/anon", () => ({
  createAnonClient: vi.fn(),
}));

vi.mock("@/lib/contracts/render-pdf", () => ({
  renderContractPdf: vi.fn(async () => Buffer.from("contract-pdf")),
  renderCertificatePdf: vi.fn(async () => Buffer.from("certificate-pdf")),
}));

vi.mock("@/services/email/provider", () => ({
  getEmailProvider: vi.fn(),
}));

vi.mock("@/services/timestamp/provider", () => ({
  getTimestampProvider: vi.fn(),
}));

vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: vi.fn(),
  captureServerException: vi.fn(),
}));

const RAW_TOKEN = "raw-signing-token-for-tests";
const SIGNATURE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const DOC_HASH = "a".repeat(64);

const completeResult: Json = {
  request_id: "request-1",
  contract_id: "contract-1",
  contract_title: "웹사이트 구축",
  owner_email: "owner@example.test",
  recipient_email: "counterparty@example.test",
  recipient_name: "김담당",
};

const signedContractData: Json = {
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
    clauses: [{ title: "제1조", body: "본문", plain_summary: "요약" }],
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
    signature_image_data: SIGNATURE_DATA_URL,
  },
};

const certificateData: Json = {
  contract: {
    id: "contract-1",
    title: "웹사이트 구축",
    clauses: [],
    doc_hash: DOC_HASH,
  },
  signatures: [
    {
      party: "owner",
      signer_name: "한프리",
      signer_email: "owner@example.test",
      signed_at: "2026-07-16T09:00:00.000Z",
      consent: {},
      meta: {},
    },
    {
      party: "counterparty",
      signer_name: "김담당",
      signer_email: "counterparty@example.test",
      signed_at: "2026-07-17T01:00:00.000Z",
      consent: {},
      meta: {},
    },
  ],
  events: [],
  tsa: { sent_tsa_token: null, completion_tsa_token: null },
  completed_at: "2026-07-17T01:00:00.000Z",
};

type RpcHandler = (args: Record<string, unknown>) => {
  data: Json | boolean | null;
  error: { message: string } | null;
};

function createRpc(overrides: Partial<Record<string, RpcHandler>> = {}) {
  const handlers: Record<string, RpcHandler> = {
    consume_anon_rate_limit: () => ({ data: true, error: null }),
    complete_counterparty_signature_with_event: () => ({
      data: completeResult,
      error: null,
    }),
    get_signed_contract_data: () => ({ data: signedContractData, error: null }),
    get_certificate_data: () => ({ data: certificateData, error: null }),
    store_completion_tsa_token: () => ({ data: true, error: null }),
    ...overrides,
  };

  return vi.fn((fnName: string, args: Record<string, unknown>) => {
    const handler = handlers[fnName];

    if (!handler) {
      return Promise.resolve({
        data: null,
        error: { message: `unexpected rpc ${fnName}` },
      });
    }

    return Promise.resolve(handler(args));
  });
}

function mockAnonClient(rpc: ReturnType<typeof createRpc>) {
  vi.mocked(createAnonClient).mockReturnValue({ rpc } as unknown as ReturnType<
    typeof createAnonClient
  >);
}

function createRequest(body: Record<string, unknown> = {}) {
  return new Request(`http://localhost/api/sign/${RAW_TOKEN}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Vitest Browser",
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
    },
    body: JSON.stringify({
      signerName: "김담당",
      signatureDataUrl: SIGNATURE_DATA_URL,
      consentElectronicSignature: true,
      consentPrivacy: true,
      ...body,
    }),
  });
}

function routeContext(token = RAW_TOKEN) {
  return { params: Promise.resolve({ token }) };
}

const emailSend = vi.fn();
const timestampStamp = vi.fn();
const posthogCapture = vi.fn();

describe("POST /api/sign/[token]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emailSend.mockResolvedValue({ ok: true });
    timestampStamp.mockResolvedValue({
      token: Buffer.from("tsa-token").toString("base64"),
      tsaUrl: "https://tsa.example.test/tsr",
      stampedAt: "2026-07-17T01:00:01.000Z",
    });
    vi.mocked(getEmailProvider).mockReturnValue({ send: emailSend });
    vi.mocked(getTimestampProvider).mockReturnValue({ stamp: timestampStamp });
    vi.mocked(getPostHogClient).mockReturnValue({
      capture: posthogCapture,
      flush: vi.fn(),
    } as unknown as ReturnType<typeof getPostHogClient>);
  });

  it("returns 400 when consents are not both true and never calls the signing RPC", async () => {
    const rpc = createRpc();
    mockAnonClient(rpc);

    const response = await POST(
      createRequest({ consentElectronicSignature: false }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalledWith(
      "complete_counterparty_signature_with_event",
      expect.anything(),
    );
  });

  it("returns 400 for non-PNG or oversized signature payloads", async () => {
    const rpc = createRpc();
    mockAnonClient(rpc);

    const jpeg = await POST(
      createRequest({ signatureDataUrl: "data:image/jpeg;base64,QUJD" }),
      routeContext(),
    );
    expect(jpeg.status).toBe(400);

    const oversized = await POST(
      createRequest({
        signatureDataUrl: `data:image/png;base64,${"A".repeat(210_000)}`,
      }),
      routeContext(),
    );
    expect(oversized.status).toBe(400);

    expect(rpc).not.toHaveBeenCalledWith(
      "complete_counterparty_signature_with_event",
      expect.anything(),
    );
  });

  it("returns 429 when the anon rate limit is exhausted", async () => {
    const rpc = createRpc({
      consume_anon_rate_limit: () => ({ data: false, error: null }),
    });
    mockAnonClient(rpc);

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(429);
    expect(rpc).toHaveBeenCalledWith(
      "consume_anon_rate_limit",
      expect.objectContaining({
        p_bucket: "counterparty_sign",
        p_limit: 5,
        p_window_seconds: 60,
        p_ip_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(rpc).not.toHaveBeenCalledWith(
      "complete_counterparty_signature_with_event",
      expect.anything(),
    );
  });

  it.each([
    ["signature request expired", 410],
    ["signature request revoked", 410],
    ["signature request already completed", 409],
    ["document hash mismatch", 409],
    ["contract is not awaiting a counterparty signature", 409],
    ["signature request not found", 404],
  ])("maps the RPC error %s to HTTP %d", async (message, status) => {
    const rpc = createRpc({
      complete_counterparty_signature_with_event: () => ({
        data: null,
        error: { message },
      }),
    });
    mockAnonClient(rpc);

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(status);
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("commits via a single RPC call without any prior verification SELECT", async () => {
    const rpc = createRpc();
    mockAnonClient(rpc);

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    // 첫 rpc는 레이트리밋, 두 번째가 곧바로 완결 RPC — 사전 검증 조회 없음(TOCTOU 제거).
    expect(rpc.mock.calls[0][0]).toBe("consume_anon_rate_limit");
    expect(rpc.mock.calls[1][0]).toBe(
      "complete_counterparty_signature_with_event",
    );
    expect(rpc.mock.calls[1][1]).toMatchObject({
      p_signature_image_data: SIGNATURE_DATA_URL,
      p_signer_name: "김담당",
      p_ip: "203.0.113.10",
      p_ua: "Vitest Browser",
      p_consent: expect.objectContaining({
        electronic_signature: true,
        privacy: true,
      }),
    });
  });

  it("stores the completion TSA token, emails both parties with attachments, and captures posthog", async () => {
    const rpc = createRpc();
    mockAnonClient(rpc);

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(timestampStamp).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
    expect(rpc).toHaveBeenCalledWith(
      "store_completion_tsa_token",
      expect.objectContaining({
        p_token: Buffer.from("tsa-token").toString("base64"),
      }),
    );

    expect(emailSend).toHaveBeenCalledTimes(2);
    const recipients = emailSend.mock.calls.map((call) => call[0].to).sort();
    expect(recipients).toEqual([
      "counterparty@example.test",
      "owner@example.test",
    ]);
    for (const [message] of emailSend.mock.calls) {
      // 본문에 doc_hash 전문 + 계약서·완결증명서 PDF 첨부.
      expect(message.text).toContain(DOC_HASH);
      expect(message.attachments).toHaveLength(2);
    }

    expect(posthogCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "owner-user-1",
        event: "contract_counterparty_signed",
        properties: expect.objectContaining({ contract_id: "contract-1" }),
      }),
    );
  });

  it("still returns 200 when TSA stamping and email delivery both fail", async () => {
    const rpc = createRpc({
      store_completion_tsa_token: () => ({
        data: null,
        error: { message: "storage failed" },
      }),
    });
    mockAnonClient(rpc);
    timestampStamp.mockRejectedValue(new Error("tsa down"));
    emailSend.mockRejectedValue(new Error("email down"));

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });

  it("falls back to download links when attachment rendering fails", async () => {
    const rpc = createRpc({
      get_signed_contract_data: () => ({
        data: null,
        error: { message: "boom" },
      }),
    });
    mockAnonClient(rpc);

    const response = await POST(createRequest(), routeContext());

    expect(response.status).toBe(200);
    expect(emailSend).toHaveBeenCalledTimes(2);
    for (const [message] of emailSend.mock.calls) {
      expect(message.attachments).toBeUndefined();
      expect(message.text).toContain(DOC_HASH.length ? "다운로드" : "");
    }
  });
});
