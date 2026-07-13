import type { Database } from "@/types/database";

// 계약을 물리 삭제하면 인보이스의 contract_id가 NULL이 되고, 삭제 시점의 계약 핵심
// 정보가 contract_snapshot(jsonb)에 남는다. 인보이스 화면은 살아있는 계약이면 조인
// 제목을, 삭제된 계약이면 스냅샷 제목을 자기설명적으로 보여준다.

type ContractSnapshotValue =
  Database["public"]["Tables"]["invoices"]["Row"]["contract_snapshot"];

export type ContractSnapshot = {
  title: string;
  amount: number;
  start_date: string;
  end_date: string;
};

export function parseContractSnapshot(
  value: ContractSnapshotValue,
): ContractSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.title !== "string") {
    return null;
  }

  return {
    title: record.title,
    amount: typeof record.amount === "number" ? record.amount : 0,
    start_date: typeof record.start_date === "string" ? record.start_date : "",
    end_date: typeof record.end_date === "string" ? record.end_date : "",
  };
}

// 조인된 계약이 있으면 그 제목을, 삭제됐으면 스냅샷 제목을 "삭제된 계약: …"로,
// 둘 다 없으면 최종 폴백을 반환한다.
export function resolveContractLabel(
  contract: { title: string } | null,
  snapshot: ContractSnapshotValue,
): string {
  if (contract) {
    return contract.title;
  }

  const parsed = parseContractSnapshot(snapshot);

  if (parsed) {
    return `삭제된 계약: ${parsed.title}`;
  }

  return "계약 없음";
}
