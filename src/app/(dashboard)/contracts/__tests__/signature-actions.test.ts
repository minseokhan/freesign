import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requireUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { hashSigningToken } from "@/lib/signing-token";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { getEmailProvider } from "@/services/email/provider";
import { createV1SignatureProvider } from "@/services/signature/provider";
import { getTimestampProvider } from "@/services/timestamp/provider";

import {
  resendSignatureRequestEmail,
  revokeSignatureRequest,
  sendSignatureRequest,
} from "../signature-actions";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();

  return {
    ...actual,
    checkRateLimit: vi.fn(),
  };
});

vi.mock("@/services/email/provider", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/email/provider")>();

  return {
    ...actual,
    getEmailProvider: vi.fn(),
  };
});

vi.mock("@/services/timestamp/provider", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/timestamp/provider")>();

  return {
    ...actual,
    getTimestampProvider: vi.fn(),
  };
});

const user = { id: "user-123", email: "freelancer@example.test" };
const CONTRACT_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

const contractClauses = [
  {
    title: "당사자",
    body: "당사자 조항 본문입니다.",
    plain_summary: "",
    needs_review: false,
  },
];

const validSendInput = {
  contractId: CONTRACT_ID,
  recipientEmail: "counterparty@example.test",
  recipientName: "김담당",
  signatureDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
  consentElectronicSignature: true,
  consentPrivacy: true,
};

function createMaybeSingleQuery(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
}

function createSupabaseMock({
  contract = {
    id: CONTRACT_ID,
    status: "draft",
    title: "무디 브랜드 리뉴얼",
    clauses: contractClauses,
  } as Record<string, unknown> | null,
  request = {
    id: REQUEST_ID,
    recipient_email: "counterparty@example.test",
    recipient_name: "김담당",
  } as Record<string, unknown> | null,
} = {}) {
  const contractQuery = createMaybeSingleQuery(contract);
  const profileQuery = createMaybeSingleQuery({ display_name: "김프리" });
  const requestReadQuery = createMaybeSingleQuery(request);
  const requestUpdateEq = vi.fn().mockResolvedValue({ error: null });
  const requestUpdate = vi.fn().mockReturnValue({ eq: requestUpdateEq });
  const upload = vi.fn().mockResolvedValue({ error: null });
  const storageFrom = vi.fn().mockReturnValue({ upload });
  const rpc = vi.fn().mockResolvedValue({ data: REQUEST_ID, error: null });
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "contracts") return contractQuery;
      if (table === "profiles") return profileQuery;
      if (table === "signature_requests") {
        return { ...requestReadQuery, update: requestUpdate };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
    storage: { from: storageFrom },
    rpc,
  };

  return {
    supabase,
    contractQuery,
    profileQuery,
    requestReadQuery,
    requestUpdate,
    requestUpdateEq,
    upload,
    storageFrom,
    rpc,
  };
}

function useSupabaseMock(mocks: ReturnType<typeof createSupabaseMock>) {
  vi.mocked(createSupabaseClient).mockResolvedValue(
    mocks.supabase as unknown as Awaited<
      ReturnType<typeof createSupabaseClient>
    >,
  );
}

function extractSignUrlToken(text: string): string {
  const match = text.match(/\/sign\/([A-Za-z0-9_-]+)/);

  if (!match) {
    throw new Error(`서명 URL이 이메일 본문에 없습니다: ${text}`);
  }

  return match[1];
}

