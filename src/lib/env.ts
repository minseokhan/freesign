import { z } from "zod";

type EnvInput = Record<string, string | undefined>;

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
});

export const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

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
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  });
}
