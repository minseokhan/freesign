// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";
import { createUser, runAs, runAsAnon } from "../pg";

describe("mutual signature schema", () => {
  let pool: Pool;
  let userA: string;
  let userB: string;
  let clientA: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
    userA = await createUser(pool, "mutual-a@example.test");
    userB = await createUser(pool, "mutual-b@example.test");

    const clientResult = await runAs<{ id: string }>(
      pool,
      userA,
      `
        insert into clients (user_id, name, channel)
        values ($1, 'Mutual Signature Client', 'direct')
        returning id
      `,
      [userA],
    );
    clientA = clientResult.rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  async function insertContractAs(userId = userA, clientId = clientA) {
    const result = await runAs<{ id: string }>(
      pool,
      userId,
      `
        insert into contracts (
          user_id, client_id, title, scope, amount, start_date, end_date
        )
        values (
          $1, $2, 'Mutual signature contract', 'Scope', 100000,
          '2026-07-01', '2026-07-31'
        )
        returning id
      `,
      [userId, clientId],
    );

    return result.rows[0].id;
  }

  async function insertRequestAs(userId: string, contractId: string, token = crypto.randomUUID()) {
    const result = await runAs<{ id: string }>(
      pool,
      userId,
      `
        insert into signature_requests (
          user_id, contract_id, token_hash, recipient_email, recipient_name,
          frozen_doc_hash, expires_at
        )
        values (
          $1, $2, $3, 'counterparty@example.test', 'Counterparty',
          repeat('a', 64), now() + interval '14 days'
        )
        returning id
      `,
      [userId, contractId, token],
    );

    return result.rows[0].id;
  }

  async function insertSignatureAs(
    userId: string,
    contractId: string,
    party: "owner" | "counterparty",
    requestId?: string,
  ) {
    const imageColumn = party === "owner" ? "signature_image_path" : "signature_image_data";
    const imageValue =
      party === "owner"
        ? `${userId}/${contractId}/signature.png`
        : "data:image/png;base64," + Buffer.from("png").toString("base64");

    const result = await runAs<{ id: string }>(
      pool,
      userId,
      `
        insert into contract_signatures (
          user_id, contract_id, request_id, party, signer_email, signer_name,
          ${imageColumn}, doc_hash, consent, meta
        )
        values (
          $1, $2, $3, $4, 'signer@example.test', 'Signer',
          $5, repeat('b', 64), '{"electronic_signature":true}'::jsonb, '{}'::jsonb
        )
        returning id
      `,
      [userId, contractId, requestId ?? null, party, imageValue],
    );

    return result.rows[0].id;
  }

  it("creates the signature tables, enums, and core columns", async () => {
    const enumResult = await pool.query<{ typname: string }>(
      `
        select typname
        from pg_type
        where typname in (
          'signature_request_status',
          'contract_signature_party',
          'contract_status'
        )
        order by typname
      `,
    );
    expect(enumResult.rows.map((row) => row.typname)).toEqual([
      "contract_signature_party",
      "contract_status",
      "signature_request_status",
    ]);

    const statusResult = await pool.query<{ enumlabel: string }>(
      `
        select enumlabel
        from pg_enum
        where enumtypid = 'contract_status'::regtype
        order by enumsortorder
      `,
    );
    expect(statusResult.rows.map((row) => row.enumlabel)).toEqual([
      "draft",
      "sent",
      "signed",
      "active",
      "done",
      "canceled",
    ]);

    const columnResult = await pool.query<{ table_name: string; column_name: string }>(
      `
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name in ('signature_requests', 'contract_signatures')
          and column_name in (
            'token_hash',
            'frozen_doc_hash',
            'sent_tsa_token',
            'completion_tsa_token',
            'signature_image_path',
            'signature_image_data',
            'consent',
            'meta'
          )
        order by table_name, column_name
      `,
    );
    expect(columnResult.rows).toEqual([
      { table_name: "contract_signatures", column_name: "consent" },
      { table_name: "contract_signatures", column_name: "meta" },
      { table_name: "contract_signatures", column_name: "signature_image_data" },
      { table_name: "contract_signatures", column_name: "signature_image_path" },
      { table_name: "signature_requests", column_name: "completion_tsa_token" },
      { table_name: "signature_requests", column_name: "frozen_doc_hash" },
      { table_name: "signature_requests", column_name: "sent_tsa_token" },
      { table_name: "signature_requests", column_name: "token_hash" },
    ]);
  });

  it("isolates signature rows by owner and hides them from anon direct selects", async () => {
    const contractId = await insertContractAs();
    const requestId = await insertRequestAs(userA, contractId);
    const signatureId = await insertSignatureAs(userA, contractId, "counterparty", requestId);

    const requestAsOther = await runAs<{ id: string }>(
      pool,
      userB,
      "select id from signature_requests where id = $1",
      [requestId],
    );
    expect(requestAsOther.rows).toEqual([]);

    const signatureAsOther = await runAs<{ id: string }>(
      pool,
      userB,
      "select id from contract_signatures where id = $1",
      [signatureId],
    );
    expect(signatureAsOther.rows).toEqual([]);

    const requestAsAnon = await runAsAnon<{ id: string }>(
      pool,
      "select id from signature_requests where id = $1",
      [requestId],
    );
    expect(requestAsAnon.rows).toEqual([]);

    const signatureAsAnon = await runAsAnon<{ id: string }>(
      pool,
      "select id from contract_signatures where id = $1",
      [signatureId],
    );
    expect(signatureAsAnon.rows).toEqual([]);
  });

  it("keeps contract signatures immutable even for the owner", async () => {
    const contractId = await insertContractAs();
    const signatureId = await insertSignatureAs(userA, contractId, "owner");

    const updateResult = await runAs(
      pool,
      userA,
      "update contract_signatures set signer_name = 'Tampered' where id = $1",
      [signatureId],
    );
    expect(updateResult.rowCount).toBe(0);

    const deleteResult = await runAs(
      pool,
      userA,
      "delete from contract_signatures where id = $1",
      [signatureId],
    );
    expect(deleteResult.rowCount).toBe(0);
  });

  it("requires at least one signature image location", async () => {
    const contractId = await insertContractAs();

    // 0022: owner 행은 Storage key와 base64 사본을 함께 가질 수 있다(둘 다 허용).
    const bothResult = await runAs(
      pool,
      userA,
      `
        insert into contract_signatures (
          user_id, contract_id, party, signer_email,
          signature_image_path, signature_image_data, doc_hash
        )
        values (
          $1, $2, 'owner', 'owner@example.test',
          'path/signature.png', 'data:image/png;base64,cG5n', repeat('c', 64)
        )
      `,
      [userA, contractId],
    );
    expect(bothResult.rowCount).toBe(1);

    await expect(
      runAs(
        pool,
        userA,
        `
          insert into contract_signatures (
            user_id, contract_id, party, signer_email, doc_hash
          )
          values ($1, $2, 'owner', 'owner@example.test', repeat('c', 64))
        `,
        [userA, contractId],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it("allows only one pending signature request per contract", async () => {
    const contractId = await insertContractAs();
    await insertRequestAs(userA, contractId, "a".repeat(64));

    await expect(insertRequestAs(userA, contractId, "b".repeat(64))).rejects.toThrow(
      /duplicate key/i,
    );
  });

  it("blocks deleting contracts with counterparty signatures but allows owner-only signatures", async () => {
    const ownerOnlyContractId = await insertContractAs();
    await insertSignatureAs(userA, ownerOnlyContractId, "owner");

    const ownerOnlyDelete = await runAs(
      pool,
      userA,
      "delete from contracts where id = $1",
      [ownerOnlyContractId],
    );
    expect(ownerOnlyDelete.rowCount).toBe(1);

    const counterpartyContractId = await insertContractAs();
    const requestId = await insertRequestAs(userA, counterpartyContractId);
    await insertSignatureAs(userA, counterpartyContractId, "counterparty", requestId);

    await expect(
      runAs(pool, userA, "delete from contracts where id = $1", [counterpartyContractId]),
    ).rejects.toThrow(/counterparty signature/i);
  });

  it("rate-limits anonymous buckets with a sliding window", async () => {
    const ipHash = `ip-${crypto.randomUUID()}`;

    const first = await runAsAnon<{ allowed: boolean }>(
      pool,
      "select consume_anon_rate_limit($1, $2, 2, 60) as allowed",
      [ipHash, "counterparty_sign"],
    );
    expect(first.rows).toEqual([{ allowed: true }]);

    const second = await runAsAnon<{ allowed: boolean }>(
      pool,
      "select consume_anon_rate_limit($1, $2, 2, 60) as allowed",
      [ipHash, "counterparty_sign"],
    );
    expect(second.rows).toEqual([{ allowed: true }]);

    const third = await runAsAnon<{ allowed: boolean }>(
      pool,
      "select consume_anon_rate_limit($1, $2, 2, 60) as allowed",
      [ipHash, "counterparty_sign"],
    );
    expect(third.rows).toEqual([{ allowed: false }]);

    await pool.query(
      `
        update anon_rate_limit_events
        set created_at = now() - interval '2 seconds'
        where ip_hash = $1 and bucket = 'counterparty_sign'
      `,
      [ipHash],
    );

    const afterWindow = await runAsAnon<{ allowed: boolean }>(
      pool,
      "select consume_anon_rate_limit($1, $2, 2, 1) as allowed",
      [ipHash, "counterparty_sign"],
    );
    expect(afterWindow.rows).toEqual([{ allowed: true }]);
  });
});