describe("signature request server actions", () => {
  const emailSend = vi.fn();
  const stamp = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    vi.mocked(requireUser).mockResolvedValue(
      user as Awaited<ReturnType<typeof requireUser>>,
    );
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true });
    vi.mocked(headers).mockResolvedValue(
      new Headers({
        "x-forwarded-for": "203.0.113.10",
        "user-agent": "vitest-agent",
      }) as unknown as Awaited<ReturnType<typeof headers>>,
    );
    emailSend.mockResolvedValue({ ok: true });
    vi.mocked(getEmailProvider).mockReturnValue({ send: emailSend });
    stamp.mockResolvedValue(null);
    vi.mocked(getTimestampProvider).mockReturnValue({ stamp });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("sendSignatureRequest", () => {
    it("rejects a contract that is not in draft status", async () => {
      const mocks = createSupabaseMock({
        contract: {
          id: CONTRACT_ID,
          status: "signed",
          title: "무디 브랜드 리뉴얼",
          clauses: contractClauses,
        },
      });
      useSupabaseMock(mocks);

      const result = await sendSignatureRequest(validSendInput);

      expect(result).toEqual({
        ok: false,
        error: "초안 상태의 계약만 서명 요청을 보낼 수 있습니다.",
      });
      expect(mocks.upload).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(emailSend).not.toHaveBeenCalled();
    });

    it("rejects a contract that is not owned by the user", async () => {
      const mocks = createSupabaseMock({ contract: null });
      useSupabaseMock(mocks);

      const result = await sendSignatureRequest(validSendInput);

      expect(result).toEqual({ ok: false, error: "계약을 찾을 수 없습니다." });
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(emailSend).not.toHaveBeenCalled();
    });

    it.each([
      ["누락된 전자서명 동의", { consentElectronicSignature: undefined }],
      ["false 전자서명 동의", { consentElectronicSignature: false }],
      ["false 개인정보 동의", { consentPrivacy: false }],
    ])("rejects consent validation for %s", async (_case, override) => {
      const result = await sendSignatureRequest({
        ...validSendInput,
        ...override,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fieldErrors).toBeDefined();
      }
      expect(checkRateLimit).not.toHaveBeenCalled();
      expect(createSupabaseClient).not.toHaveBeenCalled();
    });

    it("rejects a non-PNG signature data url", async () => {
      const result = await sendSignatureRequest({
        ...validSendInput,
        signatureDataUrl: "data:image/jpeg;base64,iVBORw0KGgo=",
      });

      expect(result.ok).toBe(false);
      expect(createSupabaseClient).not.toHaveBeenCalled();
    });

    it("rejects when the rate limit bucket is exhausted", async () => {
      vi.mocked(checkRateLimit).mockResolvedValue({
        allowed: false,
        retryAfter: 60,
      });

      const result = await sendSignatureRequest(validSendInput);

      expect(result).toEqual({
        ok: false,
        error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
      });
      expect(createSupabaseClient).not.toHaveBeenCalled();
    });

    it("sends a request with the token hash in the RPC and the raw token only in the email URL", async () => {
      const mocks = createSupabaseMock();
      useSupabaseMock(mocks);

      const result = await sendSignatureRequest({
        ...validSendInput,
        // 서버 소유 필드 위조 시도는 zod allowlist에서 걸러진다(unknown key strip).
        user_id: "attacker-user",
        status: "signed",
        doc_hash: "spoofed",
      });

      expect(result).toEqual({ ok: true, id: CONTRACT_ID });

      // owner 서명 업로드는 기존 sign route와 동일 경로·방식.
      expect(mocks.storageFrom).toHaveBeenCalledWith("contract-artifacts");
      expect(mocks.upload).toHaveBeenCalledWith(
        `${user.id}/${CONTRACT_ID}/signature.png`,
        expect.any(Uint8Array),
        { contentType: "image/png", upsert: true },
      );

      const expectedDocHash = createV1SignatureProvider().computeDocHash(
        contractClauses,
      );
      expect(mocks.rpc).toHaveBeenCalledWith(
        "send_signature_request_with_event",
        expect.objectContaining({
          p_contract_id: CONTRACT_ID,
          p_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
          p_recipient_email: validSendInput.recipientEmail,
          p_recipient_name: validSendInput.recipientName,
          p_signature_image_path: `${user.id}/${CONTRACT_ID}/signature.png`,
          p_doc_hash: expectedDocHash,
          p_signer_email: user.email,
          p_signer_name: "김프리",
          p_actor: user.id,
        }),
      );
      const rpcArgs = mocks.rpc.mock.calls[0][1] as Record<string, unknown>;
      // 서버 소유 signature_meta는 서버에서 구성된다(ip/ua는 요청 헤더).
      expect(rpcArgs.p_signature_meta).toMatchObject({
        signer: user.email,
        ip: "203.0.113.10",
        ua: "vitest-agent",
      });
      expect(rpcArgs.p_consent).toMatchObject({
        electronic_signature: true,
        privacy: true,
      });

      // 이메일에는 raw 토큰 URL, RPC에는 그 해시만 — 원문 토큰은 URL에만 존재한다.
      expect(emailSend).toHaveBeenCalledTimes(1);
      const message = emailSend.mock.calls[0][0];
      expect(message.to).toBe(validSendInput.recipientEmail);
      const rawToken = extractSignUrlToken(message.text);
      expect(message.text).toContain(
        `http://localhost:3000/sign/${rawToken}`,
      );
      expect(rawToken).not.toBe(rpcArgs.p_token_hash);
      expect(hashSigningToken(rawToken)).toBe(rpcArgs.p_token_hash);

      // 반환값에 raw 토큰이 없다.
      expect(JSON.stringify(result)).not.toContain(rawToken);

      expect(revalidatePath).toHaveBeenCalledWith("/contracts");
      expect(revalidatePath).toHaveBeenCalledWith(`/contracts/${CONTRACT_ID}`);
    });

    it("still succeeds when the email provider fails after the RPC commit", async () => {
      const mocks = createSupabaseMock();
      useSupabaseMock(mocks);
      emailSend.mockResolvedValue({ ok: false, error: "delivery failed" });
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      const result = await sendSignatureRequest(validSendInput);

      expect(result).toEqual({ ok: true, id: CONTRACT_ID });
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
    });

    it("still succeeds when the TSA stamp returns null (best-effort)", async () => {
      const mocks = createSupabaseMock();
      useSupabaseMock(mocks);
      stamp.mockResolvedValue(null);

      const result = await sendSignatureRequest(validSendInput);

      expect(result).toEqual({ ok: true, id: CONTRACT_ID });
      // 스탬프 실패 시 sent_tsa_token UPDATE도 없다.
      expect(mocks.requestUpdate).not.toHaveBeenCalled();
    });

    it("stores the sent TSA token after commit when the stamp succeeds", async () => {
      const mocks = createSupabaseMock();
      useSupabaseMock(mocks);
      stamp.mockResolvedValue({
        token: "dHNhLXRva2Vu",
        tsaUrl: "https://tsa.example/tsr",
        stampedAt: "2026-07-17T00:00:00.000Z",
      });

      const result = await sendSignatureRequest(validSendInput);

      expect(result).toEqual({ ok: true, id: CONTRACT_ID });
      const expectedDocHash = createV1SignatureProvider().computeDocHash(
        contractClauses,
      );
      expect(stamp).toHaveBeenCalledWith(expectedDocHash);
      expect(mocks.requestUpdate).toHaveBeenCalledWith({
        sent_tsa_token: "dHNhLXRva2Vu",
      });
      expect(mocks.requestUpdateEq).toHaveBeenCalledWith("id", REQUEST_ID);
    });
  });

  describe("resendSignatureRequestEmail", () => {
    it("rejects when there is no pending signature request", async () => {
      const mocks = createSupabaseMock({ request: null });
      useSupabaseMock(mocks);

      const result = await resendSignatureRequestEmail({
        contractId: CONTRACT_ID,
      });

      expect(result).toEqual({
        ok: false,
        error: "대기 중인 서명 요청이 없습니다.",
      });
      expect(mocks.requestUpdate).not.toHaveBeenCalled();
      expect(emailSend).not.toHaveBeenCalled();
    });

    it("rotates the token, extends expiry, and resends the email", async () => {
      const mocks = createSupabaseMock();
      useSupabaseMock(mocks);

      const result = await resendSignatureRequestEmail({
        contractId: CONTRACT_ID,
      });

      expect(result).toEqual({ ok: true, id: CONTRACT_ID });
      expect(mocks.requestUpdate).toHaveBeenCalledWith({
        token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        expires_at: expect.any(String),
      });
      expect(mocks.requestUpdateEq).toHaveBeenCalledWith("id", REQUEST_ID);

      // 재발급된 raw 토큰의 해시가 저장된 token_hash와 일치한다.
      const updatedTokenHash = (
        mocks.requestUpdate.mock.calls[0][0] as { token_hash: string }
      ).token_hash;
      expect(emailSend).toHaveBeenCalledTimes(1);
      const message = emailSend.mock.calls[0][0];
      expect(message.to).toBe("counterparty@example.test");
      const rawToken = extractSignUrlToken(message.text);
      expect(hashSigningToken(rawToken)).toBe(updatedTokenHash);

      expect(revalidatePath).toHaveBeenCalledWith(`/contracts/${CONTRACT_ID}`);
    });

    it("still succeeds when the resent email fails", async () => {
      const mocks = createSupabaseMock();
      useSupabaseMock(mocks);
      emailSend.mockResolvedValue({ ok: false, error: "delivery failed" });
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      const result = await resendSignatureRequestEmail({
        contractId: CONTRACT_ID,
      });

      expect(result).toEqual({ ok: true, id: CONTRACT_ID });
      expect(mocks.requestUpdate).toHaveBeenCalled();

      consoleError.mockRestore();
    });
  });

  describe("revokeSignatureRequest", () => {
    it("rejects when there is no pending signature request", async () => {
      const mocks = createSupabaseMock({ request: null });
      useSupabaseMock(mocks);

      const result = await revokeSignatureRequest({ contractId: CONTRACT_ID });

      expect(result).toEqual({
        ok: false,
        error: "대기 중인 서명 요청이 없습니다.",
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    });

    it("revokes the pending request through the atomic RPC", async () => {
      const mocks = createSupabaseMock();
      useSupabaseMock(mocks);

      const result = await revokeSignatureRequest({ contractId: CONTRACT_ID });

      expect(result).toEqual({ ok: true, id: CONTRACT_ID });
      expect(mocks.rpc).toHaveBeenCalledWith(
        "revoke_signature_request_with_event",
        expect.objectContaining({
          p_request_id: REQUEST_ID,
          p_actor: user.id,
        }),
      );
      expect(revalidatePath).toHaveBeenCalledWith("/contracts");
      expect(revalidatePath).toHaveBeenCalledWith(`/contracts/${CONTRACT_ID}`);
    });
  });
});
