import { GENERIC_ACTION_ERROR } from "@/lib/action-error";

/**
 * 라우트 핸들러 응답용 일반 오류 문구(OWASP 스캔 A10 · 대시보드 #45).
 *
 * Server Action은 dbError()로 원본 메시지를 감추는데 API 라우트만 정책이 깨져
 * `error.message`(제약조건명·컬럼명·RPC RAISE 문구·RLS 힌트)를 그대로 내보내고 있었다.
 * 원문은 captureServerException·서버 로그로만 남기고 응답에는 이 문구만 쓴다.
 */
export const GENERIC_API_ERROR = GENERIC_ACTION_ERROR;
