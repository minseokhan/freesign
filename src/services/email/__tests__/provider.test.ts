// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createConsoleEmailProvider,
  createResendEmailProvider,
  getEmailProvider,
  type EmailMessage,
} from "@/services/email/provider";

const message: EmailMessage = {
  to: "counterparty@example.com",
  subject: "[FreeSign] 서명 요청",
  html: "<p>서명 링크: https://freesign.example/sign/token-abc</p>",
  text: "서명 링크: https://freesign.example/sign/token-abc",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createResendEmailProvider", () => {
  it("POSTs the Resend emails endpoint with bearer auth and mapped body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const provider = createResendEmailProvider("re_test_key", "FreeSign <no-reply@freesign.example>", fetchFn);

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
      from: "FreeSign <no-reply@freesign.example>",
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      attachments: [{ filename: "certificate.pdf", content: "aGVsbG8=" }],
    });
  });

  it("omits attachments from the body when not provided", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const provider = createResendEmailProvider("re_test_key", "no-reply@freesign.example", fetchFn);

    await provider.send(message);

    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).not.toHaveProperty("attachments");
  });

  it("returns { ok: false } instead of throwing when fetch rejects", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    const provider = createResendEmailProvider("re_test_key", "no-reply@freesign.example", fetchFn);

    await expect(provider.send(message)).resolves.toEqual({
      ok: false,
      error: "network down",
    });
  });

  it("returns { ok: false } on a non-2xx response", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("validation failed", { status: 422 }));
    const provider = createResendEmailProvider("re_test_key", "no-reply@freesign.example", fetchFn);

    const result = await provider.send(message);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("422");
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
    expect(logged).toContain("https://freesign.example/sign/token-abc");
  });
});

describe("getEmailProvider", () => {
  it("uses the Resend provider when RESEND_API_KEY is set", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "FreeSign <no-reply@freesign.example>");
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
});
