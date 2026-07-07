import { z } from "zod";

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
