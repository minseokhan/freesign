"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function DashboardError({ reset }: { reset: () => void }) {
  return (
    <Card className="flex min-h-80 flex-col items-center justify-center gap-lg text-center">
      <div aria-hidden="true" className="text-3xl font-semibold text-red-600">
        !
      </div>
      <div>
        <h2 className="text-lg font-semibold text-text-primary">
          화면을 불러오지 못했어요
        </h2>
        <p className="mt-sm text-sm leading-relaxed text-text-muted">
          잠시 후 다시 시도해 주세요.
        </p>
      </div>
      <Button onClick={reset}>다시 시도</Button>
    </Card>
  );
}
