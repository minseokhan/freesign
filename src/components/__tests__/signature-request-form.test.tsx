import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendSignatureRequest } from "@/app/(dashboard)/contracts/signature-actions";
import { SignatureRequestForm } from "@/components/signature-request-form";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@/app/(dashboard)/contracts/signature-actions", () => ({
  sendSignatureRequest: vi.fn(),
}));

// jsdom은 canvas 2D 컨텍스트가 없으므로 캔버스를 onChange 콜백만 흉내내는
// 스텁으로 대체한다(폼-액션 연동 로직만 검증).
const MOCK_SIGNATURE_DATA_URL = "data:image/png;base64,dGVzdA==";

vi.mock("@/components/signature-canvas", () => ({
  SignatureCanvas: ({
    onChange,
  }: {
    onChange: (dataUrl: string | null) => void;
  }) => (
    <button type="button" onClick={() => onChange(MOCK_SIGNATURE_DATA_URL)}>
      서명 그리기(mock)
    </button>
  ),
}));

const CONTRACT_ID = "11111111-1111-4111-8111-111111111111";

function drawSignature() {
  fireEvent.click(screen.getByRole("button", { name: "서명 그리기(mock)" }));
}

function fillRecipient(email: string, name?: string) {
  fireEvent.change(screen.getByLabelText("수신자 이메일"), {
    target: { value: email },
  });

  if (name !== undefined) {
    fireEvent.change(screen.getByLabelText("수신자 이름 (선택)"), {
      target: { value: name },
    });
  }
}

function checkConsents() {
  fireEvent.click(screen.getByRole("checkbox", { name: /전자서명/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /개인정보/ }));
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "서명하고 요청 보내기" }));
}

describe("SignatureRequestForm", () => {
  const refresh = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue({
      refresh,
    } as unknown as ReturnType<typeof useRouter>);
    vi.mocked(sendSignatureRequest).mockResolvedValue({
      ok: true,
      id: CONTRACT_ID,
    });
  });

  it("blocks submit and never calls the action when consents are unchecked", async () => {
    render(<SignatureRequestForm contractId={CONTRACT_ID} />);

    fillRecipient("client@example.com");
    drawSignature();
    submit();

    expect(
      await screen.findByText("전자서명 사용에 동의해야 요청을 보낼 수 있습니다."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("개인정보 수집·이용에 동의해야 요청을 보낼 수 있습니다."),
    ).toBeInTheDocument();
    expect(sendSignatureRequest).not.toHaveBeenCalled();
  });

  it("shows an email format error and never calls the action", async () => {
    render(<SignatureRequestForm contractId={CONTRACT_ID} />);

    fillRecipient("not-an-email");
    drawSignature();
    checkConsents();
    submit();

    expect(
      await screen.findByText("올바른 이메일 형식이 아닙니다."),
    ).toBeInTheDocument();
    expect(sendSignatureRequest).not.toHaveBeenCalled();
  });

  it("requires a drawn signature before submitting", async () => {
    render(<SignatureRequestForm contractId={CONTRACT_ID} />);

    fillRecipient("client@example.com");
    checkConsents();
    submit();

    expect(
      await screen.findByText("서명을 먼저 입력해 주세요."),
    ).toBeInTheDocument();
    expect(sendSignatureRequest).not.toHaveBeenCalled();
  });

  it("submits sendSignatureRequest with the allowlisted fields", async () => {
    render(<SignatureRequestForm contractId={CONTRACT_ID} />);

    fillRecipient("client@example.com", "김담당");
    drawSignature();
    checkConsents();
    submit();

    await waitFor(() => {
      expect(sendSignatureRequest).toHaveBeenCalledTimes(1);
    });

    expect(vi.mocked(sendSignatureRequest).mock.calls[0][0]).toEqual({
      contractId: CONTRACT_ID,
      recipientEmail: "client@example.com",
      recipientName: "김담당",
      signatureDataUrl: MOCK_SIGNATURE_DATA_URL,
      consentElectronicSignature: true,
      consentPrivacy: true,
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("omits recipientName when left blank", async () => {
    render(<SignatureRequestForm contractId={CONTRACT_ID} />);

    fillRecipient("client@example.com");
    drawSignature();
    checkConsents();
    submit();

    await waitFor(() => {
      expect(sendSignatureRequest).toHaveBeenCalledTimes(1);
    });

    expect(vi.mocked(sendSignatureRequest).mock.calls[0][0]).toEqual({
      contractId: CONTRACT_ID,
      recipientEmail: "client@example.com",
      recipientName: undefined,
      signatureDataUrl: MOCK_SIGNATURE_DATA_URL,
      consentElectronicSignature: true,
      consentPrivacy: true,
    });
  });

  it("surfaces the server action error on failure", async () => {
    vi.mocked(sendSignatureRequest).mockResolvedValue({
      ok: false,
      error: "초안 상태의 계약만 서명 요청을 보낼 수 있습니다.",
    });

    render(<SignatureRequestForm contractId={CONTRACT_ID} />);

    fillRecipient("client@example.com");
    drawSignature();
    checkConsents();
    submit();

    expect(
      await screen.findByText("초안 상태의 계약만 서명 요청을 보낼 수 있습니다."),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
