// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";
import { createUser, runAs } from "../pg";

// 0045_contract_post_sign_immutability 회귀 테스트.
//
// 앱 코드는 "초안만 편집 가능"을 Server Action에서 검사하지만, 그 가드는 RPC를 거칠 때만
// 작동한다. 소유자가 PostgREST로 contracts를 직접 PATCH하면 발송·서명 완료된 계약의
// clauses·amount를 바꿀 수 있었다. 서명 증빙 체인이 제품의 코어라 정책 층에서 막는다.
//
// 주의: USING에 걸리면 예외가 아니라 "0행 갱신"이다. WITH CHECK 위반만 예외를 던진다.
describe("서명 후 계약 본문 동결 (0045)", () => {
  let pool: Pool;
  let owner: string;
  let clientId: string;

  async function insertContract(status: string) {
    const inserted = await runAs<{ id: string }>(
      pool,
      owner,
      `
        insert into contracts (
          user_id, client_id, title, scope, amount, start_date, end_date, clauses
        )
        values (
          $1, $2, 'Immutability contract', 'Scope', 1000000,
          '2026-07-01', '2026-07-31',
          '[{"title":"제1조","body":"원본 본문"}]'::jsonb
        )
        returning id
      `,
      [owner, clientId],
    );

    const contractId = inserted.rows[0].id;

    // status는 클라이언트 권한 밖(0037)이라 픽스처는 superuser로 올린다.
    if (status !== "draft") {
      await pool.query("update contracts set status = $1::contract_status where id = $2", [
        status,
        contractId,
      ]);
    }

    return contractId;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
    owner = await createUser(pool, "immutability-owner@example.test");
    const client = await runAs<{ id: string }>(
      pool,
      owner,
      "insert into clients (user_id, name, channel) values ($1, 'Immutability Client', 'direct') returning id",
      [owner],
    );
    clientId = client.rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it("초안 계약의 조항·금액은 계속 직접 수정할 수 있다", async () => {
    const contractId = await insertContract("draft");

    const result = await runAs(
      pool,
      owner,
      `update contracts
         set clauses = '[{"title":"제1조","body":"수정 본문"}]'::jsonb,
             amount = 2000000
       where id = $1`,
      [contractId],
    );

    expect(result.rowCount).toBe(1);
  });

  it.each(["sent", "signed", "active", "done", "canceled"])(
    "%s 계약의 조항 직접 수정을 막는다",
    async (status) => {
      const contractId = await insertContract(status);

      const result = await runAs(
        pool,
        owner,
        `update contracts
           set clauses = '[{"title":"제1조","body":"변조된 본문"}]'::jsonb
         where id = $1`,
        [contractId],
      );

      expect(result.rowCount).toBe(0);

      const after = await pool.query<{ clauses: { body: string }[] }>(
        "select clauses from contracts where id = $1",
        [contractId],
      );
      expect(after.rows[0].clauses[0].body).toBe("원본 본문");
    },
  );

  it("서명 완료 계약의 금액 직접 수정을 막는다", async () => {
    const contractId = await insertContract("signed");

    const result = await runAs(pool, owner, "update contracts set amount = 1 where id = $1", [
      contractId,
    ]);

    expect(result.rowCount).toBe(0);
  });

  it("서명 완료 계약의 client_id 재지정을 막는다", async () => {
    const contractId = await insertContract("signed");
    const other = await runAs<{ id: string }>(
      pool,
      owner,
      "insert into clients (user_id, name, channel) values ($1, 'Other Client', 'direct') returning id",
      [owner],
    );

    const result = await runAs(pool, owner, "update contracts set client_id = $1 where id = $2", [
      other.rows[0].id,
      contractId,
    ]);

    expect(result.rowCount).toBe(0);
  });

  // 상태 전이·PDF 경로 기록은 전부 DEFINER RPC(owner=postgres)라 RLS를 우회한다.
  // 정책을 조인 뒤에도 이 경로가 살아 있는지 확인한다.
  it("DEFINER RPC의 상태 전이는 정책과 무관하게 계속 동작한다", async () => {
    const contractId = await insertContract("signed");

    await runAs(
      pool,
      owner,
      "select transition_contract_status_with_event($1, 'active'::contract_status, false, $2, 'status_changed')",
      [contractId, `user:${owner}`],
    );

    const after = await pool.query<{ status: string }>(
      "select status from contracts where id = $1",
      [contractId],
    );
    expect(after.rows[0].status).toBe("active");
  });
});
