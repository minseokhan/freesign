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
  // dev/E2E 전용 아웃박스 파일 경로. 설정 시 실발송 대신 이 파일에 적재한다.
  EMAIL_OUTBOX_FILE: z.string().min(1).optional(),
});

export const timestampEnvSchema = z.object({
  // https만 허용 — 평문 TSA는 중간자가 임의 타임스탬프 응답을 증거로 심을 수 있다.
  TSA_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("https://"), {
      message: "TSA_URL must use https",
    })
    .optional(),
});

export const cronEnvSchema = z.object({
  CRON_SECRET: z.string().min(1),
});

export const polarEnvSchema = z.object({
  POLAR_ACCESS_TOKEN: z.string().min(1),
  POLAR_WEBHOOK_SECRET: z.string().min(1),
  POLAR_PRODUCT_ID: z.string().min(1),
  POLAR_SERVER: z.enum(["sandbox", "production"]).default("sandbox"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type AnthropicEnv = z.infer<typeof anthropicEnvSchema>;
export type EmailEnv = z.infer<typeof emailEnvSchema>;
export type TimestampEnv = z.infer<typeof timestampEnvSchema>;
export type PolarEnv = z.infer<typeof polarEnvSchema>;
export type CronEnv = z.infer<typeof cronEnvSchema>;

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

export function parsePolarEnv(env: EnvInput): PolarEnv {
  const result = polarEnvSchema.safeParse(env);

  if (!result.success) {
    throw new Error(formatEnvError("server", result.error));
  }

  return result.data;
}

export function parseCronEnv(env: EnvInput): CronEnv {
  const result = cronEnvSchema.safeParse(env);

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
    EMAIL_OUTBOX_FILE: process.env.EMAIL_OUTBOX_FILE || undefined,
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

// 결제 미구성(Polar env 없음)은 요청 오류가 아니라 배포 상태다. getPolarEnv()는 필수 스키마라
// 미설정이면 던지므로, 호출부가 500 대신 안내로 되돌릴 수 있도록 먼저 판별한다.
// POLAR_SERVER는 기본값이 있어 필수에서 제외한다.
export function isPolarConfigured(): boolean {
  return Boolean(
    process.env.POLAR_ACCESS_TOKEN &&
      process.env.POLAR_WEBHOOK_SECRET &&
      process.env.POLAR_PRODUCT_ID,
  );
}

export function getPolarEnv() {
  if (typeof window !== "undefined") {
    throw new Error("Server environment variables are not available in browser code.");
  }

  return parsePolarEnv({
    POLAR_ACCESS_TOKEN: process.env.POLAR_ACCESS_TOKEN,
    POLAR_WEBHOOK_SECRET: process.env.POLAR_WEBHOOK_SECRET,
    POLAR_PRODUCT_ID: process.env.POLAR_PRODUCT_ID,
    POLAR_SERVER: process.env.POLAR_SERVER || undefined,
  });
}

export function getCronEnv() {
  if (typeof window !== "undefined") {
    throw new Error("Server environment variables are not available in browser code.");
  }

  return parseCronEnv({
    CRON_SECRET: process.env.CRON_SECRET,
  });
}
