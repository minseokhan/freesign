import {
  anthropicEnvSchema,
  parseAnthropicEnv,
  parsePublicEnv,
  parseServerEnv,
  parseTimestampEnv,
  publicEnvSchema,
  serverEnvSchema,
} from "@/lib/env";

const validEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  ANTHROPIC_API_KEY: "anthropic-key",
};

describe("env runtime validation", () => {
  it("parses valid public env values", () => {
    expect(parsePublicEnv(validEnv)).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: validEnv.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: validEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_SITE_URL: validEnv.NEXT_PUBLIC_SITE_URL,
    });
  });

  it("keeps service role and Claude keys out of the public schema", () => {
    expect(Object.keys(publicEnvSchema.shape)).not.toContain(
      "SUPABASE_SERVICE_ROLE_KEY",
    );
    expect(Object.keys(publicEnvSchema.shape)).not.toContain("ANTHROPIC_API_KEY");
  });

  it("parses Anthropic env without requiring the seed-only service role key", () => {
    expect(parseAnthropicEnv({ ANTHROPIC_API_KEY: validEnv.ANTHROPIC_API_KEY })).toEqual({
      ANTHROPIC_API_KEY: validEnv.ANTHROPIC_API_KEY,
    });
    expect(Object.keys(anthropicEnvSchema.shape)).not.toContain(
      "SUPABASE_SERVICE_ROLE_KEY",
    );
  });

  it("parses seed-only env values separately", () => {
    expect(parseServerEnv(validEnv)).toEqual({
      SUPABASE_SERVICE_ROLE_KEY: validEnv.SUPABASE_SERVICE_ROLE_KEY,
    });
    expect(Object.keys(serverEnvSchema.shape)).not.toContain(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
    expect(Object.keys(serverEnvSchema.shape)).not.toContain("ANTHROPIC_API_KEY");
  });

  it("throws a clear error for missing required env values", () => {
    expect(() =>
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: validEnv.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SITE_URL: validEnv.NEXT_PUBLIC_SITE_URL,
      }),
    ).toThrow(
      "Invalid public environment variables: NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  });

  it("throws a clear error for invalid URL values", () => {
    expect(() =>
      parsePublicEnv({
        ...validEnv,
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
      }),
    ).toThrow(
      "Invalid public environment variables: NEXT_PUBLIC_SUPABASE_URL",
    );
  });

  // 0040(#33): 평문 TSA는 중간자가 임의 타임스탬프를 증거로 심을 수 있다.
  it("rejects a non-https TSA_URL", () => {
    expect(parseTimestampEnv({ TSA_URL: "https://freetsa.org/tsr" })).toEqual({
      TSA_URL: "https://freetsa.org/tsr",
    });
    expect(parseTimestampEnv({})).toEqual({});
    expect(() => parseTimestampEnv({ TSA_URL: "http://freetsa.org/tsr" })).toThrow(
      /TSA_URL/,
    );
  });
});
