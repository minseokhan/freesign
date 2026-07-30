// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";
import { createUser, runAs, runAsAnon } from "../pg";

type SignedContractData = {
  owner_user_id: string;
  client_name: string | null;
  contract: Record<string, unknown>;
  owner_signature: Record<string, unknown> | null;
  counterparty_signature: Record<string, unknown> | null;
};

describe("public sign RPCs (0020)", () => {
  let pool: Pool;
  let userA: string;
  let clientA: string;

  const OWNER_EMAIL = "public-sign-owner@example.test";
  const RECIPIENT_EMAIL = "public-sign-counterparty@example.test";
  const SIGNATURE_IMAGE_DATA =
    "data:image/png;base64," + Buffer.from("counterparty-png").toString("base64");
  const OWNER_SIGNATURE_IMAGE_DATA =
    "data:image/png;base64," + Buffer.from("owner-png").toString("base64");
  const TSA_TOKEN = Buffer.from("timestamp-token").toString("base64");
  // 0040: 완결 TSA 저장은 anon 무검증이 아니라 서버 경계 시크릿 게이트를 통과해야 한다.
  const SERVER_SECRET = "test-cron-secret";

  beforeAll(async () => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
    await pool.query(
      `insert into cron_config (id, cron_secret) values (true, $1)
       on conflict (id) do update set cron_secret = excluded.cron_secret`,
      [SERVER_SECRET],
    );
    userA = await createUser(pool, OWNER_EMAIL);

    const clientResult = await runAs<{ id: string }>(
      pool,
      userA,
      `
        insert into clients (user_id, name, channel)
        values ($1, 'Public Sign Client', 'direct')
        returning id
      `,
      [userA],
    );
    clientA = clientResult.rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  function randomHash64() {
    return (crypto.randomUUID() + crypto.randomUUID()).replaceAll("-", "");
  }

  async function insertContractAs() {
    const result = await runAs<{ id: string }>(
      pool,
      userA,
      `
        insert into contracts (
          user_id, client_id, title, scope, amount, start_date, end_date, clauses
        )
        values (
          $1, $2, 'Public sign contract', 'Public scope', 250000,
          '2026-07-01', '2026-07-31',
          '[{"title":"제1조","body":"본문"}]'::jsonb
        )
        returning id
      `,
      [userA, clientA],
    );

    return result.rows[0].id;
  }

  async function sendRequestAs(contractId: string) {
    const tokenHash = randomHash64();
    const docHash = randomHash64();

    const result = await runAs<{ id: string }>(
      pool,
      userA,
      `
        select send_signature_request_with_event(
          $1, $2, $3, 'Counterparty Kim',
          $4, $5,
          '{"signer":"public-sign-owner@example.test","ip":"198.51.100.1","ua":"OwnerAgent"}'::jsonb,
          'public-sign-owner@example.test', 'Owner Han',
          '{"electronic_signature":true,"privacy":true}'::jsonb,
          $6, '{}'::jsonb, $7
        ) as id
      `,
      [
        contractId,
        tokenHash,
        RECIPIENT_EMAIL,
        `${userA}/${contractId}/signature.png`,
        docHash,
        userA,
        OWNER_SIGNATURE_IMAGE_DATA,
      ],
    );

    return { requestId: result.rows[0].id, tokenHash, docHash };
  }

  async function completeAsAnon(tokenHash: string) {
    await runAsAnon(
      pool,
      `
        select complete_counterparty_signature_with_event(
          $1, $2, 'Counterparty Kim',
          '{"electronic_signature":true,"privacy":true}'::jsonb,
          '203.0.113.9', 'vitest-ua'
        )
      `,
      [tokenHash, SIGNATURE_IMAGE_DATA],
    );
  }

  async function storeTsaTokenAsAnon(tokenHash: string, tsaToken = TSA_TOKEN) {
    const result = await runAsAnon<{ ok: boolean }>(
      pool,
      "select store_completion_tsa_token($1, $2, $3) as ok",
      [tokenHash, tsaToken, SERVER_SECRET],
    );

    return result.rows[0].ok;
  }

  async function getSignedContractDataAsAnon(tokenHash: string) {
    const result = await runAsAnon<{ data: SignedContractData | null }>(
      pool,
      "select get_signed_contract_data($1) as data",
      [tokenHash],
    );

    return result.rows[0].data;
  }

  describe("store_completion_tsa_token", () => {
    it("stores the token exactly once for completed requests", async () => {
      const contractId = await insertContractAs();
      const { requestId, tokenHash } = await sendRequestAs(contractId);
      await completeAsAnon(tokenHash);

      expect(await storeTsaTokenAsAnon(tokenHash)).toBe(true);

      const stored = await pool.query<{ completion_tsa_token: string | null }>(
        "select completion_tsa_token from signature_requests where id = $1",
        [requestId],
      );
      expect(stored.rows[0].completion_tsa_token).toBe(TSA_TOKEN);

      // write-once: 두 번째 저장은 거부되고 기존 값이 유지된다.
      expect(
        await storeTsaTokenAsAnon(tokenHash, Buffer.from("other").toString("base64")),
      ).toBe(false);

      const unchanged = await pool.query<{ completion_tsa_token: string | null }>(
        "select completion_tsa_token from signature_requests where id = $1",
        [requestId],
      );
      expect(unchanged.rows[0].completion_tsa_token).toBe(TSA_TOKEN);
    });

    it("rejects pending requests and unknown tokens", async () => {
      const contractId = await insertContractAs();
      const { requestId, tokenHash } = await sendRequestAs(contractId);

      expect(await storeTsaTokenAsAnon(tokenHash)).toBe(false);
      expect(await storeTsaTokenAsAnon(randomHash64())).toBe(false);

      const stored = await pool.query<{ completion_tsa_token: string | null }>(
        "select completion_tsa_token from signature_requests where id = $1",
        [requestId],
      );
      expect(stored.rows[0].completion_tsa_token).toBeNull();
    });

    // 0040 회귀: 서버 시크릿 없이(=토큰 소지자가 직접) 증거를 선점할 수 없어야 한다.
    it("rejects calls without the server secret gate", async () => {
      const contractId = await insertContractAs();
      const { requestId, tokenHash } = await sendRequestAs(contractId);
      await completeAsAnon(tokenHash);

      await expect(
        runAsAnon(
          pool,
          "select store_completion_tsa_token($1, $2, $3) as ok",
          [tokenHash, Buffer.from("attacker-blob").toString("base64"), "wrong-secret"],
        ),
      ).rejects.toThrow(/unauthorized cron call/);

      const stored = await pool.query<{ completion_tsa_token: string | null }>(
        "select completion_tsa_token from signature_requests where id = $1",
        [requestId],
      );
      expect(stored.rows[0].completion_tsa_token).toBeNull();
    });

    it("no longer exposes the ungated two-argument signature", async () => {
      const exists = await pool.query<{ n: string }>(
        `select count(*) as n
         from pg_proc
         where proname = 'store_completion_tsa_token'
           and pronargs = 2`,
      );

      expect(exists.rows[0].n).toBe("0");
    });

    it("rejects malformed or oversized tokens", async () => {
      const contractId = await insertContractAs();
      const { tokenHash } = await sendRequestAs(contractId);
      await completeAsAnon(tokenHash);

      expect(await storeTsaTokenAsAnon(tokenHash, "not base64 !!")).toBe(false);
      expect(await storeTsaTokenAsAnon(tokenHash, "A".repeat(65537))).toBe(false);
      expect(await storeTsaTokenAsAnon("short", TSA_TOKEN)).toBe(false);
    });
  });

  describe("get_signed_contract_data", () => {
    it("returns null before completion and for malformed tokens", async () => {
      const contractId = await insertContractAs();
      const { tokenHash } = await sendRequestAs(contractId);

      expect(await getSignedContractDataAsAnon(tokenHash)).toBeNull();
      expect(await getSignedContractDataAsAnon(randomHash64())).toBeNull();
      expect(await getSignedContractDataAsAnon("short")).toBeNull();
    });

    it("returns contract render data for completed tokens", async () => {
      const contractId = await insertContractAs();
      const { tokenHash, docHash } = await sendRequestAs(contractId);
      await completeAsAnon(tokenHash);

      const data = await getSignedContractDataAsAnon(tokenHash);

      expect(data).not.toBeNull();
      expect(data?.owner_user_id).toBe(userA);
      expect(data?.client_name).toBe("Public Sign Client");
      expect(data?.contract).toEqual({
        id: contractId,
        title: "Public sign contract",
        scope: "Public scope",
        amount: 250000,
        start_date: "2026-07-01",
        end_date: "2026-07-31",
        status: "signed",
        clauses: [{ title: "제1조", body: "본문" }],
        plain_summary: null,
        doc_hash: docHash,
        signature_meta: {
          signer: "public-sign-owner@example.test",
          ip: "198.51.100.1",
          ua: "OwnerAgent",
        },
      });
      expect(data?.owner_signature).toEqual({
        signer_name: "Owner Han",
        signer_email: OWNER_EMAIL,
        signed_at: expect.any(String),
        signature_image_data: OWNER_SIGNATURE_IMAGE_DATA,
      });
      expect(data?.counterparty_signature).toEqual({
        signer_name: "Counterparty Kim",
        signer_email: RECIPIENT_EMAIL,
        signed_at: expect.any(String),
        signature_image_data: SIGNATURE_IMAGE_DATA,
        ip: "203.0.113.9",
        ua: "vitest-ua",
      });
    });
  });

  describe("complete_counterparty_signature_with_event 이름 검증(0023)", () => {
    async function completeWithName(tokenHash: string, name: string) {
      await runAsAnon(
        pool,
        `
          select complete_counterparty_signature_with_event(
            $1, $2, $3,
            '{"electronic_signature":true,"privacy":true}'::jsonb,
            '203.0.113.9', 'vitest-ua'
          )
        `,
        [tokenHash, SIGNATURE_IMAGE_DATA, name],
      );
    }

    it("요청서에 지정된 이름과 다르면 서명을 거부한다", async () => {
      const contractId = await insertContractAs();
      const { tokenHash } = await sendRequestAs(contractId);

      await expect(completeWithName(tokenHash, "다른 사람")).rejects.toThrow(
        /signer name mismatch/,
      );
    });

    it("공백·대소문자만 다른 이름은 정규화 후 통과시킨다", async () => {
      const contractId = await insertContractAs();
      const { tokenHash } = await sendRequestAs(contractId);

      // recipient_name 'Counterparty Kim' → 공백 제거·소문자 정규화 후 동일.
      await expect(
        completeWithName(tokenHash, "  counterpartykim  "),
      ).resolves.toBeUndefined();
    });
  });
});
