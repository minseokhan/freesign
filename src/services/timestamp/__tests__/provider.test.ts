// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildTimeStampReq,
  createNoopTimestampProvider,
  createRfc3161TimestampProvider,
  getTimestampProvider,
} from "@/services/timestamp/provider";

// sha256("foobar") — 고정 golden 해시
const HASH_HEX = "c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2";
const NONCE = new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]);
const TSA_URL = "https://tsa.example/tsr";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** status만 담은 최소 TimeStampResp DER(토큰 없음 — rejection 응답 형태) */
function statusOnlyTimeStampResp(status: number): Uint8Array {
  // SEQUENCE { SEQUENCE { INTEGER status }, <opaque token bytes> }
  return new Uint8Array([0x30, 0x09, 0x30, 0x03, 0x02, 0x01, status, 0x04, 0x02, 0xaa, 0xbb]);
}

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function tlv(tag: number, content: Uint8Array): Uint8Array {
  const length =
    content.length < 0x80
      ? bytes(content.length)
      : bytes(0x82, (content.length >> 8) & 0xff, content.length & 0xff);
  return concat(bytes(tag), length, content);
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** 요청 DER(buildTimeStampReq 산출물)에서 nonce 본문을 꺼낸다. */
function nonceFromRequest(request: Uint8Array): Uint8Array {
  // 30 43 | 020101 | 3031 ... | 02 <len> <nonce> | 0101ff
  const nonceLength = request[57];
  return request.subarray(58, 58 + nonceLength);
}

/** messageImprint·nonce가 담긴 TSTInfo를 CMS로 감싼 현실적인 TimeStampResp DER */
function timeStampResp(
  status: number,
  options: { hashHex: string; nonce: Uint8Array },
): Uint8Array {
  const sha256AlgorithmIdentifier = fromHex("300d06096086480165030402010500");
  const messageImprint = tlv(
    0x30,
    concat(sha256AlgorithmIdentifier, tlv(0x04, fromHex(options.hashHex))),
  );
  const tstInfo = tlv(
    0x30,
    concat(
      fromHex("020101"), // version
      fromHex("06092a864886f70d010101"), // policy OID(임의)
      messageImprint,
      fromHex("020104"), // serialNumber
      tlv(0x18, new TextEncoder().encode("20260731000000Z")), // genTime
      tlv(0x02, options.nonce), // nonce
    ),
  );
  const encapContentInfo = tlv(
    0x30,
    concat(
      fromHex("060b2a864886f70d0109100104"), // id-ct-TSTInfo
      tlv(0xa0, tlv(0x04, tstInfo)),
    ),
  );
  const signedData = tlv(
    0x30,
    concat(fromHex("020103"), fromHex("3100"), encapContentInfo),
  );
  const contentInfo = tlv(
    0x30,
    concat(fromHex("06092a864886f70d010702"), tlv(0xa0, signedData)),
  );

  return tlv(0x30, concat(tlv(0x30, tlv(0x02, bytes(status))), contentInfo));
}

/** fetch mock: 요청의 nonce를 그대로 echo 하는 정상 TSA */
function respondingTsa(status = 0, overrides: { hashHex?: string; nonce?: Uint8Array } = {}) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const request = new Uint8Array(init.body as Uint8Array);

    return derResponse(
      timeStampResp(status, {
        hashHex: overrides.hashHex ?? HASH_HEX,
        nonce: overrides.nonce ?? nonceFromRequest(request),
      }),
    );
  });
}

