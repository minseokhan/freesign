import { expect, test } from "@playwright/test";

test("renders the public login page", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Google로 계속하기" })).toBeVisible();
  await expect(page.getByRole("img", { name: "FreeSign" })).toBeVisible();
});
