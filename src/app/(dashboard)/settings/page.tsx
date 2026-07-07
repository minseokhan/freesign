import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <Card className="flex min-h-80 flex-col items-center justify-center gap-lg text-center">
      <div aria-hidden="true" className="text-3xl font-semibold text-blue-600">
        FS
      </div>
      <div>
        <h2 className="text-lg font-semibold text-text-primary">
          설정 화면 준비 중이에요
        </h2>
        <p className="mt-sm text-sm leading-relaxed text-text-muted">
          프로필과 기본 원천징수율 설정은 이후 단계에서 연결됩니다.
        </p>
      </div>
      <Button disabled>설정 저장</Button>
    </Card>
  );
}
