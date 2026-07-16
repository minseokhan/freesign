"use client";

import { useState } from "react";

import { SignaturePad } from "@/components/signature-pad";
import { SignatureRequestForm } from "@/components/signature-request-form";
import { cn } from "@/lib/utils";

// draft 계약 상세의 서명 영역 탭: 기존 단독 서명(그대로) | 상대방 서명 요청(신규).
const TABS = [
  { key: "solo", label: "단독 서명" },
  { key: "request", label: "상대방 서명 요청" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

type ContractSignatureTabsProps = {
  contractId: string;
};

export function ContractSignatureTabs({
  contractId,
}: ContractSignatureTabsProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("solo");

  return (
    <div className="space-y-lg">
      <div
        role="tablist"
        aria-label="서명 방식 선택"
        className="flex gap-sm border-b border-surface-border"
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={cn(
              "-mb-px min-h-11 border-b-2 px-md py-sm text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring",
              activeTab === tab.key
                ? "border-brand-primary text-brand-primary"
                : "border-transparent text-text-muted hover:text-text-primary",
            )}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {activeTab === "solo" ? (
          <SignaturePad contractId={contractId} />
        ) : (
          <SignatureRequestForm contractId={contractId} />
        )}
      </div>
    </div>
  );
}
