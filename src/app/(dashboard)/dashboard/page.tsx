import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <Card className="flex min-h-80 flex-col items-center justify-center gap-lg text-center">
      <div aria-hidden="true" className="text-3xl font-semibold text-blue-600">
        FS
      </div>
      <div>
        <h2 className="text-lg font-semibold text-text-primary">
          아직 대시보드 데이터가 없어요
        </h2>
        <p className="mt-sm text-sm leading-relaxed text-text-muted">
          계약과 인보이스 기능이 연결되면 미수금과 이달 수익을 보여줍니다.
        </p>
      </div>
      <Button disabled>데모 데이터 채우기</Button>
    </Card>
  );
}
