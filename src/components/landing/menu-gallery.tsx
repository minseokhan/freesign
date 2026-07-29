"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

type MenuScreen = {
  key: string;
  label: string;
  title: string;
  description: string;
  src: string;
  width: number;
  height: number;
};

const SCREENS: MenuScreen[] = [
  {
    key: "dashboard",
    label: "대시보드",
    title: "내 돈이 어디까지 왔는지 한눈에",
    description:
      "미수금 합계·이달 실지급액·이번 달 예정 입금을 위에 두고, 계약 파이프라인과 임박/지연 지급기한, 채널 수익 TOP까지 한 화면에서 확인합니다.",
    src: "/screenshots/dashboard.png",
    width: 2880,
    height: 1716,
  },
  {
    key: "clients",
    label: "클라이언트",
    title: "유입 채널과 연락처를 한 곳에",
    description:
      "링크드인·인스타그램·유튜브·크몽 등 유입 채널로 분류하고, 채널별 필터로 원하는 클라이언트를 빠르게 찾습니다.",
    src: "/screenshots/clients.png",
    width: 2880,
    height: 1510,
  },
  {
    key: "contracts",
    label: "계약",
    title: "초안부터 서명 대기·완료까지 상태로 관리",
    description:
      "구조화 입력으로 AI 초안을 만들거나 발주처가 보낸 PDF를 불러오고, 서명 요청을 보낸 뒤에는 상태만 보고도 어디까지 진행됐는지 알 수 있습니다.",
    src: "/screenshots/contracts.png",
    width: 2880,
    height: 1620,
  },
  {
    key: "invoices",
    label: "인보이스",
    title: "원천징수까지 자동 계산되는 청구",
    description:
      "계약과 연결해 인보이스를 발행하고, 원천징수 유형만 고르면 실지급액이 자동으로 계산됩니다. 지급기한이 지난 건은 목록에서 바로 붉게 드러납니다.",
    src: "/screenshots/invoices.png",
    width: 2880,
    height: 1714,
  },
  {
    key: "reports",
    label: "리포트",
    title: "연말 세무 정리를 위한 원장과 엑셀",
    description:
      "연도별 입금 기준 세무 요약과 미수·연체 결산, 채널별·클라이언트별 수익을 집계하고 서식이 잡힌 엑셀로 내보내 세무 대리인에게 그대로 전달합니다.",
    src: "/screenshots/reports.png",
    width: 2880,
    height: 2722,
  },
  {
    key: "settings",
    label: "설정",
    title: "한 번 설정하면 문서에 자동 반영",
    description:
      "표시 이름·기본 원천징수율·입금 계좌를 설정하면 새 계약과 인보이스, PDF에 자동으로 채워집니다.",
    src: "/screenshots/settings.png",
    width: 2880,
    height: 2066,
  },
];

export function MenuGallery() {
  const [active, setActive] = useState(0);
  const activeScreen = SCREENS[active]!;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function focusTab(index: number) {
    setActive(index);
    tabRefs.current[index]?.focus();
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const last = SCREENS.length - 1;
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
    <div className="space-y-xl">
      <div
        role="tablist"
        aria-label="메뉴별 화면"
        className="flex flex-wrap items-center gap-sm"
      >
        {SCREENS.map((screen, index) => {
          const isActive = index === active;

          return (
            <button
              key={screen.key}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`menu-tab-${screen.key}`}
              aria-selected={isActive}
              aria-controls={`menu-panel-${screen.key}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={handleTabKeyDown}
              className={cn(
                "min-h-11 rounded-full border px-lg py-sm text-sm font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2",
                isActive
                  ? "border-brand-primary bg-brand-primary text-white"
                  : "border-surface-border bg-white text-text-muted hover:bg-surface-muted",
              )}
            >
              {screen.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`menu-panel-${activeScreen.key}`}
        aria-labelledby={`menu-tab-${activeScreen.key}`}
        tabIndex={0}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring focus-visible:ring-offset-2"
      >
        <div className="max-w-2xl">
          <h3 className="text-xl font-semibold tracking-tight text-text-primary">
            {activeScreen.title}
          </h3>
          <p className="mt-sm text-sm leading-relaxed text-text-body">
            {activeScreen.description}
          </p>
        </div>

        <div className="mt-lg overflow-hidden rounded-xl border border-surface-border bg-white shadow-sm">
          <div className="flex items-center gap-xs border-b border-surface-border bg-surface-muted px-md py-sm">
            <span className="size-2.5 rounded-full bg-red-400" aria-hidden="true" />
            <span className="size-2.5 rounded-full bg-amber-400" aria-hidden="true" />
            <span className="size-2.5 rounded-full bg-green-400" aria-hidden="true" />
            <span className="ml-md truncate text-xs text-text-muted">
              freesign.app{activeScreen.key === "dashboard" ? "/dashboard" : `/${activeScreen.key}`}
            </span>
          </div>
          <Image
            src={activeScreen.src}
            alt={`FreeSign ${activeScreen.label} 화면`}
            width={activeScreen.width}
            height={activeScreen.height}
            className="h-auto w-full"
            sizes="(min-width: 1024px) 1024px, 100vw"
            priority={active === 0}
          />
        </div>
      </div>
    </div>
  );
}
