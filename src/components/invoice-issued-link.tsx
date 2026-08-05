"use client";

// 발급된 청구서 링크 안내 창.
// 발송 Server Action의 revalidatePath가 페이지를 다시 그리면 "청구서 발송" 버튼은
// "다음 단계" 카드에서 "청구서 발송 현황" 카드로 옮겨 붙으며 재마운트된다. 그래서 링크를
// 버튼 안에 들고 있으면 발급 직후 사라진다 — 링크는 서버에 저장되지 않아 다시 볼 수 없다.
// 재마운트되지 않는 이 provider가 링크를 들고, 사용자가 닫을 때까지 보여준다.

import { createContext, useContext, useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export type IssuedInvoiceLink = {
  url: string;
  emailed: boolean;
  recipientEmail: string | null;
};

const AnnounceIssuedLinkContext = createContext<
  ((issued: IssuedInvoiceLink) => void) | null
>(null);

export function useAnnounceIssuedLink() {
  const announce = useContext(AnnounceIssuedLinkContext);

  if (!announce) {
    throw new Error("InvoiceIssuedLinkProvider 안에서만 사용할 수 있습니다.");
  }

  return announce;
}

export function InvoiceIssuedLinkProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [issued, setIssued] = useState<IssuedInvoiceLink | null>(null);

  return (
    <AnnounceIssuedLinkContext.Provider value={setIssued}>
      {children}
      <ConfirmDialog
        open={issued !== null}
        title={
          issued?.emailed ? "청구서를 보냈습니다" : "청구서 링크를 발급했습니다"
        }
        description={
          issued?.emailed
            ? `${issued.recipientEmail} 으로 청구서를 보냈습니다. 발급된 링크는 보관하지 않으니 필요하면 지금 복사해 주세요.`
            : "아래 링크를 클라이언트에게 직접 전달해 주세요. 발급된 링크는 보관하지 않으니 지금 복사해야 합니다."
        }
        confirmOnly
        confirmLabel="확인"
        onConfirm={() => setIssued(null)}
        onCancel={() => setIssued(null)}
      >
        <input
          readOnly
          value={issued?.url ?? ""}
          aria-label="청구서 링크"
          onFocus={(event) => event.currentTarget.select()}
          className="w-full rounded-md border border-surface-border bg-surface-muted px-sm py-xs font-mono text-xs text-text-body"
        />
      </ConfirmDialog>
    </AnnounceIssuedLinkContext.Provider>
  );
}
