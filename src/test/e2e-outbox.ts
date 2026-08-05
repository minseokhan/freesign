import { readFile } from "node:fs/promises";
import path from "node:path";

// dev 서버가 EMAIL_OUTBOX_FILE로 적재하는 아웃박스(JSONL)를 읽어 원문 서명 토큰을 집어온다.
// 서명 링크의 원문 토큰은 메일 본문에만 존재하고 DB에는 sha256 해시만 남으므로,
// 상대방 서명까지 자동화하려면 이 경로가 유일하다.
export const E2E_OUTBOX_FILE = ".e2e-outbox.jsonl";

type OutboxRecord = {
  to?: string;
  subject?: string;
  text?: string;
};

const SIGN_TOKEN_PATTERN = /\/sign\/([A-Za-z0-9_-]{20,})/;

function outboxPath() {
  const configured = process.env.EMAIL_OUTBOX_FILE ?? E2E_OUTBOX_FILE;

  return path.isAbsolute(configured)
    ? configured
    : path.join(process.cwd(), configured);
}

async function readRecords(): Promise<OutboxRecord[]> {
  let raw: string;

  try {
    raw = await readFile(outboxPath(), "utf8");
  } catch {
    return [];
  }

  return raw
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as OutboxRecord];
      } catch {
        return [];
      }
    });
}

/** 수신자에게 나간 메일 본문에서 패턴에 맞는 가장 최근 값을 뽑는다. */
async function waitForOutboxMatch(
  recipientEmail: string,
  pattern: RegExp,
  timeoutMs = 15_000,
): Promise<RegExpMatchArray> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const records = await readRecords();
    const matched = records
      .filter((record) => record.to === recipientEmail)
      .map((record) => record.text?.match(pattern))
      .filter((match): match is RegExpMatchArray => Boolean(match));

    if (matched.length > 0) {
      return matched[matched.length - 1];
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `아웃박스(${outboxPath()})에서 ${recipientEmail} 앞 ${pattern} 링크를 찾지 못했습니다. ` +
          `dev 서버가 EMAIL_OUTBOX_FILE=${E2E_OUTBOX_FILE}로 기동됐는지 확인하고(.env.local) 재기동하세요.`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** 서명 요청 메일에서 원문 서명 토큰을 뽑는다. */
export async function waitForSigningToken(
  recipientEmail: string,
): Promise<string> {
  const match = await waitForOutboxMatch(recipientEmail, SIGN_TOKEN_PATTERN);

  return match[1];
}
