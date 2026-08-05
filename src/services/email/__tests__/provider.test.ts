// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createConsoleEmailProvider,
  createOutboxEmailProvider,
  createResendEmailProvider,
  getEmailProvider,
  type EmailMessage,
} from "@/services/email/provider";

const message: EmailMessage = {
  to: "counterparty@example.com",
  subject: "[매듭] 서명 요청",
  html: "<p>서명 링크: https://maedeup.example/sign/token-abc</p>",
  text: "서명 링크: https://maedeup.example/sign/token-abc",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createResendEmailProvider", () => {
  it("POSTs the Resend emails endpoint with bearer auth and mapped body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const provider = createResendEmailProvider("re_test_key", "매듭 <no-reply@maedeup.example>", fetchFn);

    const result = await provider.send({
      ...message,
      attachments: [{ filename: "certificate.pdf", content: "aGVsbG8=" }],
    });

    expect(result).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer re_test_key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: "매듭 <no-reply@maedeup.example>",
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: [{ filename: "certificate.pdf", content: "aGVsbG8=" }],
    });
  });

  it("omits attachments from the body when not provided", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const provider = createResendEmailProvider("re_test_key", "no-reply@maedeup.example", fetchFn);

    await provider.send(message);

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty("attachments");
  });

  it("returns { ok: false } instead of throwing when fetch rejects", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    const provider = createResendEmailProvider("re_test_key", "no-reply@maedeup.example", fetchFn);

    await expect(provider.send(message)).resolves.toEqual({
      ok: false,
      error: "network down",
    });
  });

  it("returns { ok: false } on a non-2xx response", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("validation failed", { status: 422 }));
    const provider = createResendEmailProvider("re_test_key", "no-reply@maedeup.example", fetchFn);

    const result = await provider.send(message);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("422");
  });

  // 발신 도메인 미인증(403)이 여기로 온다. 상태 코드만 남기면 "왜 안 나갔는지"가
  // 로그에서 사라져 도메인 셋업 중 원인을 못 찾는다.
  it("Resend가 준 실패 사유(JSON message)를 error에 담는다", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 403,
          message: "The maedeup.example domain is not verified.",
        }),
        { status: 403 },
      ),
    );
    const provider = createResendEmailProvider("re_test_key", "no-reply@maedeup.example", fetchFn);

    const result = await provider.send(message);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("403");
    expect(result.error).toContain("domain is not verified");
  });

  it("본문이 JSON이 아니면 원문 텍스트를 사유로 담는다", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("<html>Bad Gateway</html>", { status: 502 }));
    const provider = createResendEmailProvider("re_test_key", "no-reply@maedeup.example", fetchFn);

    const result = await provider.send(message);

    expect(result.error).toContain("502");
    expect(result.error).toContain("Bad Gateway");
  });

  it("본문이 비어 있어도 상태 코드만으로 실패를 알린다", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    const provider = createResendEmailProvider("re_test_key", "no-reply@maedeup.example", fetchFn);

    const result = await provider.send(message);

    expect(result).toEqual({ ok: false, error: "Resend API responded with status 500" });
  });
});

describe("createConsoleEmailProvider", () => {
  it("logs the recipient, subject, and body text and always succeeds", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const provider = createConsoleEmailProvider();

    const result = await provider.send(message);

    expect(result).toEqual({ ok: true });
    const logged = infoSpy.mock.calls.flat().join("\n");
    expect(logged).toContain(message.to);
    expect(logged).toContain(message.subject);
    expect(logged).toContain("https://maedeup.example/sign/token-abc");
  });
});

describe("createOutboxEmailProvider", () => {
  it("메시지를 JSONL 한 줄로 덧붙이고 첨부는 파일명만 남긴다", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "maedeup-outbox-"));
    const filePath = path.join(dir, "outbox.jsonl");

    try {
      const provider = createOutboxEmailProvider(filePath);

      await provider.send(message);
      await provider.send({
        ...message,
        to: "owner@example.com",
        attachments: [{ filename: "certificate.pdf", content: "aGVsbG8=" }],
      });

      const lines = (await readFile(filePath, "utf8")).trim().split("\n");
      expect(lines).toHaveLength(2);

      const first = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(first.to).toBe(message.to);
      expect(first.subject).toBe(message.subject);
      expect(first.text).toContain("https://maedeup.example/sign/token-abc");

      const second = JSON.parse(lines[1]) as Record<string, unknown>;
      expect(second.to).toBe("owner@example.com");
      // 첨부 본문(PDF base64)은 수십 KB라 파일명만 남긴다.
      expect(second.attachments).toEqual(["certificate.pdf"]);
      expect(JSON.stringify(second)).not.toContain("aGVsbG8=");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("파일을 쓸 수 없어도 throw하지 않고 실패를 반환한다", async () => {
    const provider = createOutboxEmailProvider(
      path.join(tmpdir(), "maedeup-outbox-missing-dir", "outbox.jsonl"),
    );

    const result = await provider.send(message);

    expect(result.ok).toBe(false);
  });
});

describe("getEmailProvider", () => {
  // E2E는 원문 서명 토큰이 든 메일 본문을 파일로 받아야 상대방 서명까지 이어갈 수 있다.
  it("EMAIL_OUTBOX_FILE이 설정되면 개발 환경에서 Resend 대신 아웃박스로 보낸다", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "maedeup-outbox-"));
    const filePath = path.join(dir, "outbox.jsonl");

    try {
      vi.stubEnv("RESEND_API_KEY", "re_test_key");
      vi.stubEnv("EMAIL_OUTBOX_FILE", filePath);
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const result = await getEmailProvider().send(message);

      expect(result).toEqual({ ok: true });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await readFile(filePath, "utf8")).toContain("token-abc");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // 아웃박스 파일은 미사용 서명 토큰을 평문으로 남긴다 — 프로덕션에서는 절대 켜지지 않는다.
  it("프로덕션에서는 EMAIL_OUTBOX_FILE을 무시한다", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "maedeup-outbox-"));
    const filePath = path.join(dir, "outbox.jsonl");

    try {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("RESEND_API_KEY", "re_test_key");
      vi.stubEnv("EMAIL_OUTBOX_FILE", filePath);
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response("{}", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);

      await getEmailProvider().send(message);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      await expect(readFile(filePath, "utf8")).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses the Resend provider when RESEND_API_KEY is set", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "매듭 <no-reply@maedeup.example>");
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = getEmailProvider();
    await provider.send(message);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_test_key" });
  });

  it("falls back to the console provider when RESEND_API_KEY is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const provider = getEmailProvider();
    const result = await provider.send(message);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalled();
  });

  // 콘솔 폴백은 본문 전문(= 원문 서명 토큰이 든 /sign/ URL)을 로그에 남긴다.
  // 프로덕션에서 이게 돌면 로그 열람자가 미사용 서명 토큰을 그대로 획득한다.
  it("프로덕션에서 RESEND_API_KEY가 없으면 콘솔 폴백 대신 fail-closed로 실패한다", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const provider = getEmailProvider();
    const result = await provider.send(message);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });
});
