import Link from "next/link";

import { DashboardPreview } from "@/components/landing/dashboard-preview";
import { FeatureSection } from "@/components/landing/feature-section";
import { FlowWalkthrough } from "@/components/landing/flow-walkthrough";
import { LandingHeader } from "@/components/landing/landing-header";
import { buttonBaseClass, buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAuthenticated = Boolean(user);
  const cta = isAuthenticated
    ? { href: "/dashboard", label: "대시보드로 이동" }
    : { href: "/login", label: "무료로 시작하기" };

  return (
    <div className="min-h-screen bg-surface-page">
      <LandingHeader isAuthenticated={isAuthenticated} />

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl gap-2xl px-lg py-3xl lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-sm font-medium text-brand-primary">
              프리랜서를 위한 올인원 정산
            </p>
            <h1 className="mt-md text-4xl font-bold leading-tight tracking-tight text-text-primary sm:text-5xl">
              계약부터 입금·세금까지,
              <br />
              하나의 흐름으로
            </h1>
            <p className="mt-lg max-w-md text-base leading-relaxed text-text-body">
              계약 → 서명 → 청구 → 입금 → 세금 정리. FreeSign은 흩어진 정산
              과정을 하나의 기록 체인으로 묶어, 내 돈이 어디까지 왔는지 3초 안에
              보여줍니다.
            </p>
            <div className="mt-xl flex flex-wrap items-center gap-md">
              <Link
                href={cta.href}
                className={cn(buttonBaseClass, buttonVariants.primary)}
              >
                {cta.label}
              </Link>
              <span className="text-xs text-text-muted">
                Google 계정으로 30초 만에 시작
              </span>
            </div>
          </div>
          <DashboardPreview />
        </section>

        {/* Interactive flow walkthrough */}
        <section className="border-t border-surface-border bg-white">
          <div className="mx-auto max-w-6xl px-lg py-3xl">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl">
                정산의 모든 단계를 한 곳에서
              </h2>
              <p className="mt-md text-sm leading-relaxed text-text-body sm:text-base">
                각 단계를 눌러 FreeSign이 어떻게 흐름을 이어주는지 확인해
                보세요.
              </p>
            </div>
            <div className="mt-2xl">
              <FlowWalkthrough />
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="mx-auto max-w-6xl px-lg py-3xl">
          <FeatureSection />
        </section>

        {/* Closing CTA */}
        <section className="border-t border-surface-border bg-white">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-lg px-lg py-3xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl">
              지금 바로 정산을 정리하세요
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-text-body">
              데모 데이터로 먼저 둘러보고, 준비되면 실제 계약을 시작할 수
              있습니다.
            </p>
            <Link
              href={cta.href}
              className={cn(buttonBaseClass, buttonVariants.primary)}
            >
              {cta.label}
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-surface-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-sm px-lg py-xl text-xs text-text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 FreeSign</span>
          <span>계약 초안·원천징수 계산은 참고용이며 법적 자문이 아닙니다.</span>
        </div>
      </footer>
    </div>
  );
}
