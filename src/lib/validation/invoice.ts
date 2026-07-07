import { z } from "zod";

import type { WithholdingType } from "@/lib/tax";

export const WITHHOLDING_TYPES = ["wt_3_3", "wt_8_8", "none"] as const;

const dateSchema = z.string().trim().date();

export const invoiceInputSchema = z
  .object({
    contract_id: z.string().uuid(),
    amount: z.coerce.number().int().positive(),
    issue_date: dateSchema,
    due_date: dateSchema,
    withholding_type: z.enum(WITHHOLDING_TYPES),
  })
  .refine((value) => value.due_date >= value.issue_date, {
    message: "지급기한은 발행일보다 빠를 수 없습니다.",
    path: ["due_date"],
  });

export type InvoiceInput = Omit<
  z.infer<typeof invoiceInputSchema>,
  "withholding_type"
> & {
  withholding_type: WithholdingType;
};
