import type { Database } from "@/types/database";

/** 생성 타입에서 뽑는다 — 없는 테이블을 적으면 컴파일에서 걸린다. */
export type ExportTableName = keyof Database["public"]["Tables"];

export type ExportTableSpec = {
  table: ExportTableName;
  /** 내보내면 안 되는 컬럼. 비밀값이거나 이동권 취지와 무관한 대용량 바이너리. */
  omit: readonly string[];
};

/**
 * 계정 데이터 내보내기 대상. RLS가 본인 행으로 스코프하므로 별도 user_id 필터는 두지 않는다.
 * soft-delete된 행도 포함한다 — 서비스가 아직 보관 중인 데이터이므로 열람권 대상이다.
 */
export const EXPORT_TABLES: readonly ExportTableSpec[] = [
  { table: "profiles", omit: [] },
  { table: "clients", omit: [] },
  { table: "contracts", omit: [] },
  { table: "contract_events", omit: [] },
  { table: "invoices", omit: [] },
  { table: "invoice_events", omit: [] },
  {
    table: "signature_requests",
    // 토큰 해시가 나가면 서명 링크 검증 경계가 약해진다. TSA 토큰은 증명서 발급용 원문.
    omit: ["token_hash", "sent_tsa_token", "completion_tsa_token"],
  },
  // 서명 이미지 원본은 최대 256KB × N이라 JSON에 담지 않는다(경로는 남긴다).
  { table: "contract_signatures", omit: ["signature_image_data"] },
  { table: "recurring_invoices", omit: [] },
  { table: "dunning_reminders", omit: [] },
  { table: "contract_insights", omit: [] },
  { table: "subscriptions", omit: [] },
  { table: "billing_events", omit: [] },
] as const;

export function stripColumns(
  rows: unknown[],
  omit: readonly string[],
): Record<string, unknown>[] {
  if (omit.length === 0) {
    return rows as Record<string, unknown>[];
  }

  return rows.map((row) => {
    const copy = { ...(row as Record<string, unknown>) };

    for (const column of omit) {
      delete copy[column];
    }

    return copy;
  });
}
