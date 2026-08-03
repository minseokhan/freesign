// server-only: this module reads server env (RESEND_API_KEY) and must not be imported by client components.
// 이메일 실패는 서명 트랜잭션과 분리(best-effort + 재발송 버튼) — send는 어떤 실패에서도 throw하지 않는다.
import { getEmailEnv } from "@/lib/env";

export interface EmailAttachment {
  filename: string;
  content: string; // base64
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

export interface EmailSendResult {
  ok: boolean;
  error?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

const RESEND_EMAILS_URL = "https://api.resend.com/emails";
// EMAIL_FROM 미설정 시 Resend 테스트 발신 주소(자기 계정 주소로만 발송 가능).
const DEFAULT_FROM = "FreeSign <onboarding@resend.dev>";

// Resend는 실패 사유를 본문에 담아 준다(예: 발신 도메인 미인증 403). 상태 코드만 남기면
// 로그에서 원인이 사라지므로 사유를 함께 싣는다. 본문을 못 읽어도 실패 판정은 그대로.
async function readResendErrorReason(response: Response): Promise<string | null> {
  try {
    const body = (await response.text()).trim();

    if (!body) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(body);
      const message =
        typeof parsed === "object" && parsed !== null
          ? (parsed as { message?: unknown }).message
          : null;

      if (typeof message === "string" && message.trim()) {
        return message.trim().slice(0, 300);
      }
    } catch {
      // JSON이 아니면 원문을 그대로 쓴다.
    }

    return body.slice(0, 300);
  } catch {
    return null;
  }
}

export function createResendEmailProvider(
  apiKey: string,
  from: string,
  fetchFn: typeof fetch = fetch,
): EmailProvider {
  return {
    async send(message) {
      try {
        const response = await fetchFn(RESEND_EMAILS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
            ...(message.attachments && message.attachments.length > 0
              ? {
                  attachments: message.attachments.map((attachment) => ({
                    filename: attachment.filename,
                    content: attachment.content,
                  })),
                }
              : {}),
          }),
        });

        if (!response.ok) {
          const reason = await readResendErrorReason(response);

          return {
            ok: false,
            error: reason
              ? `Resend API responded with status ${response.status}: ${reason}`
              : `Resend API responded with status ${response.status}`,
          };
        }

        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

export function createConsoleEmailProvider(): EmailProvider {
  return {
    async send(message) {
      // dev 폴백: 수동 E2E에서 본문 내 서명 URL을 복사할 수 있게 text 전문을 출력한다.
      console.info(
        `[email:console] to=${message.to} subject=${message.subject}\n${message.text}`,
      );
      return { ok: true };
    },
  };
}

// 미설정 프로바이더. 콘솔 폴백은 본문 전문(원문 서명 토큰이 든 /sign/ URL)을 로그에 남기므로
// 프로덕션에서는 폴백하지 않고 실패를 그대로 알린다. 발송은 best-effort라 호출자는 이 실패로
// 트랜잭션을 되돌리지 않고 재발송 버튼으로 복구한다.
export function createUnconfiguredEmailProvider(): EmailProvider {
  return {
    async send() {
      return { ok: false, error: "email provider not configured" };
    },
  };
}

export function getEmailProvider(): EmailProvider {
  const env = getEmailEnv();

  if (env.RESEND_API_KEY) {
    return createResendEmailProvider(env.RESEND_API_KEY, env.EMAIL_FROM ?? DEFAULT_FROM);
  }

  if (process.env.NODE_ENV === "production") {
    return createUnconfiguredEmailProvider();
  }

  return createConsoleEmailProvider();
}
