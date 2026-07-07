import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LoginPage from "../page";

describe("LoginPage", () => {
  it("shows inline feedback when OAuth sign-in fails", async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({ error: "oauth" }),
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Google 로그인을 시작하지 못했습니다.",
    );
  });
});
