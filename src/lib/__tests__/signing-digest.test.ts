// @vitest-environment node
import { describe, expect, it } from "vitest";

import { computeCompletionDigest } from "@/lib/signing-digest";

const DOC_HASH = "a".repeat(64);
const IMAGE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
const IMAGE_DATA_URL = `data:image/png;base64,${IMAGE_BASE64}`;

// sha256( utf8(docHash) ∥ utf8(hex(sha256(base64 디코드 바이트))) ) 정의의 골든 값.
const EXPECTED_DIGEST =
  "e3da58e136fcf9323c0e9cf9e8bf3e24a88cf08809afb7d5c77f97141395eb32";

describe("computeCompletionDigest", () => {
  it("produces a deterministic digest for fixed inputs", () => {
    expect(computeCompletionDigest(DOC_HASH, IMAGE_DATA_URL)).toBe(
      EXPECTED_DIGEST,
    );
    expect(computeCompletionDigest(DOC_HASH, IMAGE_DATA_URL)).toBe(
      EXPECTED_DIGEST,
    );
  });

  it("accepts either a PNG data URL or the raw base64 payload", () => {
    expect(computeCompletionDigest(DOC_HASH, IMAGE_BASE64)).toBe(
      computeCompletionDigest(DOC_HASH, IMAGE_DATA_URL),
    );
  });

  it("changes when the document hash or the image changes", () => {
    expect(computeCompletionDigest("b".repeat(64), IMAGE_DATA_URL)).not.toBe(
      EXPECTED_DIGEST,
    );
    expect(
      computeCompletionDigest(DOC_HASH, "data:image/png;base64,QUJD"),
    ).not.toBe(EXPECTED_DIGEST);
  });

  it("returns a 64-character hex digest usable as a TSA message imprint", () => {
    expect(computeCompletionDigest(DOC_HASH, IMAGE_DATA_URL)).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
