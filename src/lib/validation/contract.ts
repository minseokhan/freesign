import { z } from "zod";

export const REQUIRED_CONTRACT_CLAUSES = [
  "당사자",
  "용역 범위",
  "계약 기간",
  "대금 및 지급",
  "검수 및 수정",
  "자료 제공 및 협조",
  "비밀유지",
  "지식재산권",
  "해지",
  "분쟁 해결",
] as const;

const dateSchema = z.string().trim().date();

const optionalDateSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  dateSchema.optional(),
);

export const contractDraftInputSchema = z
  .object({
    client_id: z.string().uuid(),
    scope: z.string().trim().min(1),
    amount: z.coerce.number().int().positive(),
    start_date: dateSchema,
    end_date: dateSchema,
    due_date: optionalDateSchema,
  })
  .refine((value) => value.end_date >= value.start_date, {
    message: "종료일은 시작일보다 빠를 수 없습니다.",
    path: ["end_date"],
  });

export type ContractDraftInput = z.infer<typeof contractDraftInputSchema>;

export const contractClauseSchema = z.object({
  title: z.string().trim().min(1),
  body: z.string().trim().min(1),
  plain_summary: z.string().trim().min(1),
  needs_review: z.boolean(),
});

export const contractClausesSchema = z
  .array(contractClauseSchema)
  .min(REQUIRED_CONTRACT_CLAUSES.length)
  .superRefine((clauses, context) => {
    const titles = new Set(clauses.map((clause) => clause.title));

    REQUIRED_CONTRACT_CLAUSES.forEach((requiredTitle) => {
      if (!titles.has(requiredTitle)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `필수 조항이 누락되었습니다: ${requiredTitle}`,
        });
      }
    });
  });

export const contractClausesInputSchema = z.object({
  clauses: contractClausesSchema,
});

export type ContractClauseInput = z.infer<typeof contractClauseSchema>;
export type ContractClausesInput = z.infer<typeof contractClausesInputSchema>;
