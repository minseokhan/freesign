// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";
import { createUser, runAs, runAsAnon } from "../pg";

type SigningSession = {
  state: string;
  contract_title?: string;
  clauses?: unknown;
  frozen_doc_hash?: string;
  recipient_name?: string | null;
  sender_name?: string | null;
  expires_at?: string;
};

describe("signature request RPCs", () => {
  let pool: Pool;
  let userA: string;
  let userB: string;
  let clientA: string;

  const OWNER_EMAIL = "rpc-owner@example.test";
  const RECIPIENT_EMAIL = "rpc-counterparty@example.test";
  const SIGNATURE_IMAGE_DATA =
    "data:image/png;base64," + Buffer.from("counterparty-png").toString("base64");
  const OWNER_SIGNATURE_IMAGE_DATA =
    "data:image/png;base64," + Buffer.from("owner-png").toString("base64");

  beforeAll(async () => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
    userA = await createUser(pool, OWNER_EMAIL);
    userB = await createUser(pool, "rpc-other@example.test");

    const clientResult = await runAs<{ id: string }>(
      pool,
      userA,
      `
        insert into clients (user_id, name, channel)
        values ($1, 'Signature RPC Client', 'direct')
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

  async function insertContractAs(userId = userA, clientId = clientA) {
    const result = await runAs<{ id: string }>(
      pool,
      userId,
      `
        insert into contracts (
          user_id, client_id, title, scope, amount, start_date, end_date, clauses
        )
        values (
          $1, $2, 'RPC signature contract', 'Scope', 100000,
          '2026-07-01', '2026-07-31',
          '[{"title":"제1조","body":"본문"}]'::jsonb
        )
        returning id
      `,
      [userId, clientId],
    );

    return result.rows[0].id;
  }

  async function sendRequestAs(
    userId: string,
    contractId: string,
    { tokenHash = randomHash64(), docHash = randomHash64() } = {},
  ) {
    const result = await runAs<{ id: string }>(
      pool,
      userId,
      `
        select send_signature_request_with_event(
          $1, $2, $3, 'Counterparty Kim',
          $4, $5,
          '{"signer":"rpc-owner@example.test","ip":"198.51.100.7","ua":"OwnerAgent"}'::jsonb,
          'rpc-owner@example.test', 'Owner Han',
          '{"electronic_signature":true,"privacy":true}'::jsonb,
          $6, '{}'::jsonb, $7
        ) as id
      `,
      [
        contractId,
        tokenHash,
        RECIPIENT_EMAIL,
        `${userId}/${contractId}/signature.png`,
        docHash,
        userId,
        OWNER_SIGNATURE_IMAGE_DATA,
      ],
    );

    return { requestId: result.rows[0].id, tokenHash, docHash };
  }

  async function completeAsAnon(tokenHash: string) {
    const result = await runAsAnon<{ result: Record<string, unknown> }>(
      pool,
      `
        select complete_counterparty_signature_with_event(
          $1, $2, 'Counterparty Kim',
          '{"electronic_signature":true,"privacy":true}'::jsonb,
          '203.0.113.9', 'vitest-ua'
        ) as result
      `,
      [tokenHash, SIGNATURE_IMAGE_DATA],
    );

    return result.rows[0].result;
  }

  async function getSessionAsAnon(tokenHash: string) {
    const result = await runAsAnon<{ session: SigningSession | null }>(
      pool,
      "select get_signing_session($1) as session",
      [tokenHash],
    );

    return result.rows[0].session;
  }

  describe("send_signature_request_with_event", () => {
    it("moves a draft contract to sent with owner signature, pending request, and event", async () => {
      const contractId = await insertContractAs();
      const { requestId, tokenHash, docHash } = await sendRequestAs(userA, contractId);

      const contract = await pool.query(
        `
          select status, signature_image_path, doc_hash, signature_meta
          from contracts where id = $1
        `,
        [contractId],
      );
      expect(contract.rows[0].status).toBe("sent");
      expect(contract.rows[0].signature_image_path).toBe(
        `${userA}/${contractId}/signature.png`,
      );
      expect(contract.rows[0].doc_hash).toBe(docHash);
      expect(contract.rows[0].signature_meta).toEqual({
        signer: "rpc-owner@example.test",
        ip: "198.51.100.7",
        ua: "OwnerAgent",
      });

      const ownerSignature = await pool.query(
        `
          select party, request_id, signer_email, signature_image_path,
            signature_image_data, doc_hash, meta
          from contract_signatures where contract_id = $1
        `,
        [contractId],
      );
      expect(ownerSignature.rows).toEqual([
        {
          party: "owner",
          request_id: requestId,
          signer_email: "rpc-owner@example.test",
          signature_image_path: `${userA}/${contractId}/signature.png`,
          signature_image_data: OWNER_SIGNATURE_IMAGE_DATA,
          doc_hash: docHash,
          meta: { ip: "198.51.100.7", ua: "OwnerAgent" },
        },
      ]);

      const request = await pool.query(
        `
          select status, token_hash, frozen_doc_hash, recipient_email,
            (expires_at > now() + interval '13 days') as expires_far_enough,
            (expires_at <= now() + interval '15 days') as expires_within_cap
          from signature_requests where id = $1
        `,
        [requestId],
      );
      expect(request.rows[0]).toEqual({
        status: "pending",
        token_hash: tokenHash,
        frozen_doc_hash: docHash,
        recipient_email: RECIPIENT_EMAIL,
        expires_far_enough: true,
        expires_within_cap: true,
      });

      const events = await pool.query(
        `
          select actor, from_status, to_status, event_type
          from contract_events where contract_id = $1
          order by created_at
        `,
        [contractId],
      );
      expect(events.rows).toEqual([
        {
          actor: userA,
          from_status: "draft",
          to_status: "sent",
          event_type: "signature_request.sent",
        },
      ]);
    });

    it("accepts calls without owner signature image data (구 배포 호환)", async () => {
      const contractId = await insertContractAs();
      const result = await runAs<{ id: string }>(
        pool,
        userA,
        `
          select send_signature_request_with_event(
            p_contract_id => $1::uuid,
            p_token_hash => $2,
            p_recipient_email => $3,
            p_recipient_name => 'Counterparty Kim',
            p_signature_image_path => $4,
            p_doc_hash => $5,
            p_signature_meta => '{"signer":"rpc-owner@example.test"}'::jsonb,
            p_signer_email => 'rpc-owner@example.test',
            p_signer_name => 'Owner Han',
            p_consent => '{}'::jsonb,
            p_actor => $6
          ) as id
        `,
        [
          contractId,
          randomHash64(),
          RECIPIENT_EMAIL,
          `${userA}/${contractId}/signature.png`,
          randomHash64(),
          userA,
        ],
      );
      expect(result.rows[0].id).toBeTruthy();

      const ownerSignature = await pool.query(
        `
          select signature_image_data, meta
          from contract_signatures where contract_id = $1
        `,
        [contractId],
      );
      expect(ownerSignature.rows).toEqual([
        { signature_image_data: null, meta: {} },
      ]);
    });

    it("rejects malformed owner signature image data", async () => {
      const contractId = await insertContractAs();

      await expect(
        runAs(
          pool,
          userA,
          `
            select send_signature_request_with_event(
              $1, $2, $3, 'Counterparty Kim',
              $4, $5,
              '{}'::jsonb, 'rpc-owner@example.test', 'Owner Han',
              '{}'::jsonb, $6, '{}'::jsonb, 'not-a-png'
            )
          `,
          [
            contractId,
            randomHash64(),
            RECIPIENT_EMAIL,
            `${userA}/${contractId}/signature.png`,
            randomHash64(),
            userA,
          ],
        ),
      ).rejects.toThrow(/signature image/i);
    });

    it("rejects non-draft contracts", async () => {
      const contractId = await insertContractAs();
      await sendRequestAs(userA, contractId);

      await expect(sendRequestAs(userA, contractId)).rejects.toThrow(/draft/i);
    });

    it("rejects contracts the caller does not own", async () => {
      const contractId = await insertContractAs();

      await expect(sendRequestAs(userB, contractId)).rejects.toThrow(/not found/i);
    });
  });

  describe("get_signing_session", () => {
    it("returns pending session fields and records first_viewed_at exactly once", async () => {
      const contractId = await insertContractAs();
      const { requestId, tokenHash, docHash } = await sendRequestAs(userA, contractId);

      const session = await getSessionAsAnon(tokenHash);
      expect(session).toEqual({
        state: "pending",
        contract_title: "RPC signature contract",
        clauses: [{ title: "제1조", body: "본문" }],
        frozen_doc_hash: docHash,
        recipient_name: "Counterparty Kim",
        sender_name: OWNER_EMAIL,
        expires_at: expect.any(String),
      });

      const firstViewed = await pool.query<{ first_viewed_at: Date | null }>(
        "select first_viewed_at from signature_requests where id = $1",
        [requestId],
      );
      expect(firstViewed.rows[0].first_viewed_at).not.toBeNull();

      await getSessionAsAnon(tokenHash);

      const secondViewed = await pool.query<{ first_viewed_at: Date | null }>(
        "select first_viewed_at from signature_requests where id = $1",
        [requestId],
      );
      expect(secondViewed.rows[0].first_viewed_at).toEqual(
        firstViewed.rows[0].first_viewed_at,
      );

      const viewedEvents = await pool.query(
        `
          select count(*)::int as count
          from contract_events
          where contract_id = $1 and event_type = 'signature_request.viewed'
        `,
        [contractId],
      );
      expect(viewedEvents.rows[0].count).toBe(1);
    });

    it("returns only the state for expired requests", async () => {
      const contractId = await insertContractAs();
      const { requestId, tokenHash } = await sendRequestAs(userA, contractId);

      await pool.query(
        "update signature_requests set expires_at = now() - interval '1 day' where id = $1",
        [requestId],
      );

      expect(await getSessionAsAnon(tokenHash)).toEqual({ state: "expired" });
    });

    it("returns only the state for revoked requests", async () => {
      const contractId = await insertContractAs();
      const { requestId, tokenHash } = await sendRequestAs(userA, contractId);

      await runAs(
        pool,
        userA,
        "select revoke_signature_request_with_event($1, $2, '{}'::jsonb)",
        [requestId, userA],
      );

      expect(await getSessionAsAnon(tokenHash)).toEqual({ state: "revoked" });
    });

    it("returns null for unknown or malformed tokens", async () => {
      expect(await getSessionAsAnon(randomHash64())).toBeNull();
      expect(await getSessionAsAnon("short")).toBeNull();
    });
  });

  describe("complete_counterparty_signature_with_event", () => {
    it("signs the contract, completes the request, and appends the event", async () => {
      const contractId = await insertContractAs();
      const { requestId, tokenHash, docHash } = await sendRequestAs(userA, contractId);

      const result = await completeAsAnon(tokenHash);
      expect(result).toEqual({
        request_id: requestId,
        contract_id: contractId,
        contract_title: "RPC signature contract",
        owner_email: OWNER_EMAIL,
        recipient_email: RECIPIENT_EMAIL,
        recipient_name: "Counterparty Kim",
      });

      const contract = await pool.query(
        "select status from contracts where id = $1",
        [contractId],
      );
      expect(contract.rows[0].status).toBe("signed");

      const counterparty = await pool.query(
        `
          select signer_email, signer_name, signature_image_data, doc_hash, meta
          from contract_signatures
          where contract_id = $1 and party = 'counterparty'
        `,
        [contractId],
      );
      expect(counterparty.rows).toEqual([
        {
          signer_email: RECIPIENT_EMAIL,
          signer_name: "Counterparty Kim",
          signature_image_data: SIGNATURE_IMAGE_DATA,
          doc_hash: docHash,
          meta: { ip: "203.0.113.9", ua: "vitest-ua" },
        },
      ]);

      const request = await pool.query(
        "select status, completed_at from signature_requests where id = $1",
        [requestId],
      );
      expect(request.rows[0].status).toBe("completed");
      expect(request.rows[0].completed_at).not.toBeNull();

      const event = await pool.query(
        `
          select actor, from_status, to_status, meta
          from contract_events
          where contract_id = $1 and event_type = 'contract.counterparty_signed'
        `,
        [contractId],
      );
      expect(event.rows).toEqual([
        {
          actor: `counterparty:${RECIPIENT_EMAIL}`,
          from_status: "sent",
          to_status: "signed",
          meta: {
            ip: "203.0.113.9",
            ua: "vitest-ua",
            consent: { electronic_signature: true, privacy: true },
          },
        },
      ]);
    });

    it("rejects a second completion of the same request", async () => {
      const contractId = await insertContractAs();
      const { tokenHash } = await sendRequestAs(userA, contractId);

      await completeAsAnon(tokenHash);

      await expect(completeAsAnon(tokenHash)).rejects.toThrow(/already completed/i);
    });

    it("rejects when the contract doc hash drifted from the frozen hash", async () => {
      const contractId = await insertContractAs();
      const { tokenHash } = await sendRequestAs(userA, contractId);

      // 발송 후 계약 조항이 수정되어 문서 해시가 달라진 상황을 재현한다.
      // 0045가 클라이언트의 발송 후 UPDATE를 막았으므로(그게 이 드리프트의 원래 경로였다)
      // 픽스처는 superuser로 심는다. 여기서 보려는 것은 RPC의 해시 대조다.
      await pool.query(
        `
          update contracts
          set clauses = '[{"title":"제1조","body":"변경된 본문"}]'::jsonb,
              doc_hash = $2
          where id = $1
        `,
        [contractId, randomHash64()],
      );

      await expect(completeAsAnon(tokenHash)).rejects.toThrow(/hash mismatch/i);
    });

    it("rejects expired requests", async () => {
      const contractId = await insertContractAs();
      const { requestId, tokenHash } = await sendRequestAs(userA, contractId);

      await pool.query(
        "update signature_requests set expires_at = now() - interval '1 day' where id = $1",
        [requestId],
      );

      await expect(completeAsAnon(tokenHash)).rejects.toThrow(/expired/i);
    });

    it("rejects malformed signature images", async () => {
      const contractId = await insertContractAs();
      const { tokenHash } = await sendRequestAs(userA, contractId);

      await expect(
        runAsAnon(
          pool,
          `
            select complete_counterparty_signature_with_event(
              $1, 'not-a-png', 'Counterparty Kim', '{}'::jsonb, '203.0.113.9', 'vitest-ua'
            )
          `,
          [tokenHash],
        ),
      ).rejects.toThrow(/signature image/i);
    });
  });

  describe("revoke_signature_request_with_event", () => {
    it("reverts the contract to draft and resets owner signature artifacts", async () => {
      const contractId = await insertContractAs();
      const { requestId } = await sendRequestAs(userA, contractId);

      await runAs(
        pool,
        userA,
        "select revoke_signature_request_with_event($1, $2, '{}'::jsonb)",
        [requestId, userA],
      );

      const contract = await pool.query(
        `
          select status, signature_image_path, doc_hash, signature_meta
          from contracts where id = $1
        `,
        [contractId],
      );
      expect(contract.rows[0]).toEqual({
        status: "draft",
        signature_image_path: null,
        doc_hash: null,
        signature_meta: null,
      });

      const signatures = await pool.query(
        "select count(*)::int as count from contract_signatures where contract_id = $1",
        [contractId],
      );
      expect(signatures.rows[0].count).toBe(0);

      const request = await pool.query(
        "select status from signature_requests where id = $1",
        [requestId],
      );
      expect(request.rows[0].status).toBe("revoked");

      const event = await pool.query(
        `
          select from_status, to_status
          from contract_events
          where contract_id = $1 and event_type = 'signature_request.revoked'
        `,
        [contractId],
      );
      expect(event.rows).toEqual([{ from_status: "sent", to_status: "draft" }]);
    });

    it("rejects revoking completed requests", async () => {
      const contractId = await insertContractAs();
      const { requestId, tokenHash } = await sendRequestAs(userA, contractId);
      await completeAsAnon(tokenHash);

      await expect(
        runAs(
          pool,
          userA,
          "select revoke_signature_request_with_event($1, $2, '{}'::jsonb)",
          [requestId, userA],
        ),
      ).rejects.toThrow(/pending/i);
    });

    it("rejects requests the caller does not own", async () => {
      const contractId = await insertContractAs();
      const { requestId } = await sendRequestAs(userA, contractId);

      await expect(
        runAs(
          pool,
          userB,
          "select revoke_signature_request_with_event($1, $2, '{}'::jsonb)",
          [requestId, userB],
        ),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("transition_contract_status_with_event guard", () => {
    it("blocks reverting to draft when a counterparty signature exists", async () => {
      const contractId = await insertContractAs();
      const { tokenHash } = await sendRequestAs(userA, contractId);
      await completeAsAnon(tokenHash);

      await expect(
        runAs(
          pool,
          userA,
          `
            select transition_contract_status_with_event(
              $1, 'draft', true, $2, 'status_changed', '{}'::jsonb
            )
          `,
          [contractId, userA],
        ),
      ).rejects.toThrow(/counterparty/i);

      const forward = await runAs<{ id: string }>(
        pool,
        userA,
        `
          select transition_contract_status_with_event(
            $1, 'active', false, $2, 'status_changed', '{}'::jsonb
          ) as id
        `,
        [contractId, userA],
      );
      expect(forward.rows[0].id).toBe(contractId);
    });
  });

  describe("get_certificate_data", () => {
    it("returns certificate data only for completed requests", async () => {
      const contractId = await insertContractAs();
      const { requestId, tokenHash, docHash } = await sendRequestAs(userA, contractId);

      const beforeCompletion = await runAsAnon<{ data: unknown }>(
        pool,
        "select get_certificate_data($1) as data",
        [tokenHash],
      );
      expect(beforeCompletion.rows[0].data).toBeNull();

      await completeAsAnon(tokenHash);
      await pool.query(
        `
          update signature_requests
          set sent_tsa_token = 'sent-token', completion_tsa_token = 'completion-token'
          where id = $1
        `,
        [requestId],
      );

      const result = await runAsAnon<{
        data: {
          contract: Record<string, unknown>;
          signatures: Record<string, unknown>[];
          events: Record<string, unknown>[];
          tsa: Record<string, unknown>;
        };
      }>(pool, "select get_certificate_data($1) as data", [tokenHash]);
      const data = result.rows[0].data;

      expect(data.contract).toEqual({
        id: contractId,
        title: "RPC signature contract",
        clauses: [{ title: "제1조", body: "본문" }],
        doc_hash: docHash,
        signature_meta: {
          signer: "rpc-owner@example.test",
          ip: "198.51.100.7",
          ua: "OwnerAgent",
        },
      });
      expect(data.signatures.map((s) => s.party)).toEqual(["owner", "counterparty"]);
      expect(data.events.map((e) => e.event_type)).toEqual([
        "signature_request.sent",
        "contract.counterparty_signed",
      ]);
      expect(data.tsa).toEqual({
        sent_tsa_token: "sent-token",
        completion_tsa_token: "completion-token",
      });
    });
  });

  describe("anon boundary", () => {
    it("blocks direct table reads but allows the definer RPC", async () => {
      const contractId = await insertContractAs();
      const { requestId, tokenHash } = await sendRequestAs(userA, contractId);

      const directRequest = await runAsAnon(
        pool,
        "select id from signature_requests where id = $1",
        [requestId],
      );
      expect(directRequest.rows).toEqual([]);

      const directSignature = await runAsAnon(
        pool,
        "select id from contract_signatures where contract_id = $1",
        [contractId],
      );
      expect(directSignature.rows).toEqual([]);

      const session = await getSessionAsAnon(tokenHash);
      expect(session?.state).toBe("pending");
    });
  });
});
