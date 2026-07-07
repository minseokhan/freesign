import {
  REQUIRED_CONTRACT_CLAUSES,
  type ContractDraft,
} from "@/services/ai/contract-draft";

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
      body,
      plain_summary: draft.plain_summary,
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
