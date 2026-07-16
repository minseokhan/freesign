import { createHash } from "node:crypto";

/**
 * 완결 시점 TSA 결합 다이제스트(SIGNATURE_V2_PLAN Step 4-2):
 * sha256( utf8(doc_hash) ∥ utf8(hex(sha256(서명 이미지 base64 디코드 바이트))) )
 * — "이 시점에 이 계약 내용과 이 상대 서명이 함께 존재했다"를 하나의 지문으로 묶는다.
 * 입력은 PNG data URL 또는 raw base64 payload 어느 쪽이든 같은 결과를 낸다.
 */
export function computeCompletionDigest(
  docHash: string,
  signatureImage: string,
): string {
  const base64 = signatureImage.replace(/^data:image\/png;base64,/, "");
  const imageHash = createHash("sha256")
    .update(Buffer.from(base64, "base64"))
    .digest("hex");

  return createHash("sha256")
    .update(docHash, "utf8")
    .update(imageHash, "utf8")
    .digest("hex");
}
