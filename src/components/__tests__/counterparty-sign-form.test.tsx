import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CounterpartySignForm } from "@/components/counterparty-sign-form";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

// jsdom은 canvas 2D 컨텍스트가 없으므로 캔버스를 onChange 콜백만 흉내내는
// 스텁으로 대체한다(폼-API 연동 로직만 검증).
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

const TOKEN = "raw-signing-token-for-tests";

function drawSignature() {
  fireEvent.click(screen.getByRole("button", { name: "서명 그리기(mock)" }));
}

function fillName(name: string) {
  fireEvent.change(screen.getByLabelText("서명자 이름"), {
    target: { value: name },
  });
}

function checkConsents() {
  fireEvent.click(screen.getByRole("checkbox", { name: /전자서명/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /개인정보/ }));
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "동의하고 서명 완료" }));
}

function mockFetch(response: { status: number; body?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(response.body ?? {}), {
      status: response.status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

describe("CounterpartySignForm", () => {
  const refresh = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.mocked(useRouter).mockReturnValue({
      refresh,
    } as unknown as ReturnType<typeof useRouter>);
  });

  it("blocks submit and never posts when consents are unchecked", async () => {
    const fetchMock = mockFetch({ status: 200, body: { ok: true } });

    render(<CounterpartySignForm token={TOKEN} />);

    fillName("김담당");
    drawSignature();
    submit();

    expect(
      await screen.findByText("전자서명 사용에 동의해야 서명할 수 있습니다."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("개인정보 수집·이용에 동의해야 서명할 수 있습니다."),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the signature to the token API and refreshes on success", async () => {
    const fetchMock = mockFetch({ status: 200, body: { ok: true } });

    render(<CounterpartySignForm token={TOKEN} />);

    fillName("김담당");
    drawSignature();
    checkConsents();
    submit();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/sign/${encodeURIComponent(TOKEN)}`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      signerName: "김담당",
      signatureDataUrl: MOCK_SIGNATURE_DATA_URL,
      consentElectronicSignature: true,
      consentPrivacy: true,
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("surfaces the server error message per status code", async () => {
    mockFetch({
      status: 410,
      body: { error: "서명 링크가 만료되었습니다. 보낸 분에게 재발송을 요청해 주세요." },
    });

    render(<CounterpartySignForm token={TOKEN} />);

    fillName("김담당");
    drawSignature();
    checkConsents();
    submit();

    expect(
      await screen.findByText(
        "서명 링크가 만료되었습니다. 보낸 분에게 재발송을 요청해 주세요.",
      ),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
