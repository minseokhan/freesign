"use client";

import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { formatKRW } from "@/lib/metrics";
import { cn } from "@/lib/utils";

type PreviewInvoice = {
  id: string;
  client: string;
  memo: string;
  amount: number;
  variant: "danger" | "warning";
  dueLabel: string;
};

const INVOICES: readonly PreviewInvoice[] = [
  {
    id: "INV-018",
    client: "노드컴퍼니",
    memo: "랜딩 리뉴얼 2차",
    amount: 800_000,
    variant: "danger",
    dueLabel: "3일 지연",
  },
  {
    id: "INV-021",
    client: "무디",
    memo: "브랜드 필름 편집",
    amount: 2_400_000,
    variant: "warning",
    dueLabel: "D-2",
  },
];

/** 데모 시작 시점에 이미 입금된 이달 수익(2건). 여기에 입금 확인분이 더해진다. */
const BASE_REVENUE = 4_351_500;
const BASE_PAID_COUNT = 2;
const STEP_MS = 2600;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return reduced;
}

/** 금액이 바뀔 때 이전 값에서 새 값까지 굴러가게 한다(모션 축소 시 즉시 반영). */
function useCountUp(target: number, animate: boolean) {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    const from = displayRef.current;
    if (!animate || from === target) {
      setDisplay(target);
      return;
    }

    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const progress = Math.min(1, (now - start) / 520);
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(Math.round(from + (target - from) * eased));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [target, animate]);

  return display;
}

function StatTile({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: number;
  caption: string;
  tone: "danger" | "success";
}) {
  return (
    <div className="rounded-md border border-surface-border bg-surface-page p-lg">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
        {label}
      </p>
      <p
        className={cn(
          "mt-sm text-2xl font-bold tracking-tight tabular-nums transition-colors duration-500 sm:text-3xl",
          tone === "danger" ? "text-red-700" : "text-green-700",
        )}
      >
        {formatKRW(value)}
      </p>
      <p className="mt-xs text-xs text-text-muted">{caption}</p>
    </div>
  );
}

/**
 * 히어로용 인터랙티브 데모. 실데이터가 아니라 대시보드를 본뜬 목업이며,
 * "입금 확인"을 누르면(또는 자동 재생이 진행되면) 미수금이 줄고 이달 수익이
 * 늘어나는 흐름을 그 자리에서 보여 준다. 포인터·포커스가 올라와 있는 동안에는
 * 자동 재생을 멈추고, 사용자가 한 번이라도 직접 누르면 그 결과를 지키기 위해
 * 자동 재생을 아예 끈다.
 */
