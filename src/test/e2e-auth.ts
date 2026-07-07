import path from "node:path";

import type { APIRequestContext, Page } from "@playwright/test";

export const authStorageStatePath = path.join(
  process.cwd(),
  "e2e/.auth/user.json",
);

export function getTestLoginUrl(baseURL: string) {
  return new URL("/dev/test-login", baseURL);
}

export function isTestLoginRedirect(status: number) {
  return [302, 307, 308].includes(status);
}

export async function loginWithTestUser(page: Page) {
  await page.goto("/dev/test-login");
  await page.waitForURL("**/dashboard");
}

export async function saveTestUserStorageState(
  request: APIRequestContext,
  baseURL: string,
) {
  const response = await request.get(getTestLoginUrl(baseURL).toString(), {
    maxRedirects: 0,
  });

  if (!isTestLoginRedirect(response.status())) {
    throw new Error(`Dev test login failed with status ${response.status()}`);
  }

  await request.storageState({ path: authStorageStatePath });
}