function derResponse(body: Uint8Array, status = 200): Response {
  return new Response(Buffer.from(body), {
    status,
    headers: { "Content-Type": "application/timestamp-reply" },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildTimeStampReq", () => {
  it("produces the exact golden DER bytes for a fixed hash and nonce", () => {
    const der = buildTimeStampReq(HASH_HEX, NONCE);

    const expectedHex = [
      "3043", // TimeStampReq SEQUENCE, 길이 0x43(67)
      "020101", // version INTEGER 1
      "3031", // messageImprint SEQUENCE, 길이 0x31(49)
      "300d0609608648016503040201" + "0500", // AlgorithmIdentifier: SHA-256 OID + NULL params
      "0420" + HASH_HEX, // hashedMessage OCTET STRING(32)
      "0208" + toHex(NONCE), // nonce INTEGER(8 bytes, MSB=0이라 패딩 없음)
      "0101ff", // certReq BOOLEAN TRUE
    ].join("");

    expect(toHex(der)).toBe(expectedHex);
  });

  it("places the hash bytes at the documented offset (after the fixed prefix)", () => {
    const der = buildTimeStampReq(HASH_HEX, NONCE);

    // 프리픽스: 30 43 | 02 01 01 | 30 31 | 30 0d ... 05 00 | 04 20 → 해시는 offset 24부터 32바이트
    expect(der[0]).toBe(0x30);
    expect(toHex(der.subarray(24, 56))).toBe(HASH_HEX);
    // nonce INTEGER: 02 08 at 56, nonce 본문 58..65
    expect(der[56]).toBe(0x02);
    expect(der[57]).toBe(0x08);
    expect(toHex(der.subarray(58, 66))).toBe(toHex(NONCE));
    // certReq TRUE가 마지막 3바이트
    expect(toHex(der.subarray(66))).toBe("0101ff");
  });

  it("prepends a zero byte to the nonce INTEGER when the MSB is set", () => {
    const der = buildTimeStampReq(HASH_HEX, new Uint8Array([0x80, 0x01]));

    // nonce INTEGER = 02 03 00 80 01
    expect(toHex(der.subarray(56, 61))).toBe("0203008001");
  });

  it("throws on a non-sha256-length hex input (stamp() wrapper converts this to null)", () => {
    expect(() => buildTimeStampReq("abcd", NONCE)).toThrow();
    expect(() => buildTimeStampReq("zz".repeat(32), NONCE)).toThrow();
  });
});

describe("createRfc3161TimestampProvider", () => {
  it("POSTs the DER query and returns the raw response as base64 when status is granted(0)", async () => {
    const fetchFn = respondingTsa(0);
    const provider = createRfc3161TimestampProvider(TSA_URL, fetchFn);

    const result = await provider.stamp(HASH_HEX);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TSA_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/timestamp-query" });

    // 요청 body는 buildTimeStampReq DER (해시 삽입 확인)
    const body = new Uint8Array(init.body as Uint8Array);
    expect(body[0]).toBe(0x30);
    expect(toHex(body).includes(HASH_HEX)).toBe(true);

    expect(result).not.toBeNull();
    // 응답 원문이 그대로 base64로 보존된다(외부 재검증용).
    const expectedToken = timeStampResp(0, {
      hashHex: HASH_HEX,
      nonce: nonceFromRequest(body),
    });
    expect(result?.token).toBe(Buffer.from(expectedToken).toString("base64"));
    expect(result?.tsaUrl).toBe(TSA_URL);
    expect(typeof result?.stampedAt).toBe("string");
    expect(Number.isNaN(Date.parse(result!.stampedAt))).toBe(false);
  });

  it("accepts grantedWithMods(1)", async () => {
    const provider = createRfc3161TimestampProvider(TSA_URL, respondingTsa(1));

    await expect(provider.stamp(HASH_HEX)).resolves.not.toBeNull();
  });

  it("returns null when the TSA rejects the request (status >= 2)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchFn = vi.fn().mockResolvedValue(derResponse(statusOnlyTimeStampResp(2)));
    const provider = createRfc3161TimestampProvider(TSA_URL, fetchFn);

    await expect(provider.stamp(HASH_HEX)).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  // 0040(#33): 다른 다이제스트·다른 요청에 대한 토큰을 증거로 채택하면 안 된다.
  it("returns null when the stamped messageImprint is not our digest", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = createRfc3161TimestampProvider(
      TSA_URL,
      respondingTsa(0, { hashHex: "11".repeat(32) }),
    );

    await expect(provider.stamp(HASH_HEX)).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("returns null when the response nonce does not echo the request nonce", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = createRfc3161TimestampProvider(
      TSA_URL,
      respondingTsa(0, { nonce: new Uint8Array([0x7f, 0x00, 0x00, 0x01]) }),
    );

    await expect(provider.stamp(HASH_HEX)).resolves.toBeNull();
  });

  it("returns null when the granted response carries no parsable timeStampToken", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchFn = vi.fn().mockResolvedValue(derResponse(statusOnlyTimeStampResp(0)));
    const provider = createRfc3161TimestampProvider(TSA_URL, fetchFn);

    await expect(provider.stamp(HASH_HEX)).resolves.toBeNull();
  });

  it("returns null (not throw) when fetch rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    const provider = createRfc3161TimestampProvider(TSA_URL, fetchFn);

    await expect(provider.stamp(HASH_HEX)).resolves.toBeNull();
  });

  it("returns null on a non-2xx response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchFn = vi.fn().mockResolvedValue(derResponse(statusOnlyTimeStampResp(0), 503));
    const provider = createRfc3161TimestampProvider(TSA_URL, fetchFn);

    await expect(provider.stamp(HASH_HEX)).resolves.toBeNull();
  });

  it("returns null on an invalid hash input instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchFn = vi.fn();
    const provider = createRfc3161TimestampProvider(TSA_URL, fetchFn);

    await expect(provider.stamp("not-a-hash")).resolves.toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns null on a malformed (non-DER) response body", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchFn = vi
      .fn()
      .mockResolvedValue(derResponse(new Uint8Array([0xde, 0xad, 0xbe, 0xef])));
    const provider = createRfc3161TimestampProvider(TSA_URL, fetchFn);

    await expect(provider.stamp(HASH_HEX)).resolves.toBeNull();
  });
});

describe("createNoopTimestampProvider", () => {
  it("always resolves null", async () => {
    const provider = createNoopTimestampProvider();

    await expect(provider.stamp(HASH_HEX)).resolves.toBeNull();
  });
});

describe("getTimestampProvider", () => {
  it("falls back to the noop provider when TSA_URL is not set", async () => {
    vi.stubEnv("TSA_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const provider = getTimestampProvider();
    const result = await provider.stamp(HASH_HEX);

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the RFC 3161 provider against TSA_URL when set", async () => {
    vi.stubEnv("TSA_URL", TSA_URL);
    const fetchMock = respondingTsa(0);
    vi.stubGlobal("fetch", fetchMock);

    const provider = getTimestampProvider();
    const result = await provider.stamp(HASH_HEX);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(TSA_URL);
    expect(result?.tsaUrl).toBe(TSA_URL);
  });
});
