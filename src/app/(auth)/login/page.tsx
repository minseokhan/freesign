import { redirect } from "next/navigation";

import { Logo } from "@/components/logo";
import { getPublicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = await searchParams;
  const hasOAuthError = resolvedSearchParams?.error === "oauth";

  async function signInWithGoogle() {
    "use server";

    const env = getPublicEnv();
    const supabase = await createClient();
    const redirectTo = new URL("/auth/callback", env.NEXT_PUBLIC_SITE_URL);
    let authUrl: string | null = null;

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectTo.toString(),
        },
      });

      if (!error) {
        authUrl = data.url;
      }
    } catch {
      authUrl = null;
    }

    if (!authUrl) {
      redirect("/login?error=oauth");
    }

    redirect(authUrl);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <section className="w-full max-w-sm rounded-[14px] border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_1px_3px_rgba(15,23,42,0.10)]">
        <div className="space-y-2">
          <Logo className="h-7" />
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            로그인
          </h1>
          <p className="text-sm leading-relaxed text-slate-600">
            Google 계정으로 계약과 정산 기록을 안전하게 관리하세요.
          </p>
        </div>

        <form action={signInWithGoogle} className="mt-6">
          <button
            type="submit"
            className="min-h-11 w-full rounded-[10px] bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 active:bg-blue-800"
          >
            Google로 계속하기
          </button>
        </form>
        {hasOAuthError ? (
          <p
            role="alert"
            className="mt-4 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm leading-relaxed text-red-700"
          >
            Google 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.
          </p>
        ) : null}
      </section>
    </main>
  );
}
