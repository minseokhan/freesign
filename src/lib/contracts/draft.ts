import {
  REQUIRED_CONTRACT_CLAUSES,
  type ContractDraft,
} from "@/services/ai/contract-draft";
import type { ContractClauseInput } from "@/lib/validation/contract";

export type ContractClauseDraft = {
  title: string;
  body: string;
  plain_summary: string;
  needs_review: boolean;
  source: ContractDraft["source"];
};

export type ContractDraftPreview = ContractDraft & {
  clauses: ContractClauseDraft[];
};

export function toContractClauses(draft: ContractDraft): ContractClauseDraft[] {
  return REQUIRED_CONTRACT_CLAUSES.map((title) => {
    const body = extractClauseBody(draft.body, title);

    return {
      title,
      // 계약 전체 평문요약은 계약 레벨(contracts.plain_summary)에서 1회만 노출한다.
      // 조항마다 동일 요약을 복제하지 않는다(불러오기 계약은 조항별 요약을 별도로 채운다).
      body,
      plain_summary: "",
      needs_review: draft.needs_review || body.includes("[검토 필요]"),
      source: draft.source,
    };
  });
}

export function toContractDraftPreview(
  draft: ContractDraft,
): ContractDraftPreview {
  return {
    ...draft,
    clauses: toContractClauses(draft),
  };
}

export function normalizeImportedClauses(raw: unknown): ContractClauseInput[] {
  const candidates = Array.isArray(raw) ? raw : [];

  return REQUIRED_CONTRACT_CLAUSES.map((title) => {
    const matched = candidates.find(
      (candidate) =>
        isRecord(candidate) &&
        typeof candidate.title === "string" &&
        candidate.title.trim() === title,
    );

    if (!isRecord(matched)) {
      return buildNeedsReviewClause(title);
    }

    const body =
      typeof matched.body === "string" ? matched.body.trim() : "";
    const plainSummary =
      typeof matched.plain_summary === "string"
        ? matched.plain_summary.trim()
        : "";
    const hasEmptyText = body.length === 0 || plainSummary.length === 0;

    return {
      title,
      body: body || "[검토 필요]",
      plain_summary: plainSummary || "[검토 필요]",
      needs_review:
        matched.needs_review === true ||
        hasEmptyText ||
        body.includes("[검토 필요]") ||
        plainSummary.includes("[검토 필요]"),
    };
  });
}

function extractClauseBody(body: string, title: string) {
  const escapedTitle = escapeRegExp(title);
  const pattern = new RegExp(
    `(?:^|\\n\\n)\\d+\\.\\s*${escapedTitle}\\n([\\s\\S]*?)(?=\\n\\n\\d+\\.|$)`,
  );
  const match = body.match(pattern);

  if (!match?.[1]?.trim()) {
    return body;
  }

  return match[1].trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildNeedsReviewClause(title: string): ContractClauseInput {
  return {
    title,
    body: "[검토 필요]",
    plain_summary: "[검토 필요]",
    needs_review: true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
