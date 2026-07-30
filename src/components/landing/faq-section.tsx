import { PRO_PRICE_KRW } from "@/lib/plan-features";
import { formatKRW } from "@/lib/metrics";

export type FaqItem = {
  question: string;
  answer: string;
};

/** 화면 문답과 FAQPage JSON-LD가 어긋나지 않도록 이 배열을 양쪽에서 함께 쓴다. */
export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: "FreeSign으로 한 서명도 법적 효력이 있나요?",
    answer:
      "전자서명법은 당사자가 약정한 전자서명에 서명의 효력을 인정합니다. FreeSign은 그 근거가 되는 증거를 남깁니다. 발송 시점의 원문 해시 동결, 상대방의 명시적 동의 캡처, 서명 시각·IP 기록, RFC 3161 타임스탬프, 완결증명서 PDF가 그것입니다. 다만 이는 법률 자문이 아니며, 분쟁 가능성이 큰 계약은 전문가 검토를 권장합니다.",
  },
  {
    question: "상대방(발주처)도 가입해야 하나요?",
    answer:
      "아니요. 상대방은 메일로 받은 링크에서 로그인 없이 서명합니다. 서명이 끝나면 계약서 PDF와 완결증명서 PDF가 양측 메일함으로 발송되므로, 상대방은 FreeSign에 접속하지 않고도 사본을 보관할 수 있습니다.",
  },
  {
    question: "AI가 쓴 계약서를 그대로 써도 되나요?",
    answer:
      "AI 결과물은 항상 '초안'으로 표시되고 조항마다 쉬운 말 요약이 붙습니다. 확인이 필요한 조항은 따로 표시되니 검토 후 확정하세요. AI 호출이 실패해도 기본 골격 계약서로 폴백되므로 작업이 막히지 않습니다.",
  },
  {
    question: "원천징수 계산은 믿어도 되나요?",
    answer:
      "3.3%(사업소득)와 8.8%(기타소득) 유형을 고르면 소득세·지방소득세·실지급액을 원 단위로 계산해 인보이스와 PDF에 반영합니다. 종합소득세 신고 자체를 대신하지는 않으며, 리포트의 Excel 파일을 세무 대리인에게 전달하는 용도로 설계했습니다.",
  },
  {
    question: "무료로 어디까지 쓸 수 있나요?",
    answer:
      "Free 플랜으로 계약 1건을 작성해 서명 요청까지 보내고, 인보이스 발행·입금 관리·PDF 발행·대시보드를 제한 없이 쓸 수 있습니다. 클라이언트와 인보이스 개수 제한도 없습니다. 계약을 계속 만들거나 반복 청구·미수금 독촉 자동화가 필요해지면 그때 Pro로 올리면 됩니다.",
  },
  {
    question: "Pro는 얼마인가요? 해지하면 데이터는 어떻게 되나요?",
    answer: `Pro는 월 ${formatKRW(PRO_PRICE_KRW)}이고 언제든 해지할 수 있습니다. 해지해도 계약·인보이스·입금 기록은 삭제되지 않고, 남은 결제 기간까지는 Pro 기능을 그대로 쓸 수 있습니다. 기간이 끝나면 Free 기능으로 계속 열람합니다.`,
  },
];

export function FaqSection() {
  return (
    <section aria-labelledby="faq-heading" className="space-y-2xl">
      <div className="max-w-2xl">
        <h2
          id="faq-heading"
          className="text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl"
        >
          자주 묻는 질문
        </h2>
      </div>

      <div className="divide-y divide-surface-border border-y border-surface-border">
        {FAQ_ITEMS.map((item) => (
          <details key={item.question} className="group py-lg">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-lg text-left text-base font-medium text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2">
              {item.question}
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="none"
                className="size-5 shrink-0 text-text-muted transition-transform group-open:rotate-180"
              >
                <path
                  d="m5 8 5 5 5-5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </summary>
            <p className="mt-md max-w-3xl text-sm leading-relaxed text-text-body">
              {item.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
