import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteAccount } from "@/app/(dashboard)/settings/actions";
import { AccountDangerZone } from "@/components/account-danger-zone";
import { ACCOUNT_DELETE_CONFIRM_PHRASE } from "@/lib/validation/account";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@/app/(dashboard)/settings/actions", () => ({
  deleteAccount: vi.fn(),
}));

const replace = vi.fn();
const refresh = vi.fn();

describe("AccountDangerZone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue({
      replace,
      refresh,
    } as unknown as ReturnType<typeof useRouter>);
  });

  function typeConfirmPhrase(value = ACCOUNT_DELETE_CONFIRM_PHRASE) {
    fireEvent.change(screen.getByLabelText(/확인 문구/), { target: { value } });
  }

  it("삭제 전에 데이터 내보내기를 먼저 안내한다", () => {
    render(<AccountDangerZone hasActiveSubscription={false} />);

    expect(
      screen.getByRole("link", { name: /내 데이터 내보내기/ }),
    ).toHaveAttribute("href", "/api/account/export");
  });

  it("확인 문구를 정확히 입력하기 전에는 삭제 버튼이 비활성이다", () => {
    render(<AccountDangerZone hasActiveSubscription={false} />);

    const button = screen.getByRole("button", { name: "계정 삭제" });
    expect(button).toBeDisabled();

    typeConfirmPhrase("계정 삭제");
    expect(button).toBeDisabled();

    typeConfirmPhrase();
    expect(button).toBeEnabled();
  });

  it("삭제에 성공하면 홈으로 보낸다", async () => {
    vi.mocked(deleteAccount).mockResolvedValue({ ok: true });
    render(<AccountDangerZone hasActiveSubscription={false} />);

    typeConfirmPhrase();
    fireEvent.click(screen.getByRole("button", { name: "계정 삭제" }));

    await waitFor(() => {
      expect(deleteAccount).toHaveBeenCalledWith({
        confirm: ACCOUNT_DELETE_CONFIRM_PHRASE,
      });
      expect(replace).toHaveBeenCalledWith("/");
    });
  });

  it("실패하면 사유를 화면에 남기고 이동하지 않는다", async () => {
    vi.mocked(deleteAccount).mockResolvedValue({
      ok: false,
      error: "유료 구독이 활성 상태입니다.",
    });
    render(<AccountDangerZone hasActiveSubscription={false} />);

    typeConfirmPhrase();
    fireEvent.click(screen.getByRole("button", { name: "계정 삭제" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "유료 구독이 활성 상태입니다.",
      );
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("활성 구독이 있으면 삭제 대신 구독 해지를 먼저 안내한다", () => {
    render(<AccountDangerZone hasActiveSubscription />);

    expect(
      screen.queryByRole("button", { name: "계정 삭제" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /구독 해지/ })).toHaveAttribute(
      "href",
      "/billing",
    );
  });
});
