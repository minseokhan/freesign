import { render, screen } from "@testing-library/react";

import { CHANNEL_OPTIONS, ChannelBadge } from "@/components/channel-badge";

describe("ChannelBadge", () => {
  it("renders Korean labels for every supported client channel", () => {
    render(
      <div>
        {CHANNEL_OPTIONS.filter((channel) => channel.value !== "all").map(
          (channel) => (
            <ChannelBadge key={channel.value} channel={channel.value} />
          ),
        )}
      </div>,
    );

    expect(screen.getByText("링크드인")).toBeInTheDocument();
    expect(screen.getByText("인스타그램")).toBeInTheDocument();
    expect(screen.getByText("유튜브")).toBeInTheDocument();
    expect(screen.getByText("직거래")).toBeInTheDocument();
    expect(screen.getByText("크몽")).toBeInTheDocument();
    expect(screen.getByText("추천")).toBeInTheDocument();
    expect(screen.getByText("기타")).toBeInTheDocument();
  });

  it("falls back to the neutral 기타 label for unknown channel values", () => {
    render(<ChannelBadge channel="newsletter" />);

    expect(screen.getByText("기타")).toHaveClass("bg-slate-100");
  });
});
