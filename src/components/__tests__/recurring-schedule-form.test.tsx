import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRecurringSchedule } from "@/app/(dashboard)/invoices/recurring/actions";
import { RecurringScheduleForm } from "@/components/recurring-schedule-form";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@/app/(dashboard)/invoices/recurring/actions", () => ({
  createRecurringSchedule: vi.fn(),
}));

const contracts = [
  { id: "11111111-1111-4111-8111-111111111111", title: "블루스튜디오 웹서비스 계약" },
];

describe("RecurringScheduleForm", () => {
  const push = vi.fn();
  const refresh = vi.fn();
  const back = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue({
      push,
      refresh,
      back,
    } as unknown as ReturnType<typeof useRouter>);
    vi.mocked(createRecurringSchedule).mockResolvedValue({
      ok: true,
      id: "schedule-1",
    });
  });

  it("lays out fields in the requested order", () => {
    render(<RecurringScheduleForm contracts={contracts} />);

    expect(
      Array.from(document.querySelectorAll("label")).map((el) => el.textContent),
    ).toEqual([
      "계약",
      "청구 금액(원)",
      "원천징수",
      "주기",
      "다음 생성일",
      "지급기한(생성일로부터 일수)",
    ]);
  });

  // 금액은 0원으로 시작하고, 계산기도 숨기지 않고 0원으로 보여준다.
  it("starts at zero and previews zero", () => {
    render(<RecurringScheduleForm contracts={contracts} />);

    expect(screen.getByLabelText("청구 금액(원)")).toHaveValue(0);

    const preview = screen.getByRole("group", { name: "미리보기" });

    expect(preview.textContent?.match(/₩0/g)).toHaveLength(3);
  });

  // 0원 스케줄은 서버가 거부하므로(amount > 0) 버튼을 미리 잠근다.
  it("keeps the submit button disabled while the amount is zero", () => {
    render(<RecurringScheduleForm contracts={contracts} />);

    fireEvent.change(screen.getByLabelText("다음 생성일"), {
      target: { value: "2026-08-01" },
    });

    expect(screen.getByRole("button", { name: "만들기" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("청구 금액(원)"), {
      target: { value: "400000" },
    });

    expect(screen.getByRole("button", { name: "만들기" })).toBeEnabled();
  });

  it("previews the withholding breakdown for the entered amount", () => {
    render(<RecurringScheduleForm contracts={contracts} />);

    fireEvent.change(screen.getByLabelText("청구 금액(원)"), {
      target: { value: "1000000" },
    });

    const preview = screen.getByRole("group", { name: "미리보기" });

    // 3.3%(기본값): 소득세 30,000 + 지방세 3,000 = 33,000, 실수령 967,000
    expect(preview).toHaveTextContent("₩1,000,000");
    expect(preview).toHaveTextContent("₩33,000");
    expect(preview).toHaveTextContent("₩967,000");
  });

  it("recalculates the preview when the withholding type changes", () => {
    render(<RecurringScheduleForm contracts={contracts} />);

    fireEvent.change(screen.getByLabelText("청구 금액(원)"), {
      target: { value: "1000000" },
    });
    fireEvent.change(screen.getByLabelText("원천징수"), {
      target: { value: "none" },
    });

    const preview = screen.getByRole("group", { name: "미리보기" });

    expect(preview).toHaveTextContent("₩0");
    expect(preview).toHaveTextContent("₩1,000,000");
  });

  it("returns to the schedule list after creating", async () => {
    render(<RecurringScheduleForm contracts={contracts} />);

    fireEvent.change(screen.getByLabelText("청구 금액(원)"), {
      target: { value: "400000" },
    });
    fireEvent.change(screen.getByLabelText("다음 생성일"), {
      target: { value: "2026-08-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "만들기" }));

    await waitFor(() => {
      expect(createRecurringSchedule).toHaveBeenCalledWith({
        contract_id: contracts[0].id,
        amount: "400000",
        withholding_type: "wt_3_3",
        interval_kind: "monthly",
        next_run_at: "2026-08-01",
        due_offset_days: "14",
      });
    });

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/invoices/recurring");
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("goes back when cancelled", () => {
    render(<RecurringScheduleForm contracts={contracts} />);

    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(back).toHaveBeenCalled();
    expect(createRecurringSchedule).not.toHaveBeenCalled();
  });
});
