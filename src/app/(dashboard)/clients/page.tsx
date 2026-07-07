import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function ClientsPage() {
  return (
    <Card className="flex min-h-80 flex-col items-center justify-center gap-lg text-center">
      <div aria-hidden="true" className="text-3xl font-semibold text-blue-600">
        FS
      </div>
      <div>
        <h2 className="text-lg font-semibold text-text-primary">
          아직 클라이언트가 없어요
        </h2>
        <p className="mt-sm text-sm leading-relaxed text-text-muted">
          클라이언트 등록 기능은 이후 단계에서 연결됩니다.
        </p>
      </div>
      <Button disabled>클라이언트 만들기</Button>
    </Card>
  );
}
