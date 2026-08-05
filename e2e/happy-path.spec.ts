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

test("runs the core settlement chain from client to paid invoice and report export", async ({
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
  await expect(page.getByRole("heading", { name: "계약 매듭짓기" })).toBeVisible();
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

  // 청구 전달(ADR-013) — 클라이언트에게 나가는 공개 청구서 링크가 실제로 열리는지 확인한다.
  // 방금 만든 인보이스는 아직 한 번도 안 보냈으므로 "발송"이어야 한다
  // (인보이스는 생성 즉시 unpaid라, 결제 상태로 라벨을 정하면 여기서 "재발송"이 뜬다).
  await page.getByRole("button", { name: "청구서 발송" }).click();
  const sendDialog = page.getByRole("alertdialog");
  await expect(sendDialog.getByText(clientEmail)).toBeVisible();
  await expect(sendDialog.getByText(/이전 링크는 무효화됩니다/)).toHaveCount(0);
  await page.getByRole("button", { name: "발송", exact: true }).click();

  // 발급된 링크는 서버에 저장되지 않는다 — 확인 창에서 복사할 수 있어야 하고,
  // 확인을 누르기 전에 화면 갱신으로 사라지면 안 된다(BUG-2 회귀 가드).
  const shareLink = page.getByLabel("청구서 링크");
  await expect(shareLink).toBeVisible({ timeout: 30_000 });
  const shareUrl = await shareLink.inputValue();
  expect(shareUrl).toContain("/invoice/");
  await page.getByRole("button", { name: "확인", exact: true }).click();

  // 한 번 보낸 뒤에는 "재발송"으로 바뀌고, 이전 링크 무효화를 경고해야 한다.
  await expect(
    page.getByRole("button", { name: "청구서 재발송" }),
  ).toBeVisible({ timeout: 30_000 });

  // 비로그인 컨텍스트에서 열린다 — 로그인 쿠키 없이 금액·계좌를 볼 수 있어야 한다.
  const publicPage = await page.context().browser()!.newContext();
  const invoicePage = await publicPage.newPage();
  await invoicePage.goto(shareUrl);

  await expect(invoicePage.getByText(contractTitle)).toBeVisible();
  await expect(invoicePage.getByText("₩2,901,000").first()).toBeVisible();
  await expect(invoicePage.getByText("지급기한").first()).toBeVisible();

  const pdfResponse = await invoicePage.request.get(
    new URL(shareUrl).pathname.replace("/invoice/", "/api/invoice/") + "/pdf",
  );
  expect(pdfResponse.status()).toBe(200);
  expect(pdfResponse.headers()["content-type"]).toContain("application/pdf");

  // 소유자 화면에 발송 현황이 남는다 — 링크 원문은 못 보여주지만 도달·열람 사실은 보여준다.
  // 상대가 열어본 것이 여기 반영돼야, "링크를 다시 보려고" 재발송을 눌러 링크를 죽이는 일이 없다.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "청구서 발송 현황" }),
  ).toBeVisible();
  await expect(page.getByText(clientEmail)).toBeVisible();
  await expect(page.getByText("아직 열어보지 않음")).toHaveCount(0);

  // 재발송은 새 토큰을 발급하므로 방금 연 링크는 회수돼야 한다(원문 토큰 미저장의 귀결).
  await page.getByRole("button", { name: "청구서 재발송" }).click();
  await expect(
    page.getByRole("alertdialog").getByText(/이전 링크는 무효화됩니다/),
  ).toBeVisible();
  await page.getByRole("button", { name: "발송", exact: true }).click();
  await expect(page.getByLabel("청구서 링크")).toHaveValue(
    /\/invoice\//,
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "확인", exact: true }).click();

  await invoicePage.reload();
  await expect(
    invoicePage.getByText("이 청구서 링크는 더 이상 사용할 수 없습니다"),
  ).toBeVisible();

  await publicPage.close();

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
  const exportResponse = await page.request.get(
    `/api/reports?year=${currentKstYear()}`,
  );

  expect(exportResponse.status()).toBe(200);
  // 2a0e4a0에서 세무 리포트가 CSV → 서식 있는 xlsx로 바뀌었다.
  expect(exportResponse.headers()["content-type"]).toContain(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
});
