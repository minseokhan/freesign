import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createImportedContract } from "@/app/(dashboard)/contracts/actions";
import { ContractImportForm } from "@/components/contract-import-form";
import { REQUIRED_CONTRACT_CLAUSES } from "@/lib/validation/contract";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@/app/(dashboard)/contracts/actions", () => ({
  createImportedContract: vi.fn(),
}));

const clients = [{ id: "11111111-1111-4111-8111-111111111111", name: "무디" }];

function makePdfFile() {
  return new File(["%PDF-1.4"], "contract.pdf", {
    type: "application/pdf",
  });
}

function fillRequiredReviewFields() {
  fireEvent.change(screen.getByLabelText("계약 제목"), {
    target: { value: "불러온 계약서" },
  });
  fireEvent.change(screen.getByLabelText("업무 범위"), {
    target: { value: "브랜드 리뉴얼 작업" },
  });
  fireEvent.change(screen.getByLabelText("계약 금액"), {
    target: { value: "3000000" },
  });
  fireEvent.change(screen.getByLabelText("시작일"), {
    target: { value: "2026-07-10" },
  });
  fireEvent.change(screen.getByLabelText("종료일"), {
    target: { value: "2026-07-31" },
  });
}

describe("ContractImportForm", () => {
  const push = vi.fn();
  const refresh = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue({
      push,
      refresh,
    } as unknown as ReturnType<typeof useRouter>);
  });

  it("parses a PDF and shows editable extracted fields with review badges", async () => {
    const clauses = REQUIRED_CONTRACT_CLAUSES.map((title, index) => ({
      title,
      body: `${title} 본문`,
      plain_summary: `${title} 요약`,
      needs_review: index === 0,
    }));
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          extracted: {
            title: "무디 브랜드 리뉴얼 계약서",
            scope: "브랜드 리뉴얼",
            amount: 3000000,
            start_date: "2026-07-10",
            end_date: "2026-07-31",
            clauses,
            source: "ai",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<ContractImportForm clients={clients} />);

    fireEvent.change(screen.getByLabelText("계약서 PDF"), {
      target: { files: [makePdfFile()] },
    });
    fireEvent.click(screen.getByRole("button", { name: "분석" }));

    expect(await screen.findByDisplayValue("무디 브랜드 리뉴얼 계약서")).toBeInTheDocument();
    expect(screen.getByDisplayValue("3000000")).toBeInTheDocument();
    expect(screen.getByText("검토 필요")).toBeInTheDocument();
    expect(screen.getByLabelText("당사자 조항 본문")).toHaveValue("당사자 본문");
  });

  it("allows manual review after parse failure and saves the original file with payload", async () => {
    const file = makePdfFile();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "분석 실패" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.mocked(createImportedContract).mockResolvedValue({
      ok: true,
      id: "contract-1",
    });

    render(<ContractImportForm clients={clients} />);

    fireEvent.change(screen.getByLabelText("계약서 PDF"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "분석" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("분석 실패");
    expect(screen.getByLabelText("계약 제목")).toBeInTheDocument();

    fillRequiredReviewFields();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(createImportedContract).toHaveBeenCalledTimes(1);
    });

    const formData = vi.mocked(createImportedContract).mock.calls[0][0];
    expect(formData.get("file")).toBe(file);

    const payload = JSON.parse(String(formData.get("payload")));
    expect(payload).toMatchObject({
      client_id: clients[0].id,
      title: "불러온 계약서",
      scope: "브랜드 리뉴얼 작업",
      amount: 3000000,
      start_date: "2026-07-10",
      end_date: "2026-07-31",
    });
    expect(payload.clauses).toHaveLength(REQUIRED_CONTRACT_CLAUSES.length);
    expect(push).toHaveBeenCalledWith("/contracts/contract-1");
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
