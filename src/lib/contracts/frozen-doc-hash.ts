// server-only: 문서 지문 계산이 node crypto를 쓴다(services/signature/provider).
import { createV1SignatureProvider } from "@/services/signature/provider";

/**
 * 발송 시점에 동결한 문서 지문이 지금의 계약 본문과 실제로 일치하는지.
 *
 * `doc_hash`는 발송 RPC(`send_signature_request_with_event`)의 파라미터다. Server Action은
 * 서버에서 계산해 넣지만, RPC 자체가 `authenticated`에 열려 있어 소유자가 PostgREST로 직접
 * 호출하면 본문과 무관한 지문을 동결할 수 있다. 그러면 증명서에는 실제로 서명된 문서가 아닌
 * 다른 문서의 지문이 박힌다.
 *
 * 상대방이 서명하기 전 이 함수로 걸러 위조된 지문이 증거로 굳는 것을 막는다.
 * 판단할 수 없는 입력(지문 없음·조항이 배열이 아님)은 통과가 아니라 거부다.
 */
export function isFrozenDocHashIntact(
  clauses: unknown,
  frozenDocHash: string | null | undefined,
): boolean {
  if (!frozenDocHash || !Array.isArray(clauses)) {
    return false;
  }

  const computed = createV1SignatureProvider().computeDocHash(
    clauses as Record<string, unknown>[],
  );

  return computed === frozenDocHash;
}
