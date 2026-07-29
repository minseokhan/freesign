import { notFound } from "next/navigation";

import { ContractInsightPanel } from "@/components/contract-insight-panel";
import { DunningReviewPanel } from "@/components/dunning-review-panel";
import { RecurringScheduleList } from "@/components/recurring-schedule-list";

// 요금제 페이지(`/billing`)에 넣을 Pro 기능 캡처를 만들기 위한 개발 전용 화면.
// 실제 Pro 컴포넌트를 예시 props로 렌더하므로, UI가 바뀌면 여기서 다시 캡처하면 된다.
// 캡처 방법: dev 서버에서 이 페이지를 열고 각 `#shot-*` 영역을 잘라 public/screenshots/pro/에 저장.
export default function ProPreviewPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <div className="min-h-screen bg-surface-page px-2xl py-2xl">
      <div className="mx-auto flex max-w-5xl flex-col gap-2xl">
        <div id="shot-recurring">
          <RecurringScheduleList
            schedules={[
              {
                id: "1",
                contractTitle: "루멘 스튜디오 브랜드 리테이너",
                clientName: "루멘 스튜디오",
                amount: 1500000,
                netAmount: 1450500,
                intervalKind: "monthly",
                nextRunAt: "2026-08-01",
                active: true,
              },
              {
                id: "2",
                contractTitle: "노드컴퍼니 콘텐츠 운영",
                clientName: "노드컴퍼니",
                amount: 800000,
                netAmount: 773600,
                intervalKind: "monthly",
                nextRunAt: "2026-08-15",
                active: true,
              },
              {
                id: "3",
                contractTitle: "브릿지랩 주간 데이터 리포트",
                clientName: "브릿지랩",
                amount: 600000,
                netAmount: 580200,
                intervalKind: "weekly",
                nextRunAt: "2026-08-07",
                active: false,
              },
            ]}
          />
        </div>

        <div id="shot-dunning" className="max-w-3xl">
          <DunningReviewPanel
            reminderId="preview"
            draftSubject="[루멘 스튜디오] 인보이스 INV-2026-014 입금 확인 요청"
            draftBody={
              "안녕하세요, 루멘 스튜디오 담당자님.\n\n" +
              "6월 30일이 지급기한이었던 인보이스 INV-2026-014(청구액 1,500,000원)의 입금이 아직 확인되지 않아 안내드립니다.\n" +
              "이미 처리하셨다면 이 메일은 무시해 주세요. 확인 후 회신 주시면 감사하겠습니다.\n\n" +
              "감사합니다.\n김하나 드림"
            }
            aiSource="ai"
          />
        </div>

        <div id="shot-insight" className="max-w-3xl">
          <ContractInsightPanel
            contractId="preview"
            initialInsight={{
              summary:
                "전반적으로 범위와 대금은 명확하지만, 지급 지연에 대한 보호 장치와 검수 기한이 비어 있습니다.",
              risk_level: "medium",
              findings: [
                {
                  clause_title: "대금 지급",
                  severity: "high",
                  note: "지급 지연 시 지연이자·중단 권리가 없어 미수금이 길어져도 대응 근거가 없습니다.",
                },
                {
                  clause_title: "검수 및 수정",
                  severity: "medium",
                  note: '검수 기한이 "협의 후"로만 적혀 있어 무기한 수정 요청으로 이어질 수 있습니다.',
                },
                {
                  clause_title: "저작권 귀속",
                  severity: "low",
                  note: "잔금 완납 시 이전으로 명시되어 있고 2차 활용 범위도 적혀 있습니다.",
                },
              ],
              source: "ai",
              createdAt: "2026-07-20T09:12:00+09:00",
            }}
          />
        </div>
      </div>
    </div>
  );
}
