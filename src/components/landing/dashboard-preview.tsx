import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

/**
 * 랜딩용 대시보드 목업. 실데이터가 아니며 실제 대시보드와 동일한
 * 카드/배지/테이블 토큰을 재사용한 정적 미리보기. 장식 요소로 처리한다.
 */
export function DashboardPreview() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none select-none space-y-lg"
    >
      <div className="grid grid-cols-2 gap-lg">
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            미수금 합계
          </p>
          <p className="mt-md text-3xl font-bold tracking-tight text-red-700 tabular-nums">
            ₩3,200,000
          </p>
          <p className="mt-sm text-xs text-text-muted">미입금 인보이스 4건</p>
        </Card>
        <Card>
          <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
            이달 수익
          </p>
          <p className="mt-md text-3xl font-bold tracking-tight text-green-700 tabular-nums">
            ₩5,850,000
          </p>
          <p className="mt-sm text-xs text-text-muted">입금 완료 6건</p>
        </Card>
      </div>

      <Card className="p-0">
        <div className="border-b border-surface-border px-xl py-lg">
          <h3 className="text-lg font-semibold text-text-primary">
            임박/지연 지급기한
          </h3>
        </div>
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-surface-muted text-xs font-medium uppercase tracking-wide text-text-muted">
            <tr>
              <th className="px-xl py-md">클라이언트</th>
              <th className="px-xl py-md text-right">금액</th>
              <th className="px-xl py-md">상태</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            <tr>
              <td className="px-xl py-lg text-text-body">브랜드A 마케팅</td>
              <td className="px-xl py-lg text-right font-medium tabular-nums text-text-primary">
                ₩1,200,000
              </td>
              <td className="px-xl py-lg">
                <Badge variant="danger">지연</Badge>
              </td>
            </tr>
            <tr>
              <td className="px-xl py-lg text-text-body">스타트업B 외주</td>
              <td className="px-xl py-lg text-right font-medium tabular-nums text-text-primary">
                ₩800,000
              </td>
              <td className="px-xl py-lg">
                <Badge variant="warning">임박</Badge>
              </td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
