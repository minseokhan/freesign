// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";
import { createUser, runAs } from "../pg";

// 0036: 증거·감사 테이블의 클라이언트 직접 INSERT를 없애고 append_* DEFINER RPC로만 기록한다.
//
// 주의: 임베디드 테스트 DB는 마이그레이션 적용 후 grantSupabaseRoles()가 테이블 권한을 다시
// 부여하므로 revoke 자체는 검증할 수 없다. 여기서 검증하는 것은 (a) 정책이 사라져 정책 경로로는
// 못 쓴다는 것과 (b) append_* RPC의 소유권 가드다. 원격에서는 권한 계층이 한 번 더 막는다.
describe("증거·감사 테이블 쓰기 잠금 (0036)", () => {
  let pool: Pool;
  let owner: string;
  let attacker: string;
  let ownerClient: string;
  let ownerContract: string;
  let ownerInvoice: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
    owner = await createUser(pool, "evidence-owner@example.test");
    attacker = await createUser(pool, "evidence-attacker@example.test");

    const client = await runAs<{ id: string }>(
      pool,
      owner,
      "insert into clients (user_id, name, channel) values ($1, 'Evidence Client', 'direct') returning id",
      [owner],
    );
    ownerClient = client.rows[0].id;

    const contract = await runAs<{ id: string }>(
      pool,
      owner,
      `
        insert into contracts (user_id, client_id, title, scope, amount, start_date, end_date, clauses)
        values ($1, $2, 'Evidence contract', 'Scope', 300000, '2026-07-01', '2026-07-31',
                '[{"title":"제1조","body":"본문"}]'::jsonb)
        returning id
      `,
      [owner, ownerClient],
    );
    ownerContract = contract.rows[0].id;

    const invoice = await runAs<{ id: string }>(
      pool,
      owner,
      `
        insert into invoices (
          user_id, client_id, contract_id, amount, issue_date, due_date,
          withholding_type, withholding_amount, net_amount, payment_status
        )
        values ($1, $2, $3, 1000000, current_date, current_date + 30, 'wt_3_3', 33000, 967000, 'unpaid')
        returning id
      `,
      [owner, ownerClient, ownerContract],
    );
    ownerInvoice = invoice.rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("소유자도 자기 계약에 서명 행을 직접 주입할 수 없다", async () => {
    await expect(
      runAs(
        pool,
        owner,
        `
          insert into contract_signatures (
            user_id, contract_id, party, signer_email, signature_image_data, doc_hash
          )
          values ($1, $2, 'counterparty', 'forged@example.test', $3, $4)
        `,
        [
          owner,
          ownerContract,
          "data:image/png;base64," + Buffer.from("forged").toString("base64"),
          "a".repeat(64),
        ],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("소유자도 감사 이벤트를 직접 주입할 수 없다", async () => {
    await expect(
      runAs(
        pool,
        owner,
        `
          insert into contract_events (user_id, contract_id, actor, to_status, event_type)
          values ($1, $2, 'forged', 'signed', 'contract.forged')
        `,
        [owner, ownerContract],
      ),
    ).rejects.toThrow(/row-level security/);

    await expect(
      runAs(
        pool,
        owner,
        `
          insert into invoice_events (user_id, invoice_id, actor, to_status, event_type)
          values ($1, $2, 'forged', 'paid', 'invoice.forged')
        `,
        [owner, ownerInvoice],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("소유자도 서명 요청 행을 직접 만들 수 없다(발송 RPC 경유만)", async () => {
    await expect(
      runAs(
        pool,
        owner,
        `
          insert into signature_requests (
            user_id, contract_id, token_hash, recipient_email, frozen_doc_hash, expires_at
          )
          values ($1, $2, $3, 'x@example.test', $4, now() + interval '7 days')
        `,
        [owner, ownerContract, "b".repeat(64), "c".repeat(64)],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("append_contract_event는 소유자에게만 이벤트 기록을 허용한다", async () => {
    const inserted = await runAs<{ id: string }>(
      pool,
      owner,
      "select append_contract_event($1, 'owner', null, 'signed', 'contract.demo_seeded', '{}'::jsonb) as id",
      [ownerContract],
    );
    expect(inserted.rows[0].id).toBeTruthy();

    await expect(
      runAs(
        pool,
        attacker,
        "select append_contract_event($1, 'attacker', null, 'signed', 'contract.forged', '{}'::jsonb)",
        [ownerContract],
      ),
    ).rejects.toThrow(/contract not found/);
  });

  it("append_invoice_event는 소유자에게만 이벤트 기록을 허용한다", async () => {
    const inserted = await runAs<{ id: string }>(
      pool,
      owner,
      "select append_invoice_event($1, 'owner', 'unpaid', 'unpaid', 'invoice.dunning_sent', '{}'::jsonb) as id",
      [ownerInvoice],
    );
    expect(inserted.rows[0].id).toBeTruthy();

    await expect(
      runAs(
        pool,
        attacker,
        "select append_invoice_event($1, 'attacker', 'unpaid', 'paid', 'invoice.forged', '{}'::jsonb)",
        [ownerInvoice],
      ),
    ).rejects.toThrow(/invoice not found/);
  });

  it("기록된 이벤트의 user_id는 클라이언트 입력이 아니라 부모 소유자다", async () => {
    const event = await runAs<{ id: string }>(
      pool,
      owner,
      "select append_contract_event($1, 'owner', 'draft', 'sent', 'contract.checked', '{}'::jsonb) as id",
      [ownerContract],
    );

    const stored = await pool.query<{ user_id: string }>(
      "select user_id from contract_events where id = $1",
      [event.rows[0].id],
    );

    expect(stored.rows[0].user_id).toBe(owner);
  });
});
