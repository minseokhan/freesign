import { expect, test } from "@playwright/test";

import { loginWithTestUser } from "../src/test/e2e-auth";

function dateInput(offsetDays: number) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function currentKstYear() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
  }).format(new Date());
}

function parseKrw(value: string) {
  return Number(value.replace(/[^\d]/g, ""));
}

async function expectAnyKrwAtLeast(pageText: Promise<string>, minimum: number) {
  const text = await pageText;
  const amounts = text.match(/₩[\d,]+/g) ?? [];

  expect(amounts.some((value) => parseKrw(value) >= minimum)).toBe(true);
}

test("runs the core settlement chain from client to paid invoice and report CSV", async ({
  page,
}) => {
  // 실제 Claude API 초안 생성이 ~25초 걸려 기본 30초 테스트 예산을 초과한다.
  test.setTimeout(180_000);

  const runId = Date.now();
  const clientName = `E2E 무디 ${runId}`;
  const clientEmail = `moody-${runId}@example.com`;
  const contractTitle = `무디 브랜드 리뉴얼 ${runId}`;
  const scope = `브랜드 로고 리뉴얼과 인스타 템플릿 5종 제작 ${runId}`;
  const amount = "3000000";
  const netAmount = 2_901_000;
  const startDate = dateInput(1);
  const endDate = dateInput(21);
  const dueDate = dateInput(35);

  await loginWithTestUser(page);

  await expect(page.getByRole("heading", { name: "대시보드" })).toBeVisible();

  await page.goto("/clients/new");
  await page.getByLabel("이름").fill(clientName);
  await page.getByLabel("채널").selectOption("instagram");
  await page.getByLabel("이메일").fill(clientEmail);
  await page.getByLabel("전화번호").fill("010-1234-5678");
  await page.getByLabel("메모").fill("E2E 해피패스 클라이언트");
  await page.getByRole("button", { name: "저장" }).click();

  await page.waitForURL("**/clients");
  await expect(page.getByRole("link", { name: clientName })).toBeVisible();
  await expect(page.getByText("인스타그램").first()).toBeVisible();

  await page.getByRole("link", { name: clientName }).click();
  await expect(page.getByRole("heading", { name: clientName })).toBeVisible();
  await expect(page.getByText(clientEmail)).toBeVisible();

  await page.goto("/contracts/new");
  await expect(page.getByRole("heading", { name: "계약 만들기" })).toBeVisible();
  await page.getByLabel("계약 제목").fill(contractTitle);
  await page.getByLabel("클라이언트").selectOption({ label: clientName });
  await page.getByLabel("업무 범위").fill(scope);
  await page.getByLabel("계약 금액").fill(amount);
  await page.getByLabel("시작일").fill(startDate);
  await page.getByLabel("종료일").fill(endDate);
  await page.getByLabel("지급기한").fill(dueDate);
  await page.getByRole("button", { name: "초안 생성" }).click();

  await expect(
    page.getByText(/AI 보강 초안이 생성되었습니다|골격 초안으로 생성되었습니다/),
  ).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("AI 초안이며 법적 자문이 아닙니다.")).toBeVisible();
  await expect(page.getByText("평문요약").first()).toBeVisible();

  await page.getByRole("button", { name: "초안 저장" }).click();
  // UUID만 매치 — /contracts/new 에 즉시 매치돼 저장 완료 전에 통과하는 것을 방지.
  await page.waitForURL(/\/contracts\/[0-9a-f-]{36}$/);
  const contractUrl = new URL(page.url());
  const contractId = contractUrl.pathname.split("/").at(-1);

  expect(contractId).toBeTruthy();
  // 저장 후 상세 페이지 최초 진입 — dev 서버 첫 컴파일을 흡수할 여유를 둔다.
  await expect(page.getByText("초안").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(scope)).toBeVisible();
  await expect(page.getByRole("heading", { name: "기본 정보" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "조항과 평문요약" })).toBeVisible();

  const signatureCanvas = page.getByRole("img", {
    name: "서명 입력 캔버스",
  });
  // 캔버스가 접혀 있으면 마우스 좌표가 뷰포트 밖으로 나가 획이 그려지지 않는다.
  await signatureCanvas.scrollIntoViewIfNeeded();
  const canvasBox = await signatureCanvas.boundingBox();

  expect(canvasBox).not.toBeNull();

  if (!canvasBox) {
    throw new Error("Signature canvas was not measurable");
  }

  await page.mouse.move(canvasBox.x + 80, canvasBox.y + 80);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + 180, canvasBox.y + 140);
  await page.mouse.move(canvasBox.x + 280, canvasBox.y + 90);
  await page.mouse.up();

  // 쌍방 서명 요청 발송(단독 서명 플로우 제거됨) — 이메일은 best-effort라
  // dev 환경에서 실패해도 요청 자체는 커밋된다.
  await page.getByLabel("수신자 이메일").fill("counterparty@example.test");
  await page.getByLabel("수신자 이름 (선택)").fill("김상대");
  await page.getByLabel(/전자서명 사용 동의/).check();
  await page.getByLabel(/개인정보 수집·이용 동의/).check();
  await page.getByRole("button", { name: "서명하고 요청 보내기" }).click();

  await expect(page.getByText("서명 대기").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByRole("heading", { name: "상대방 서명 요청 현황" }),
  ).toBeVisible();
  await expect(page.getByText("counterparty@example.test")).toBeVisible();
  await expect(page.getByText("서명 요청 발송")).toBeVisible();

  await page.getByRole("link", { name: "인보이스 발행" }).click();
  await page.waitForURL(new RegExp(`/invoices/new\\?contract=${contractId}$`));
  await expect(
    page.getByRole("heading", { name: "인보이스 발행", level: 2 }),
  ).toBeVisible();
  await expect(page.getByText(clientName)).toBeVisible();
  // 금액 입력은 천 단위 콤마로 표시된다(3,000,000).
  await expect(page.getByLabel("청구 금액")).toHaveValue("3,000,000");
  await page.getByLabel("발행일").fill(startDate);
  await page.getByLabel("지급기한").fill(dueDate);
  await page.getByLabel("원천징수").selectOption("wt_3_3");
  await expect(page.getByText("₩99,000")).toBeVisible();
  await expect(page.getByText("₩2,901,000")).toBeVisible();
  await page.getByRole("button", { name: "발행" }).click();

  await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
  await expect(page.getByText("미수").first()).toBeVisible();
  await expect(page.getByText("₩99,000").first()).toBeVisible();
  await expect(page.getByText("₩2,901,000").first()).toBeVisible();
  await page.getByText("원천징수 내역 보기").click();
  await expect(page.getByText("저장 원천징수액")).toBeVisible();

  await page.getByRole("button", { name: "입금완료" }).click();
  await expect(page.getByText("입금완료").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("입금완료로 변경했습니다.")).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "대시보드" })).toBeVisible();
  await expect(page.getByText("미수금 합계")).toBeVisible();
  await expect(page.getByText("이달 수익")).toBeVisible();
  await expectAnyKrwAtLeast(page.locator("body").innerText(), netAmount);

  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "리포트" })).toBeVisible();
  await expect(page.getByText("인스타그램").first()).toBeVisible();
  await expectAnyKrwAtLeast(page.locator("body").innerText(), netAmount);

  // page.request 는 브라우저 컨텍스트의 인증 쿠키를 공유한다(standalone request 는 미인증).
  const csvResponse = await page.request.get(
    `/api/reports?year=${currentKstYear()}`,
  );

  expect(csvResponse.status()).toBe(200);
  expect(csvResponse.headers()["content-type"]).toContain("text/csv");
});
