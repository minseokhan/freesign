import { z } from "zod";

export const CLIENT_CHANNELS = [
  "linkedin",
  "instagram",
  "youtube",
  "direct",
  "kmong",
  "referral",
  "other",
] as const;

const optionalTextSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().nullable().optional(),
);

const optionalEmailSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().email().nullable().optional(),
);

export const clientInputSchema = z.object({
  name: z.string().trim().min(1),
  channel: z.enum(CLIENT_CHANNELS),
  contact_email: optionalEmailSchema,
  contact_phone: optionalTextSchema,
  memo: optionalTextSchema,
});

export type ClientInput = z.infer<typeof clientInputSchema>;