export function DashboardPreview() {
  const reducedMotion = usePrefersReducedMotion();
  const [paidIds, setPaidIds] = useState<string[]>([]);
  // 포인터와 포커스는 서로 독립적인 정지 사유다. 하나로 합치면 나중에 발생한
  // 이벤트가 다른 쪽을 덮어써(예: 포커스가 남았는데 pointerleave) 재생이 되살아난다.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [userDriven, setUserDriven] = useState(false);
  const paused = hovered || focused;

  useEffect(() => {
    if (reducedMotion || paused || userDriven) return;

    const timer = setTimeout(() => {
      setPaidIds((prev) => {
        const next = INVOICES.find((invoice) => !prev.includes(invoice.id));
        return next ? [...prev, next.id] : [];
      });
    }, STEP_MS);

    return () => clearTimeout(timer);
  }, [paidIds, paused, reducedMotion, userDriven]);

  const outstanding = INVOICES.filter(
    (invoice) => !paidIds.includes(invoice.id),
  ).reduce((sum, invoice) => sum + invoice.amount, 0);
  const revenue = INVOICES.filter((invoice) =>
    paidIds.includes(invoice.id),
  ).reduce((sum, invoice) => sum + invoice.amount, BASE_REVENUE);

  const animatedOutstanding = useCountUp(outstanding, !reducedMotion);
  const animatedRevenue = useCountUp(revenue, !reducedMotion);
  const unpaidCount = INVOICES.length - paidIds.length;

  return (
    <div
      className="relative"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        // React의 onBlur는 focusout이라 카드 안에서 포커스를 옮길 때도 발화한다.
        // 이동한 곳이 아직 카드 안이면 정지 상태를 유지한다.
        const next = event.relatedTarget;
        if (!next || !event.currentTarget.contains(next)) setFocused(false);
      }}
    >
      {/* 카드 뒤로 번지는 브랜드 광원. 히어로에서 화면을 띄워 보이게 하는 장식. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-lg rounded-[32px] bg-gradient-to-br from-brand-primary/25 via-sky-300/20 to-emerald-300/25 blur-3xl"
      />

      <div className="relative overflow-hidden rounded-lg border border-surface-border bg-white shadow-overlay">
        <div className="flex items-center justify-between border-b border-surface-border bg-surface-muted px-lg py-md">
          <span className="text-xs font-medium text-text-muted">
            maedeup.app/dashboard
          </span>
          <span className="inline-flex items-center gap-xs rounded-full bg-white px-md py-0.5 text-xs font-medium text-brand-primary ring-1 ring-brand-primary/20">
            <span className="size-1.5 rounded-full bg-brand-primary motion-safe:animate-pulse" />
            데모
          </span>
        </div>

        <div className="space-y-lg p-lg">
          <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
            <StatTile
              label="미수금 합계"
              value={animatedOutstanding}
              caption={
                unpaidCount === 0
                  ? "받을 돈을 모두 회수했어요"
                  : `미입금 인보이스 ${unpaidCount}건`
              }
              tone={unpaidCount === 0 ? "success" : "danger"}
            />
            <StatTile
              label="이달 수익"
              value={animatedRevenue}
              caption={`입금 완료 ${BASE_PAID_COUNT + paidIds.length}건`}
              tone="success"
            />
          </div>

          <ul className="space-y-sm">
            {INVOICES.map((invoice) => {
              const isPaid = paidIds.includes(invoice.id);

              return (
                <li
                  key={invoice.id}
                  className={cn(
                    "flex items-center justify-between gap-md rounded-md border px-md py-md transition-colors duration-500",
                    isPaid
                      ? "border-green-200 bg-status-paid-bg"
                      : invoice.variant === "danger"
                        ? "border-red-200 bg-status-overdue-bg"
                        : "border-amber-200 bg-status-waiting-bg",
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-primary">
                      {invoice.client}
                    </p>
                    <p className="truncate text-xs text-text-muted">
                      {invoice.memo} · {formatKRW(invoice.amount)}
                    </p>
                  </div>

                  {/* 입금 후에도 같은 button을 유지해야 키보드로 누른 포커스가 살아남는다.
                      (disabled를 주면 포커스를 잃으므로 aria-disabled로 알린다.) */}
                  <button
                    type="button"
                    aria-disabled={isPaid}
                    onClick={() => {
                      if (isPaid) return;
                      setUserDriven(true);
                      setPaidIds((prev) => [...prev, invoice.id]);
                    }}
                    className={cn(
                      "flex shrink-0 items-center gap-sm rounded-full px-md py-1.5 text-xs font-medium text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2",
                      isPaid
                        ? "cursor-default"
                        : "bg-white shadow-raised transition-transform hover:-translate-y-0.5",
                    )}
                  >
                    {isPaid ? (
                      <span className="motion-safe:animate-flow-pop">
                        <Badge variant="success">입금 완료</Badge>
                      </span>
                    ) : (
                      <>
                        <Badge variant={invoice.variant}>
                          {invoice.dueLabel}
                        </Badge>
                        입금 확인
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="text-center text-xs text-text-muted">
            {unpaidCount === 0
              ? "입금이 확인되면 미수금·수익·세금 리포트가 함께 갱신됩니다."
              : "‘입금 확인’을 눌러 보세요. 미수금이 그 자리에서 줄어듭니다."}
          </p>
        </div>
      </div>
    </div>
  );
}
