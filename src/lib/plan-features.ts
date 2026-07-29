// 요금제 상수·문구의 단일 출처. 앱 내부(`/billing`)와 공개 랜딩이 같은 목록을 쓴다.
// 서버 의존(next/headers 등)이 없어야 어디서든 읽을 수 있으므로 순수 상수만 둔다.

// ── 무료 티어 상한 (게이트는 plan.ts가 이 값으로 판정한다) ──
export const IMPORT_FREE_LIMIT = 5; // 불러오기 AI 파싱 누적 5회
export const CREATE_FREE_LIMIT = 1; // 새 계약 생성 1건
export const SIGN_FREE_LIMIT = 1; // 쌍방 서명 발송 1건(새 계약 1건에 딸림)

/** 기능 비교 목록. 상한 문구는 위 상수에서 파생시켜 게이트와 어긋나지 않게 한다. */
export const FREE_FEATURES = [
  "클라이언트·인보이스 관리 무제한",
  `새 계약 작성 ${CREATE_FREE_LIMIT}건`,
  `서명 요청 발송 ${SIGN_FREE_LIMIT}건`,
  `기존 계약 불러오기(AI 파싱) 누적 ${IMPORT_FREE_LIMIT}회`,
  "미수금·이달 수익 대시보드",
  "계약서·인보이스 PDF 발행",
] as const;

export const PRO_FEATURES = [
  "새 계약 작성·서명 요청 무제한",
  "기존 계약 불러오기(AI 파싱) 무제한",
  "반복 인보이스 자동 초안",
  "미수금 자동 독촉 메일 초안",
  "AI 계약 인사이트",
  "채널 수익 TOP·클라이언트별 수익 분석",
  "세금 신고용 Excel 내보내기",
] as const;

/** Pro 월 구독료(원). 실제 청구는 Polar 체크아웃에서 확정된다. */
export const PRO_PRICE_KRW = 14900;
