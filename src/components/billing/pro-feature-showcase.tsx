"use client";

import Image from "next/image";
import { useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

type ProFeature = {
  key: string;
  label: string;
  /** 미리보기 창 주소 표시줄에 넣을 문구(웹 화면은 경로, 파일은 파일명). */
  chromeLabel: string;
  title: string;
  description: string;
  src: string;
  width: number;
  height: number;
};

// 캡처는 `/dev/pro-preview`(반복 인보이스·독촉·인사이트)와 리포트 화면에서 딴 실제 UI다.
// UI가 바뀌면 그 화면에서 다시 캡처해 public/screenshots/pro/를 갈아끼우면 된다.
const FEATURES: ProFeature[] = [
  {
    key: "recurring",
    label: "반복 인보이스",
    chromeLabel: "freesign.app/invoices/recurring",
    title: "리테이너 계약은 청구서가 알아서 준비돼요",
    description:
      "주기와 금액만 정해 두면 매 주기 청구 초안이 자동으로 만들어집니다. 언제든 일시중지할 수 있어요.",
    src: "/screenshots/pro/recurring.png",
    width: 2049,
    height: 647,
  },
  {
    key: "dunning",
    label: "미수금 독촉",
    chromeLabel: "freesign.app/invoices",
    title: "말 꺼내기 어려운 독촉을 대신 써 드려요",
    description:
      "지급기한이 지난 인보이스를 찾아 메일 초안까지 준비합니다. 자동 발송은 하지 않고, 확인한 뒤 직접 보냅니다.",
    src: "/screenshots/pro/dunning.png",
    width: 1537,
    height: 1079,
  },
  {
    key: "insight",
    label: "AI 계약 인사이트",
    chromeLabel: "freesign.app/contracts",
    title: "계약서에서 빠진 조항을 짚어 드려요",
    description:
      "지연이자·검수 기한·저작권 귀속처럼 프리랜서에게 중요한 항목을 위험도와 함께 정리합니다.",
    src: "/screenshots/pro/insight.png",
    width: 1537,
    height: 926,
  },
  {
    key: "revenue",
    label: "채널·클라이언트 수익",
    chromeLabel: "freesign.app/reports",
    title: "어느 채널과 거래처가 실제로 돈이 되는지 보여줘요",
    description:
      "입금 완료 기준으로 채널별 수익과 클라이언트별 수익을 나란히 집계합니다. 다음에 어디에 시간을 쓸지 판단할 수 있어요.",
    src: "/screenshots/pro/revenue-ranking.png",
    width: 2240,
    height: 745,
  },
  {
    key: "excel",
    label: "세금 Excel",
    chromeLabel: "freesign-report-2026.xlsx",
    title: "세무 대리인에게 파일 하나로 넘겨요",
    description:
      "연도별 입금·원천징수·실지급액이 제목·머리글·합계까지 서식으로 잡힌 엑셀 파일로 내려받습니다. 아래가 실제로 받게 되는 파일이에요.",
    src: "/screenshots/pro/tax-excel.png",
    width: 1811,
    height: 540,
  },
];

/**
 * Pro 전용 기능을 탭으로 훑어보는 미리보기. 탭 상호작용은 랜딩 메뉴 갤러리와 같은
 * roving tabindex 패턴이고, 화면 캡처는 클릭으로 확대/축소한다.
 */
export function ProFeatureShowcase() {
  const [active, setActive] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const feature = FEATURES[active]!;

  function selectTab(index: number) {
    setActive(index);
    setZoomed(false);
  }

  function focusTab(index: number) {
    selectTab(index);
    tabRefs.current[index]?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const last = FEATURES.length - 1;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        event.preventDefault();
        focusTab(active === last ? 0 : active + 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        event.preventDefault();
        focusTab(active === 0 ? last : active - 1);
        break;
      case "Home":
        event.preventDefault();
        focusTab(0);
        break;
      case "End":
        event.preventDefault();
        focusTab(last);
        break;
    }
  }

  return (
    <section id="pro-features" className="space-y-lg scroll-mt-2xl">
      <div>
        <h3 className="text-lg font-semibold text-text-primary">
          Pro에서 열리는 기능
        </h3>
        <p className="mt-xs text-sm leading-relaxed text-text-muted">
          탭을 눌러 실제 화면을 미리 보세요. 화면을 클릭하면 크게 볼 수 있어요.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Pro 전용 기능"
        className="flex flex-wrap items-center gap-sm"
      >
        {FEATURES.map((item, index) => {
          const isActive = index === active;

          return (
            <button
              key={item.key}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`pro-tab-${item.key}`}
              aria-selected={isActive}
              aria-controls={`pro-panel-${item.key}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => selectTab(index)}
              onKeyDown={handleTabKeyDown}
              className={cn(
                "min-h-11 rounded-full border px-lg py-sm text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2",
                isActive
                  ? "border-brand-primary bg-brand-primary text-white"
                  : "border-surface-border bg-white text-text-muted hover:bg-surface-muted",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`pro-panel-${feature.key}`}
        aria-labelledby={`pro-tab-${feature.key}`}
        tabIndex={0}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
      >
        <h4 className="text-base font-semibold text-text-primary">
          {feature.title}
        </h4>
        <p className="mt-sm text-sm leading-relaxed text-text-body">
          {feature.description}
        </p>

        <div className="mt-lg overflow-hidden rounded-lg border border-surface-border bg-white shadow-raised">
          <div className="flex items-center gap-xs border-b border-surface-border bg-surface-muted px-md py-sm">
            <span className="size-2.5 rounded-full bg-red-400" aria-hidden="true" />
            <span className="size-2.5 rounded-full bg-amber-400" aria-hidden="true" />
            <span className="size-2.5 rounded-full bg-green-400" aria-hidden="true" />
            <span className="ml-md truncate text-xs text-text-muted">
              {feature.chromeLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setZoomed((value) => !value)}
            aria-pressed={zoomed}
            className={cn(
              "block w-full overflow-x-auto bg-surface-page text-left",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-ring",
              zoomed ? "cursor-zoom-out" : "cursor-zoom-in",
            )}
          >
            <Image
              src={feature.src}
              alt={`${feature.label} 실제 화면`}
              width={feature.width}
              height={feature.height}
              className={cn(
                "h-auto transition-[width] duration-300",
                // Tailwind preflight의 img{max-width:100%}가 확대를 막으므로 함께 푼다.
                zoomed ? "w-[max(100%,var(--shot-w))] max-w-none" : "w-full",
              )}
              style={{ "--shot-w": `${feature.width}px` } as React.CSSProperties}
              sizes={`${feature.width}px`}
            />
          </button>
        </div>
        <p className="mt-sm text-xs text-text-muted">
          {zoomed
            ? "다시 누르면 원래 크기로 돌아갑니다."
            : "화면을 누르면 확대해서 볼 수 있어요."}
        </p>
      </div>
    </section>
  );
}
