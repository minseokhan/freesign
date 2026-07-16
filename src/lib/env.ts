import { z } from "zod";

type EnvInput = Record<string, string | undefined>;

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
});

export const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export const anthropicEnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
});

export const emailEnvSchema = z.object({
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
});

export const timestampEnvSchema = z.object({
  TSA_URL: z.string().url().optional(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type AnthropicEnv = z.infer<typeof anthropicEnvSchema>;
export type EmailEnv = z.infer<typeof emailEnvSchema>;
export type TimestampEnv = z.infer<typeof timestampEnvSchema>;

function formatEnvError(scope: "public" | "server", error: z.ZodError) {
  const keys = error.issues
    .map((issue) => issue.path.join("."))
    .filter(Boolean)
    .join(", ");

  return `Invalid ${scope} environment variables: ${keys}`;
}

export function parsePublicEnv(env: EnvInput): PublicEnv {
  const result = publicEnvSchema.safeParse(env);

  if (!result.success) {
    throw new Error(formatEnvError("public", result.error));
  }

  return result.data;
}

export function parseServerEnv(env: EnvInput): ServerEnv {
  const result = serverEnvSchema.safeParse(env);

  if (!result.success) {
    throw new Error(formatEnvError("server", result.error));
  }

  return result.data;
}

export function parseAnthropicEnv(env: EnvInput): AnthropicEnv {
  const result = anthropicEnvSchema.safeParse(env);

  if (!result.success) {
    throw new Error(formatEnvError("server", result.error));
  }

  return result.data;
}

export function parseEmailEnv(env: EnvInput): EmailEnv {
  const result = emailEnvSchema.safeParse(env);

  if (!result.success) {
    throw new Error(formatEnvError("server", result.error));
  }

  return result.data;
}

export function parseTimestampEnv(env: EnvInput): TimestampEnv {
  const result = timestampEnvSchema.safeParse(env);

  if (!result.success) {
    throw new Error(formatEnvError("server", result.error));
  }

  return result.data;
}

export function getPublicEnv() {
  return parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  });
}

export function getServerEnv() {
  if (typeof window !== "undefined") {
    throw new Error("Server environment variables are not available in browser code.");
  }

  return parseServerEnv({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}

export function getAnthropicEnv() {
  if (typeof window !== "undefined") {
    throw new Error("Server environment variables are not available in browser code.");
  }

  return parseAnthropicEnv({
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  });
}

export function getEmailEnv() {
  if (typeof window !== "undefined") {
    throw new Error("Server environment variables are not available in browser code.");
  }

  // 빈 문자열은 미설정으로 취급(optional min(1) 스키마 위반 방지).
  return parseEmailEnv({
    RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
    EMAIL_FROM: process.env.EMAIL_FROM || undefined,
  });
}

export function getTimestampEnv() {
  if (typeof window !== "undefined") {
    throw new Error("Server environment variables are not available in browser code.");
  }

  // 빈 문자열은 미설정으로 취급 — TSA_URL 없음 = noop provider (기본 공용 TSA 자동 적용 안 함).
  return parseTimestampEnv({
    TSA_URL: process.env.TSA_URL || undefined,
  });
}
