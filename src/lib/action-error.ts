export const GENERIC_ACTION_ERROR = "요청을 처리하지 못했습니다.";

/**
 * Server Action에서 DB/예상치 못한 오류를 클라이언트에 돌려줄 때 사용한다.
 *
 * Postgres/PostgREST 원본 메시지(제약조건·컬럼명·RPC RAISE 텍스트·RLS 위반 힌트)는
 * 스키마 내부 구조를 노출하므로 클라이언트에 담지 않는다. 상세는 서버 로그로만 남기고,
 * 응답에는 고정된 일반 메시지만 반환한다. 사용자가 조치 가능한 입력 검증 오류는
 * 각 액션의 validationError로 별도 처리한다.
 */
export function dbError(
  error?: { message?: string } | null,
): { ok: false; error: string } {
  if (error?.message) {
    console.error("[action] db error:", error.message);
  }

  return { ok: false, error: GENERIC_ACTION_ERROR };
}
