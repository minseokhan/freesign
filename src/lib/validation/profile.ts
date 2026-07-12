import { z } from "zod";

import type { WithholdingType } from "@/lib/tax";
import { WITHHOLDING_TYPES } from "@/lib/validation/invoice";

const optionalTextSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().nullable().optional(),
);

export const profileInputSchema = z.object({
  display_name: optionalTextSchema,
  default_withholding_type: z.enum(WITHHOLDING_TYPES),
  bank_name: optionalTextSchema,
  bank_account_number: optionalTextSchema,
  bank_account_holder: optionalTextSchema,
});

export type ProfileInput = Omit<
  z.infer<typeof profileInputSchema>,
  "default_withholding_type"
> & {
  default_withholding_type: WithholdingType;
};
