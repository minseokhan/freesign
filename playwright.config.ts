import { defineConfig, devices } from "@playwright/test";

import { E2E_OUTBOX_FILE } from "./src/test/e2e-outbox";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL,
  },
  projects: [
    {
      name: "chromium",
      use: devices["Desktop Chrome"],
    },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ALLOW_TEST_LOGIN: "true",
      // 상대방 서명 링크(원문 토큰)는 메일 본문에만 있다 — 아웃박스로 받아 테스트가 읽는다.
      // reuseExistingServer로 이미 떠 있는 dev 서버에는 이 env가 적용되지 않으므로
      // .env.local에도 같은 값을 둔다.
      EMAIL_OUTBOX_FILE: E2E_OUTBOX_FILE,
    },
  },
});
