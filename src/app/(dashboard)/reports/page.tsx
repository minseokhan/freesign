import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function ReportsPage() {
  return (
    <Card className="flex min-h-80 flex-col items-center justify-center gap-lg text-center">
      <div aria-hidden="true" className="text-3xl font-semibold text-blue-600">
        FS
      </div>
      <div>
        <h2 className="text-lg font-semibold text-text-primary">
          아직 리포트 데이터가 없어요
        </h2>
        <p className="mt-sm text-sm leading-relaxed text-text-muted">
          입금 기록이 쌓이면 채널별 수익 리포트를 보여줍니다.
        </p>
      </div>
      <Button disabled>CSV 내보내기</Button>
    </Card>
  );
}
