/**
 * 법적 고지 페이지(개인정보처리방침·이용약관·환불정책)와 푸터가 공유하는 상수.
 *
 * 값을 한 곳에 모은 이유: 사업자 등록·도메인 확정 후 **이 파일만 고치면** 3개 페이지와
 * 푸터가 동시에 갱신된다. 미기입 값은 LEGAL_TODO 접두사를 달아두고
 * listUnfilledLegalFields()로 감지한다(테스트가 이 상태를 박제한다).
 */

/** 아직 확정되지 않은 값의 표시. 화면에도 이 문자열이 그대로 노출돼 미기입을 숨기지 않는다. */
export const LEGAL_TODO = "[미기입]";

export const LEGAL = {
  serviceName: "FreeSign",
  operatorName: `${LEGAL_TODO} 상호(사업자 등록 후 기입)`,
  representative: `${LEGAL_TODO} 대표자명`,
  businessRegistrationNumber: `${LEGAL_TODO} 사업자등록번호`,
  mailOrderSalesNumber: `${LEGAL_TODO} 통신판매업 신고번호`,
  address: `${LEGAL_TODO} 사업장 주소`,
  contactEmail: `${LEGAL_TODO} 문의 이메일`,
  privacyOfficer: {
    name: `${LEGAL_TODO} 개인정보 보호책임자 성명`,
    email: `${LEGAL_TODO} 개인정보 보호책임자 연락처`,
  },
  privacyEffectiveDate: `${LEGAL_TODO} 시행일`,
  termsEffectiveDate: `${LEGAL_TODO} 시행일`,
  refundEffectiveDate: `${LEGAL_TODO} 시행일`,
} as const;

/**
 * placeholder가 남아 있는 필드 경로 목록.
 * 비어 있어야 결제(통신판매)를 켤 수 있다 — docs/LEGAL_ACCOUNT_PLAN.md 7절.
 */
export function listUnfilledLegalFields(): string[] {
  const unfilled: string[] = [];

  for (const [key, value] of Object.entries(LEGAL)) {
    if (typeof value === "string") {
      if (value.includes(LEGAL_TODO)) {
        unfilled.push(key);
      }
      continue;
    }

    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      if (nestedValue.includes(LEGAL_TODO)) {
        unfilled.push(`${key}.${nestedKey}`);
      }
    }
  }

  return unfilled;
}

export type CollectedDataEntry = {
  category: string;
  items: string;
  /** 수집 경로 — 어느 화면·기능에서 들어오는지. */
  source: string;
  note?: string;
};

/**
 * 실제로 저장하는 것만 적는다(허위 고지 방지). 각 항목은 스키마에 대응한다:
 * profiles / clients / signature_requests / contract_signatures / subscriptions / billing_events.
 */
export const COLLECTED_DATA: readonly CollectedDataEntry[] = [
  {
    category: "계정",
    items: "이메일 주소, 이름, Google 계정 식별자",
    source: "Google 계정으로 로그인할 때",
  },
  {
    category: "프로필",
    items:
      "표시 이름, 입금 계좌 정보(은행명·계좌번호·예금주), 기본 원천징수 유형",
    source: "설정 화면에서 이용자가 직접 입력",
  },
  {
    category: "이용자가 입력한 제3자 정보",
    items: "클라이언트의 이름, 이메일 주소, 전화번호, 메모",
    source: "이용자가 클라이언트를 등록할 때",
    note:
      "이 정보의 개인정보처리자는 이용자 본인이며, 서비스는 이용자를 대신해 보관·처리하는 수탁자의 지위에 있습니다. 이용자는 자신의 클라이언트로부터 필요한 동의를 받을 책임이 있습니다.",
  },
  {
    category: "전자서명",
    items:
      "서명 요청 수신자의 이메일·이름, 서명자의 이메일·이름, 서명 이미지, 동의 기록, 접속 기록(IP 주소·브라우저 정보)과 문서 해시·타임스탬프",
    source: "서명 요청 발송 및 서명 링크를 통한 서명 진행 시",
    note:
      "접속 기록과 해시는 서명의 진정성을 증명하기 위한 감사추적이며, 계약 기록의 일부로 보관됩니다.",
  },
  {
    category: "결제",
    items: "결제사(Polar) 고객·구독 식별자, 구독 상태 변경 이력",
    source: "유료 구독을 신청·변경·해지할 때",
    note:
      "카드번호 등 결제수단 정보는 결제사가 처리하며 서비스는 저장하지 않습니다.",
  },
  {
    category: "자동 수집",
    items: "서비스 이용 기록(페이지 조회·기능 사용 이벤트), 접속 로그, 오류 기록",
    source: "서비스 이용 과정에서 자동으로 생성",
  },
] as const;

export type DataProcessor = {
  name: string;
  purpose: string;
  items: string;
  country: string;
  retention: string;
};

/**
 * 처리위탁 및 국외 이전 대상(개인정보보호법 제26조·제28조의8).
 * 인프라가 전부 해외이므로 국외 이전 고지가 필수다. 목록은 package.json 의존성과
 * services/·lib/의 실제 호출 지점에 대응한다 — 새 외부 서비스를 붙이면 여기도 갱신할 것.
 */
export const DATA_PROCESSORS: readonly DataProcessor[] = [
  {
    name: "Supabase",
    purpose: "회원 인증, 데이터베이스 보관, 파일 저장",
    items: "계정·프로필·계약·인보이스·서명 기록 등 서비스 내 전체 데이터",
    country: "미국",
    retention: "회원 탈퇴 또는 위탁 계약 종료 시까지",
  },
  {
    name: "Vercel",
    purpose: "서비스 호스팅 및 접속 로그 처리",
    items: "접속 IP 주소, 요청 기록",
    country: "미국",
    retention: "위탁 계약 종료 시까지",
  },
  {
    name: "Anthropic",
    purpose: "계약서 초안 생성, 업로드한 계약 PDF 분석, 계약 인사이트 제공",
    items: "이용자가 입력하거나 업로드한 계약 내용",
    country: "미국",
    retention: "요청 처리 시점(별도 보관하지 않음)",
  },
  {
    name: "Resend",
    purpose: "서명 요청·완결 안내, 미수금 독촉 등 이메일 발송",
    items: "수신자 이메일 주소, 이름, 메일 본문",
    country: "미국",
    retention: "발송 처리 및 발송 이력 보관 기간",
  },
  {
    name: "Polar",
    purpose: "유료 구독 결제 및 구독 관리",
    items: "이메일 주소, 결제 및 구독 정보",
    country: "미국",
    retention: "위탁 계약 종료 시까지",
  },
  {
    name: "PostHog",
    purpose: "서비스 이용 분석 및 오류 추적",
    items: "이용자 식별자, 이용 기록, 오류 정보",
    country: "미국",
    retention: "위탁 계약 종료 시까지",
  },
  {
    name: "freeTSA.org",
    purpose: "전자서명 시점 확인을 위한 RFC 3161 타임스탬프 발급",
    items: "계약 문서의 해시값(문서 내용 자체는 전송되지 않음)",
    country: "독일",
    retention: "요청 처리 시점(별도 보관하지 않음)",
  },
] as const;
