// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";
import { createUser, runAs, runAsAnon } from "../pg";

// 0035: 상태 전이 RPC 5종을 SECURITY DEFINER로 전환하면 RLS가 더 이상 소유권을 걸러주지 않는다.
// 함수 내부의 auth.uid() 가드가 유일한 경계이므로, 그 가드가 실제로 크로스 테넌트 호출을
// 막는지와 정상 소유자 경로가 회귀하지 않는지를 함께 고정한다.
describe("도메인 상태 전이 RPC 소유권 가드 (0035)", () => {
  let pool: Pool;
  let victim: string;
  let attacker: string;
  let victimClient: string;
  let attackerClient: string;
  let victimContract: string;
  let victimInvoice: string;

  const SIGNATURE_IMAGE_DATA =
    "data:image/png;base64," + Buffer.from("owner-png").toString("base64");

  function randomHash64() {
    return (crypto.randomUUID() + crypto.randomUUID()).replaceAll("-", "");
  }

  async function insertClientAs(userId: string, name: string) {
    const result = await runAs<{ id: string }>(
      pool,
      userId,
      "insert into clients (user_id, name, channel) values ($1, $2, 'direct') returning id",
      [userId, name],
    );

    return result.rows[0].id;
  }

  async function insertContractAs(userId: string, clientId: string) {
    const result = await runAs<{ id: string }>(
      pool,
      userId,
      `
        insert into contracts (user_id, client_id, title, scope, amount, start_date, end_date, clauses)
        values ($1, $2, 'Guard contract', 'Scope', 500000, '2026-07-01', '2026-07-31',
                '[{"title":"제1조","body":"본문"}]'::jsonb)
        returning id
      `,
      [userId, clientId],
    );

    return result.rows[0].id;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
    victim = await createUser(pool, "rpc-guard-victim@example.test");
    attacker = await createUser(pool, "rpc-guard-attacker@example.test");
    victimClient = await insertClientAs(victim, "Victim Client");
    attackerClient = await insertClientAs(attacker, "Attacker Client");
    victimContract = await insertContractAs(victim, victimClient);

    const invoice = await runAs<{ id: string }>(
      pool,
      victim,
      `
        insert into invoices (
          user_id, client_id, contract_id, amount, issue_date, due_date,
          withholding_type, withholding_amount, net_amount, payment_status
        )
        values ($1, $2, $3, 1000000, current_date, current_date + 30, 'wt_3_3', 33000, 967000, 'unpaid')
        returning id
      `,
      [victim, victimClient, victimContract],
    );
    victimInvoice = invoice.rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("transition_contract_status_with_event는 타인 계약을 전이하지 못한다", async () => {
    await expect(
      runAs(
        pool,
        attacker,
        "select transition_contract_status_with_event($1, 'signed', false, 'attacker', 'contract.forged')",
        [victimContract],
      ),
    ).rejects.toThrow(/contract not found/);
  });

  it("send_signature_request_with_event는 타인 계약으로 발송하지 못한다", async () => {
    await expect(
      runAs(
        pool,
        attacker,
        `
          select send_signature_request_with_event(
            $1, $2, 'attacker@example.test', 'Attacker', $3, $4,
            '{}'::jsonb, 'attacker@example.test', 'Attacker', '{}'::jsonb, 'attacker', '{}'::jsonb, $5
          )
        `,
        [
          victimContract,
          randomHash64(),
          `${attacker}/sig.png`,
          randomHash64(),
          SIGNATURE_IMAGE_DATA,
        ],
      ),
    ).rejects.toThrow(/contract not found/);
  });

  it("issue_invoice_with_event는 타인 계약으로 인보이스를 발행하지 못한다", async () => {
    await expect(
      runAs(
        pool,
        attacker,
        `
          select issue_invoice_with_event(
            $1, $2, 1000000, current_date, current_date + 30, 'wt_3_3', 33000, 967000,
            'attacker', 'invoice.forged'
          )
        `,
        [victimContract, victimClient],
      ),
    ).rejects.toThrow(/contract not found/);
  });

  it("set_invoice_payment_with_event는 타인 인보이스를 입금 처리하지 못한다", async () => {
    await expect(
      runAs(
        pool,
        attacker,
        "select set_invoice_payment_with_event($1, 'paid', now(), 'bank', 'attacker', 'invoice.forged')",
        [victimInvoice],
      ),
    ).rejects.toThrow(/invoice not found/);
  });

  it("import_signed_contract_with_event는 타인 클라이언트로 계약을 만들지 못한다", async () => {
    await expect(
      runAs(
        pool,
        attacker,
        `
          select import_signed_contract_with_event(
            gen_random_uuid(), $1, '위조 계약', '범위', 100000,
            current_date, current_date + 30, '[]'::jsonb, null, $2, null,
            'attacker', 'contract.imported'
          )
        `,
        [victimClient, randomHash64()],
      ),
    ).rejects.toThrow(/client not found/);
  });

  it("세션 없는 anon 호출은 통과하지 못한다", async () => {
    await expect(
      runAsAnon(
        pool,
        "select transition_contract_status_with_event($1, 'signed', false, 'anon', 'contract.forged')",
        [victimContract],
      ),
    ).rejects.toThrow(/contract not found|permission denied/);
  });

  it("소유자 본인 경로는 그대로 동작한다", async () => {
    const contractId = await insertContractAs(attacker, attackerClient);

    const sent = await runAs<{ id: string }>(
      pool,
      attacker,
      `
        select send_signature_request_with_event(
          $1, $2, 'counterparty@example.test', 'Counterparty', $3, $4,
          '{}'::jsonb, 'attacker@example.test', 'Attacker', '{}'::jsonb, 'owner', '{}'::jsonb, $5
        ) as id
      `,
      [contractId, randomHash64(), `${attacker}/sig.png`, randomHash64(), SIGNATURE_IMAGE_DATA],
    );
    expect(sent.rows[0].id).toBeTruthy();

    const invoiceContract = await insertContractAs(attacker, attackerClient);
    const issued = await runAs<{ id: string }>(
      pool,
      attacker,
      `
        select issue_invoice_with_event(
          $1, $2, 1000000, current_date, current_date + 30, 'wt_3_3', 33000, 967000,
          'owner', 'invoice.issued'
        ) as id
      `,
      [invoiceContract, attackerClient],
    );
    expect(issued.rows[0].id).toBeTruthy();

    const paid = await runAs<{ id: string }>(
      pool,
      attacker,
      "select set_invoice_payment_with_event($1, 'paid', now(), 'bank', 'owner', 'invoice.paid') as id",
      [issued.rows[0].id],
    );
    expect(paid.rows[0].id).toBe(issued.rows[0].id);
  });
});
