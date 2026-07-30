// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";
import { createUser, runAs, runAsAnon } from "../pg";

// 0032_owasp_rls_hardening · 0033_signing_rpc_owner_guard 회귀 테스트.
// 공격 경로가 실제로 막히는지 + 정상 경로가 회귀하지 않는지 둘 다 검증한다.
//
// 주의: 임베디드 테스트 DB는 마이그레이션 적용 후 grantSupabaseRoles()가 모든 테이블에
// CRUD를 다시 grant한다. 즉 여기서 초록인 이유는 "정책이 막아서"이지 "권한이 없어서"가
// 아니다. 원격에서는 0032의 revoke가 권한 계층에서 한 번 더 막는다.
describe("OWASP RLS hardening (0032·0033)", () => {
  let pool: Pool;
  let attacker: string;
  let victim: string;
  let attackerClient: string;
  let victimClient: string;
  let victimContract: string;

  const SIGNATURE_IMAGE_DATA =
    "data:image/png;base64," + Buffer.from("attacker-png").toString("base64");

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
        insert into contracts (
          user_id, client_id, title, scope, amount, start_date, end_date, clauses
        )
        values (
          $1, $2, 'Hardening contract', 'Scope', 100000,
          '2026-07-01', '2026-07-31',
          '[{"title":"제1조","body":"본문"}]'::jsonb
        )
        returning id
      `,
      [userId, clientId],
    );

    return result.rows[0].id;
  }

  async function insertPendingRequestAs(userId: string, contractId: string) {
    const tokenHash = randomHash64();

    const result = await runAs<{ id: string }>(
      pool,
      userId,
      `
        insert into signature_requests (
          user_id, contract_id, token_hash, recipient_email, recipient_name,
          frozen_doc_hash, expires_at
        )
        values ($1, $2, $3, 'counterparty@example.test', 'Counterparty Kim', $4, now() + interval '7 days')
        returning id
      `,
      [userId, contractId, tokenHash, randomHash64()],
    );

    return { requestId: result.rows[0].id, tokenHash };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
    attacker = await createUser(pool, "hardening-attacker@example.test");
    victim = await createUser(pool, "hardening-victim@example.test");
    attackerClient = await insertClientAs(attacker, "Attacker Client");
    victimClient = await insertClientAs(victim, "Victim Client");
    victimContract = await insertContractAs(victim, victimClient);
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("signature_requests — 부모 계약 소유권 + status 고정", () => {
    it("타인 계약을 가리키는 서명 요청 INSERT를 거부한다", async () => {
      await expect(
        runAs(
          pool,
          attacker,
          `
            insert into signature_requests (
              user_id, contract_id, token_hash, recipient_email, frozen_doc_hash, expires_at
            )
            values ($1, $2, $3, 'attacker@example.test', $4, now() + interval '7 days')
          `,
          [attacker, victimContract, randomHash64(), randomHash64()],
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("자기 계약이라도 status='completed'로 INSERT하는 것을 거부한다", async () => {
      const contractId = await insertContractAs(attacker, attackerClient);

      await expect(
        runAs(
          pool,
          attacker,
          `
            insert into signature_requests (
              user_id, contract_id, token_hash, recipient_email, frozen_doc_hash,
              expires_at, status
            )
            values ($1, $2, $3, 'attacker@example.test', $4, now() + interval '7 days', 'completed')
          `,
          [attacker, contractId, randomHash64(), randomHash64()],
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("자기 pending 요청의 contract_id를 타인 계약으로 재지정하는 것을 거부한다", async () => {
      const contractId = await insertContractAs(attacker, attackerClient);
      const { requestId } = await insertPendingRequestAs(attacker, contractId);

      await expect(
        runAs(pool, attacker, "update signature_requests set contract_id = $1 where id = $2", [
          victimContract,
          requestId,
        ]),
      ).rejects.toThrow(/row-level security/);
    });

    it("자기 요청의 status를 completed로 승격하는 것을 거부한다", async () => {
      const contractId = await insertContractAs(attacker, attackerClient);
      const { requestId } = await insertPendingRequestAs(attacker, contractId);

      await expect(
        runAs(pool, attacker, "update signature_requests set status = 'completed' where id = $1", [
          requestId,
        ]),
      ).rejects.toThrow(/row-level security/);
    });

    it("정상 경로(sent_tsa_token·expires_at 갱신)는 그대로 통과한다", async () => {
      const contractId = await insertContractAs(attacker, attackerClient);
      const { requestId } = await insertPendingRequestAs(attacker, contractId);

      const updated = await runAs(
        pool,
        attacker,
        `
          update signature_requests
          set sent_tsa_token = 'dHNhLXRva2Vu', expires_at = now() + interval '14 days'
          where id = $1
        `,
        [requestId],
      );

      expect(updated.rowCount).toBe(1);
    });
  });

  describe("contract_signatures·contract_events — 부모 계약 소유권", () => {
    it("타인 계약에 서명 행을 주입하는 것을 거부한다", async () => {
      await expect(
        runAs(
          pool,
          attacker,
          `
            insert into contract_signatures (
              user_id, contract_id, party, signer_email, signature_image_data, doc_hash
            )
            values ($1, $2, 'counterparty', 'attacker@example.test', $3, $4)
          `,
          [attacker, victimContract, SIGNATURE_IMAGE_DATA, randomHash64()],
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it("타인 계약의 감사 로그에 이벤트를 주입하는 것을 거부한다", async () => {
      await expect(
        runAs(
          pool,
          attacker,
          `
            insert into contract_events (user_id, contract_id, actor, to_status, event_type)
            values ($1, $2, 'attacker', 'signed', 'contract.counterparty_signed')
          `,
          [attacker, victimContract],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe("usage_counters — 누적 쿼터 리셋 차단", () => {
    it("직접 UPDATE·DELETE는 0행이고 RPC 카운트는 정상 증가한다", async () => {
      const user = await createUser(pool, "hardening-quota@example.test");

      const first = await runAs<{ result: { used: number; allowed: boolean } }>(
        pool,
        user,
        "select consume_lifetime_quota('import_parse', 5) as result",
      );
      expect(first.rows[0].result).toMatchObject({ allowed: true, used: 1 });

      const reset = await runAs(
        pool,
        user,
        "update usage_counters set used = 0 where user_id = $1 and bucket = 'import_parse'",
        [user],
      );
      expect(reset.rowCount).toBe(0);

      const removed = await runAs(
        pool,
        user,
        "delete from usage_counters where user_id = $1 and bucket = 'import_parse'",
        [user],
      );
      expect(removed.rowCount).toBe(0);

      const second = await runAs<{ result: { used: number } }>(
        pool,
        user,
        "select consume_lifetime_quota('import_parse', 5) as result",
      );
      expect(second.rows[0].result).toMatchObject({ allowed: true, used: 2 });
    });
  });

  describe("rate_limit_events — 슬라이딩 윈도우 삭제 차단", () => {
    it("직접 DELETE·SELECT는 막히고 상한은 그대로 동작한다", async () => {
      const user = await createUser(pool, "hardening-ratelimit@example.test");

      const first = await runAs<{ result: { allowed: boolean } }>(
        pool,
        user,
        "select consume_rate_limit('ai_draft', 2, 60) as result",
      );
      expect(first.rows[0].result).toMatchObject({ allowed: true });

      const removed = await runAs(pool, user, "delete from rate_limit_events where user_id = $1", [
        user,
      ]);
      expect(removed.rowCount).toBe(0);

      const visible = await runAs(pool, user, "select id from rate_limit_events where user_id = $1", [
        user,
      ]);
      expect(visible.rowCount).toBe(0);

      // 윈도우가 비워지지 않았으므로 상한(2회)에 그대로 도달한다.
      await runAs(pool, user, "select consume_rate_limit('ai_draft', 2, 60) as result");
      const blocked = await runAs<{ result: { allowed: boolean } }>(
        pool,
        user,
        "select consume_rate_limit('ai_draft', 2, 60) as result",
      );
      expect(blocked.rows[0].result).toMatchObject({ allowed: false });
    });
  });

  describe("토큰 기반 anon RPC — 소유자 불일치 fail-closed (0033)", () => {
    // 정책이 막으므로 소유자 불일치 행은 superuser 연결로만 만들 수 있다.
    // 원격에 과거 데이터로 남아 있는 경우를 상정한 방어선이다.
    async function insertMismatchedRequest(status: "pending" | "completed") {
      const contractId = await insertContractAs(victim, victimClient);
      const tokenHash = randomHash64();

      await pool.query(
        `
          insert into signature_requests (
            user_id, contract_id, token_hash, recipient_email, recipient_name,
            frozen_doc_hash, expires_at, status, completed_at
          )
          values (
            $1, $2, $3, 'attacker@example.test', 'Counterparty Kim', $4,
            now() + interval '7 days', $5::signature_request_status, $6::timestamptz
          )
        `,
        [
          attacker,
          contractId,
          tokenHash,
          randomHash64(),
          status,
          status === "completed" ? new Date() : null,
        ],
      );

      return tokenHash;
    }

    it("get_signing_session이 null을 반환한다", async () => {
      const tokenHash = await insertMismatchedRequest("pending");

      const result = await runAsAnon<{ data: unknown }>(
        pool,
        "select get_signing_session($1) as data",
        [tokenHash],
      );

      expect(result.rows[0].data).toBeNull();
    });

    it("get_certificate_data·get_signed_contract_data가 null을 반환한다", async () => {
      const tokenHash = await insertMismatchedRequest("completed");

      const certificate = await runAsAnon<{ data: unknown }>(
        pool,
        "select get_certificate_data($1) as data",
        [tokenHash],
      );
      expect(certificate.rows[0].data).toBeNull();

      const signed = await runAsAnon<{ data: unknown }>(
        pool,
        "select get_signed_contract_data($1) as data",
        [tokenHash],
      );
      expect(signed.rows[0].data).toBeNull();
    });

    it("complete_counterparty_signature_with_event가 계약을 찾지 못하고 거부한다", async () => {
      const tokenHash = await insertMismatchedRequest("pending");

      await expect(
        runAsAnon(
          pool,
          `
            select complete_counterparty_signature_with_event(
              $1, $2, 'Counterparty Kim',
              '{"electronic_signature":true,"privacy":true}'::jsonb,
              '203.0.113.9', 'vitest-ua'
            )
          `,
          [tokenHash, SIGNATURE_IMAGE_DATA],
        ),
      ).rejects.toThrow(/contract not found/);
    });
  });
});
