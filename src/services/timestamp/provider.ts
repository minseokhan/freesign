// server-only: this module reads server env (TSA_URL) and performs outbound TSA calls — must not be imported by client components.
// RFC 3161 타임스탬프는 best-effort — 어떤 실패에서도 throw하지 않고 null을 반환해 서명 플로우를 차단하지 않는다(AI 폴백과 동일 철학).
import { randomBytes } from "node:crypto";

import { getTimestampEnv } from "@/lib/env";

export interface TimestampResult {
  token: string; // TimeStampResp 응답 원문 base64 (심층 파싱 없이 원문 보존)
  tsaUrl: string;
  stampedAt: string;
}

export interface TimestampProvider {
  stamp(sha256Hex: string): Promise<TimestampResult | null>;
}

// 무료 공용 TSA 기본 후보(문서화용). 자동 적용하지 않는다 — TSA_URL env 미설정 시 noop.
// 상용화 시 국내 공인 TSA(한국정보인증 등)로 TSA_URL만 교체하면 승급된다.
export const DEFAULT_PUBLIC_TSA_URL = "https://freetsa.org/tsr";

const FETCH_TIMEOUT_MS = 5_000; // 공용 TSA 다운 시 서명 응답 지연 방지

// SHA-256 AlgorithmIdentifier: SEQUENCE { OID 2.16.840.1.101.3.4.2.1, NULL }
const SHA256_ALGORITHM_IDENTIFIER = new Uint8Array([
  0x30, 0x0d, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01, 0x05, 0x00,
]);

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Invalid hex input");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function encodeDerLength(length: number): Uint8Array {
  if (length < 0x80) {
    return new Uint8Array([length]);
  }
  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function derTlv(tag: number, content: Uint8Array): Uint8Array {
  const lengthBytes = encodeDerLength(content.length);
  const out = new Uint8Array(1 + lengthBytes.length + content.length);
  out[0] = tag;
  out.set(lengthBytes, 1);
  out.set(content, 1 + lengthBytes.length);
  return out;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** 양의 INTEGER DER 인코딩: 선행 0 제거 후 MSB가 서 있으면 부호 방지용 0x00 프리픽스. */
function derPositiveInteger(value: Uint8Array): Uint8Array {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0x00) {
    start += 1;
  }
  const trimmed = value.length === 0 ? new Uint8Array([0x00]) : value.subarray(start);
  const needsPadding = (trimmed[0] & 0x80) !== 0;
  const content = needsPadding ? concatBytes(new Uint8Array([0x00]), trimmed) : trimmed;
  return derTlv(0x02, content);
}

/**
 * RFC 3161 §2.4.1 TimeStampReq DER 수동 조립 (외부 ASN.1 라이브러리 없이):
 * SEQUENCE {
 *   version        INTEGER 1,
 *   messageImprint SEQUENCE { SHA-256 AlgorithmIdentifier, OCTET STRING(32) },
 *   nonce          INTEGER,
 *   certReq        BOOLEAN TRUE
 * }
 */
export function buildTimeStampReq(sha256Hex: string, nonce: Uint8Array): Uint8Array {
  const hash = hexToBytes(sha256Hex);
  if (hash.length !== 32) {
    throw new Error("Expected a 32-byte SHA-256 hex digest");
  }

  const version = new Uint8Array([0x02, 0x01, 0x01]);
  const messageImprint = derTlv(
    0x30,
    concatBytes(SHA256_ALGORITHM_IDENTIFIER, derTlv(0x04, hash)),
  );
  const nonceInteger = derPositiveInteger(nonce);
  const certReq = new Uint8Array([0x01, 0x01, 0xff]);

  return derTlv(0x30, concatBytes(version, messageImprint, nonceInteger, certReq));
}

/** DER 길이 필드 크기(태그 다음 offset 기준): 단축형 1바이트, 장축형 1 + n바이트. */
function derLengthFieldSize(der: Uint8Array, offset: number): number {
  const first = der[offset];
  if (first === undefined) {
    throw new Error("Truncated DER length");
  }
  return first < 0x80 ? 1 : 1 + (first & 0x7f);
}

/**
 * TimeStampResp의 PKIStatusInfo.status(INTEGER)만 최소 파싱한다.
 * TimeStampResp ::= SEQUENCE { status PKIStatusInfo ::= SEQUENCE { status INTEGER, ... }, ... }
 */
function parsePkiStatus(der: Uint8Array): number {
  let offset = 0;
  if (der[offset] !== 0x30) throw new Error("TimeStampResp: expected outer SEQUENCE");
  offset += 1 + derLengthFieldSize(der, offset + 1);
  if (der[offset] !== 0x30) throw new Error("PKIStatusInfo: expected SEQUENCE");
  offset += 1 + derLengthFieldSize(der, offset + 1);
  if (der[offset] !== 0x02) throw new Error("PKIStatus: expected INTEGER");
  offset += 1;
  const intLen = der[offset];
  offset += 1;
  if (intLen === undefined || intLen < 1 || intLen > 4 || offset + intLen > der.length) {
    throw new Error("PKIStatus: invalid INTEGER length");
  }
  let status = 0;
  for (let i = 0; i < intLen; i += 1) {
    status = status * 256 + der[offset + i];
  }
  return status;
}

export function createRfc3161TimestampProvider(
  url: string,
  fetchFn: typeof fetch = fetch,
): TimestampProvider {
  return {
    async stamp(sha256Hex) {
      try {
        const request = buildTimeStampReq(sha256Hex, randomBytes(8));

        const response = await fetchFn(url, {
          method: "POST",
          headers: { "Content-Type": "application/timestamp-query" },
          body: Buffer.from(request),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
          console.error(`[timestamp] TSA responded with status ${response.status} (${url})`);
          return null;
        }

        const body = new Uint8Array(await response.arrayBuffer());
        // status가 granted(0)/grantedWithMods(1)인지 최소 확인만 하고 응답 원문을 base64로 보존한다.
        // TST 토큰 심층 파싱·검증은 하지 않는다 — 검증은 `openssl ts -verify -in <resp.der> -queryfile <req.der> ...` 외부 절차로 수행.
        const status = parsePkiStatus(body);
        if (status !== 0 && status !== 1) {
          console.error(`[timestamp] TSA rejected the request: PKIStatus=${status} (${url})`);
          return null;
        }

        return {
          token: Buffer.from(body).toString("base64"),
          tsaUrl: url,
          stampedAt: new Date().toISOString(),
        };
      } catch (error) {
        console.error(
          `[timestamp] stamp failed (${url}): ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      }
    },
  };
}

export function createNoopTimestampProvider(): TimestampProvider {
  return {
    async stamp() {
      return null;
    },
  };
}

export function getTimestampProvider(): TimestampProvider {
  const env = getTimestampEnv();

  if (env.TSA_URL) {
    return createRfc3161TimestampProvider(env.TSA_URL);
  }

  // TSA_URL 미설정 = noop (dev에서 외부 호출 방지). 공용 TSA를 쓰려면 TSA_URL=https://freetsa.org/tsr 설정.
  return createNoopTimestampProvider();
}
