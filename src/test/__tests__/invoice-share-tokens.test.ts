// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";
import { createUser, runAs, runAsAnon } from "../pg";

// 0046: 인보이스 공개 전달 토큰. signature_requests(0018)/get_signing_session(0019) 패턴을 따른다.
//
// 주의: 임베디드 테스트 DB는 마이그레이션 적용 후 grantSupabaseRoles()가 테이블 권한을 다시
// 부여하므로 테이블 revoke 자체는 검증할 수 없다(0036 테스트와 동일 한계). 여기서 검증하는 것은
// (a) INSERT 정책이 없어 직접 쓰기가 막힌다는 것, (b) RPC의 소유권·상태 가드, (c) 함수 grant 경계다.
describe("인보이스 공개 전달 토큰 (0046)", () => {
  let pool: Pool;
  let owner: string;
  let attacker: string;
  let ownerClient: string;
  let ownerContract: string;

  // sha256 hex와 같은 64자 — RPC의 길이 상한(32~128) 안.
  const hash = (seed: string) => seed.padEnd(64, "0").slice(0, 64);

  async function createInvoice(
    status: "draft" | "unpaid" | "paid" = "draft",
  ): Promise<string> {
    const result = await runAs<{ id: string }>(
      pool,
      owner,
      `
        insert into invoices (
          user_id, client_id, contract_id, amount, issue_date, due_date,
          withholding_type, withholding_amount, net_amount, payment_status
        )
        values ($1, $2, $3, 1000000, current_date, current_date + 30, 'wt_3_3', 33000, 967000, $4)
        returning id
      `,
      [owner, ownerClient, ownerContract, status],
    );

    return result.rows[0].id;
  }

  async function send(
    invoiceId: string,
    tokenHash: string,
    options: { expiresAt?: string; email?: string | null; actor?: string } = {},
  ) {
    return runAs<{ send_invoice_with_event: { issued: boolean } }>(
      pool,
      owner,
      "select send_invoice_with_event($1, $2, $3, $4, $5, '{}'::jsonb)",
      [
        invoiceId,
        tokenHash,
        options.email === undefined ? "client@example.test" : options.email,
        options.expiresAt ?? new Date(Date.now() + 60 * 86400_000).toISOString(),
        options.actor ?? owner,
      ],
    );
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
    owner = await createUser(pool, "invoice-share-owner@example.test");
    attacker = await createUser(pool, "invoice-share-attacker@example.test");

    await runAs(
      pool,
      owner,
      "insert into profiles (user_id, display_name, bank_name, bank_account_number, bank_account_holder) values ($1, '김프리', '국민은행', '123456-78-901234', '김프리')",
      [owner],
    );

    const client = await runAs<{ id: string }>(
      pool,
      owner,
      "insert into clients (user_id, name, channel, contact_email) values ($1, 'Acme', 'direct', 'client@example.test') returning id",
      [owner],
    );
    ownerClient = client.rows[0].id;

    const contract = await runAs<{ id: string }>(
      pool,
      owner,
      `
        insert into contracts (user_id, client_id, title, scope, amount, start_date, end_date, clauses)
        values ($1, $2, '웹사이트 제작', '범위', 1000000, '2026-07-01', '2026-07-31',
                '[{"title":"제1조","body":"본문"}]'::jsonb)
        returning id
      `,
      [owner, ownerClient],
    );
    ownerContract = contract.rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("소유자도 토큰 행을 직접 INSERT할 수 없다 (쓰기는 DEFINER RPC만)", async () => {
    const invoiceId = await createInvoice();

    await expect(
      runAs(
        pool,
        owner,
        "insert into invoice_share_tokens (user_id, invoice_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '30 days')",
        [owner, invoiceId, hash("direct")],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("send_invoice_with_event: draft를 발행하고 토큰과 invoice.issued 이벤트를 남긴다", async () => {
    const invoiceId = await createInvoice();
    const result = await send(invoiceId, hash("issue1"));

    expect(result.rows[0].send_invoice_with_event).toEqual({ issued: true });

    const invoice = await runAs<{ payment_status: string }>(
      pool,
      owner,
      "select payment_status from invoices where id = $1",
      [invoiceId],
    );
    expect(invoice.rows[0].payment_status).toBe("unpaid");

    const events = await runAs<{ event_type: string; from_status: string; to_status: string }>(
      pool,
      owner,
      "select event_type, from_status, to_status from invoice_events where invoice_id = $1",
      [invoiceId],
    );
    expect(events.rows).toEqual([
      { event_type: "invoice.issued", from_status: "draft", to_status: "unpaid" },
    ]);

    const tokens = await runAs<{ status: string; recipient_email: string }>(
      pool,
      owner,
      "select status, recipient_email from invoice_share_tokens where invoice_id = $1",
      [invoiceId],
    );
    expect(tokens.rows).toEqual([{ status: "active", recipient_email: "client@example.test" }]);
  });

  it("재발송: 기존 토큰을 revoke하고 새 토큰만 active로 남긴다 (전이·이벤트 없음)", async () => {
    const invoiceId = await createInvoice();
    await send(invoiceId, hash("resend1"));
    const second = await send(invoiceId, hash("resend2"));

    expect(second.rows[0].send_invoice_with_event).toEqual({ issued: false });

    const tokens = await runAs<{ token_hash: string; status: string }>(
      pool,
      owner,
      "select token_hash, status from invoice_share_tokens where invoice_id = $1 order by created_at",
      [invoiceId],
    );
    expect(tokens.rows).toEqual([
      { token_hash: hash("resend1"), status: "revoked" },
      { token_hash: hash("resend2"), status: "active" },
    ]);

    const events = await runAs<{ count: string }>(
      pool,
      owner,
      "select count(*)::text as count from invoice_events where invoice_id = $1",
      [invoiceId],
    );
    expect(events.rows[0].count).toBe("1");
  });

  it("타인의 인보이스는 발송할 수 없다", async () => {
    const invoiceId = await createInvoice();

    await expect(
      runAs(
        pool,
        attacker,
        "select send_invoice_with_event($1, $2, null, now() + interval '30 days', $3, '{}'::jsonb)",
        [invoiceId, hash("attacker"), attacker],
      ),
    ).rejects.toThrow(/invoice not found/);
  });

  it("정산된(paid) 인보이스는 발송할 수 없다", async () => {
    const invoiceId = await createInvoice("paid");

    await expect(send(invoiceId, hash("paid1"))).rejects.toThrow(/already settled/);
  });

  it("만료가 과거이거나 400일을 넘으면 거부한다", async () => {
    const invoiceId = await createInvoice();

    await expect(
      send(invoiceId, hash("exp1"), {
        expiresAt: new Date(Date.now() - 86400_000).toISOString(),
      }),
    ).rejects.toThrow(/invalid expiry/);

    await expect(
      send(invoiceId, hash("exp2"), {
        expiresAt: new Date(Date.now() + 500 * 86400_000).toISOString(),
      }),
    ).rejects.toThrow(/invalid expiry/);
  });

  it("get_invoice_view: anon이 활성 토큰으로 청구 내역과 계좌를 읽고, 식별자는 나오지 않는다", async () => {
    const invoiceId = await createInvoice();
    await send(invoiceId, hash("view1"));

    const result = await runAsAnon<{ get_invoice_view: Record<string, unknown> }>(
      pool,
      "select get_invoice_view($1)",
      [hash("view1")],
    );
    const view = result.rows[0].get_invoice_view;

    expect(view.state).toBe("active");
    expect(view.amount).toBe(1000000);
    expect(view.net_amount).toBe(967000);
    expect(view.payment_status).toBe("unpaid");
    expect(view.contract_title).toBe("웹사이트 제작");
    expect(view.client_name).toBe("Acme");
    expect(view.sender_name).toBe("김프리");
    expect(view.bank_account_number).toBe("123456-78-901234");

    // PDF 문서번호가 인보이스 id이므로 클라이언트 사본과 소유자 사본이 같은 번호를 갖는다.
    expect(view.invoice_id).toBe(invoiceId);
    // 소유자 식별자는 이 표면에서 쓸 데가 없다.
    expect(view).not.toHaveProperty("user_id");

    const token = await runAs<{ first_viewed_at: string | null }>(
      pool,
      owner,
      "select first_viewed_at from invoice_share_tokens where token_hash = $1",
      [hash("view1")],
    );
    expect(token.rows[0].first_viewed_at).not.toBeNull();
  });

  it("get_invoice_view: 계약이 삭제된 인보이스는 스냅샷 제목으로 폴백한다", async () => {
    const invoiceId = await createInvoice();
    await runAs(
      pool,
      owner,
      `update invoices
         set contract_id = null,
             contract_snapshot = '{"title":"삭제된 계약"}'::jsonb
       where id = $1`,
      [invoiceId],
    );
    await send(invoiceId, hash("snapshot1"));

    const result = await runAsAnon<{ get_invoice_view: Record<string, unknown> }>(
      pool,
      "select get_invoice_view($1)",
      [hash("snapshot1")],
    );

    expect(result.rows[0].get_invoice_view.contract_title).toBe("삭제된 계약");
  });

  it("get_invoice_view: 없는·만료된·회수된 토큰은 내용을 반환하지 않는다", async () => {
    const missing = await runAsAnon<{ get_invoice_view: unknown }>(
      pool,
      "select get_invoice_view($1)",
      [hash("nope")],
    );
    expect(missing.rows[0].get_invoice_view).toBeNull();

    const invoiceId = await createInvoice();
    await send(invoiceId, hash("expired1"));
    await pool.query(
      "update invoice_share_tokens set expires_at = now() - interval '1 day' where token_hash = $1",
      [hash("expired1")],
    );

    const expired = await runAsAnon<{ get_invoice_view: { state: string } }>(
      pool,
      "select get_invoice_view($1)",
      [hash("expired1")],
    );
    expect(expired.rows[0].get_invoice_view).toEqual({ state: "expired" });

    // 재발송으로 회수된 토큰은 더 이상 열리지 않는다.
    await send(invoiceId, hash("expired2"));
    const revoked = await runAsAnon<{ get_invoice_view: { state: string } }>(
      pool,
      "select get_invoice_view($1)",
      [hash("expired1")],
    );
    expect(revoked.rows[0].get_invoice_view).toEqual({ state: "revoked" });
  });

  it("함수 실행 권한이 역할 경계대로 갈린다", async () => {
    const granted = await pool.query<{
      signature: string;
      anon: boolean;
      authenticated: boolean;
    }>(
      `select s as signature,
              has_function_privilege('anon', s, 'execute') as anon,
              has_function_privilege('authenticated', s, 'execute') as authenticated
         from unnest(array[
           'send_invoice_with_event(uuid, text, text, timestamptz, text, jsonb)',
           'get_invoice_view(text)'
         ]) as s`,
    );

    expect(granted.rows).toEqual([
      {
        signature: "send_invoice_with_event(uuid, text, text, timestamptz, text, jsonb)",
        anon: false,
        authenticated: true,
      },
      { signature: "get_invoice_view(text)", anon: true, authenticated: false },
    ]);
  });
});
