import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteRecurringSchedule } from "@/app/(dashboard)/invoices/recurring/actions";
import {
  RecurringScheduleList,
  type RecurringScheduleItem,
} from "@/components/recurring-schedule-list";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@/app/(dashboard)/invoices/recurring/actions", () => ({
  setRecurringActive: vi.fn(),
  deleteRecurringSchedule: vi.fn(),
}));

const schedules: RecurringScheduleItem[] = [
  {
    id: "s1",
    contractTitle: "블루스튜디오 웹서비스 계약",
    clientName: "무디",
    amount: 500_000,
    netAmount: 483_500,
    intervalKind: "weekly",
    nextRunAt: "2026-07-27",
    active: true,
  },
  {
    id: "s2",
    contractTitle: "업무위탁 합의서",
    clientName: "해커스",
    amount: 400_000,
    netAmount: 386_800,
    intervalKind: "monthly",
    nextRunAt: "2026-08-14",
    active: false,
  },
];

describe("RecurringScheduleList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue({
      refresh: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);
  });

  it("renders one card per schedule in a responsive grid", () => {
    render(<RecurringScheduleList schedules={schedules} />);

    const list = screen.getByRole("list", { name: "반복 스케줄" });

    expect(list).toHaveClass("sm:grid-cols-2", "lg:grid-cols-3");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows the schedule facts and state on each card", () => {
    render(<RecurringScheduleList schedules={schedules} />);

    const [first, second] = screen.getAllByRole("listitem");

    expect(first).toHaveTextContent("블루스튜디오 웹서비스 계약");
    expect(first).toHaveTextContent("무디");
    expect(first).toHaveTextContent("₩500,000");
    expect(first).toHaveTextContent("₩483,500");
    expect(first).toHaveTextContent("매주");
    expect(first).toHaveTextContent("2026-07-27");
    expect(within(first).getByText("활성")).toBeInTheDocument();
    expect(
      within(first).getByRole("button", { name: "일시중지" }),
    ).toBeInTheDocument();

    expect(within(second).getByText("일시중지")).toBeInTheDocument();
    expect(
      within(second).getByRole("button", { name: "재개" }),
    ).toBeInTheDocument();
  });

  // 계약·인보이스 삭제와 동일하게, 연한 붉은 배경 + 확인 모달을 거친다.
  it("asks for confirmation before deleting", async () => {
    vi.mocked(deleteRecurringSchedule).mockResolvedValue({
      ok: true,
      id: "s1",
    });

    render(<RecurringScheduleList schedules={schedules} />);

    const [first] = screen.getAllByRole("listitem");
    const deleteButton = within(first).getByRole("button", { name: "삭제" });

    expect(deleteButton).toHaveClass("bg-red-50");

    fireEvent.click(deleteButton);

    expect(deleteRecurringSchedule).not.toHaveBeenCalled();

    const dialog = screen.getByRole("alertdialog");

    expect(dialog).toHaveTextContent("반복 스케줄을 삭제할까요?");

    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));

    await waitFor(() => {
      expect(deleteRecurringSchedule).toHaveBeenCalledWith("s1");
    });
  });

  it("keeps the schedule when the confirmation is cancelled", () => {
    render(<RecurringScheduleList schedules={schedules} />);

    const [first] = screen.getAllByRole("listitem");

    fireEvent.click(within(first).getByRole("button", { name: "삭제" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "취소",
      }),
    );

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(deleteRecurringSchedule).not.toHaveBeenCalled();
  });

  it("explains an empty filtered result", () => {
    render(<RecurringScheduleList schedules={[]} />);

    expect(
      screen.getByText("조건에 맞는 반복 스케줄이 없습니다."),
    ).toBeInTheDocument();
  });
});
