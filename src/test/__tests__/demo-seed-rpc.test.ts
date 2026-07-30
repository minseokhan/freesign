// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";
import { createUser, runAs } from "../pg";

// 0039 회귀 테스트. is_demo는 0007 물리삭제 정책의 열쇠라 서버 소유 필드다.
// 데모 시드를 DEFINER RPC로 옮기고 클라이언트 INSERT/UPDATE 컬럼 권한을 회수했다.
//
// 주의: 임베디드 테스트 DB는 마이그레이션 적용 후 grantSupabaseRoles()가 모든 테이블
// 권한을 다시 grant한다 → 컬럼 grant/revoke 자체는 여기서 검증할 수 없다(원격에서
// information_schema.column_privileges로 확인). 여기서 검증하는 것은 RPC 동작이다.
describe("데모 시드 DEFINER RPC (0039)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedAs(userId: string) {
    const result = await runAs<{ seed_demo_data: boolean }>(
      pool,
      userId,
      "select seed_demo_data()",
    );

    return result.rows[0].seed_demo_data;
  }

  it("호출자 계정에 데모 클라이언트·계약·인보이스와 감사 이벤트를 만든다", async () => {
    const userId = await createUser(pool);

    expect(await seedAs(userId)).toBe(true);

    const counts = await pool.query<{ clients: string; contracts: string; invoices: string }>(
      `select
         (select count(*) from clients where user_id = $1 and is_demo) as clients,
         (select count(*) from contracts where user_id = $1 and is_demo) as contracts,
         (select count(*) from invoices where user_id = $1 and is_demo) as invoices`,
      [userId],
    );

    expect(counts.rows[0]).toEqual({ clients: "1", contracts: "1", invoices: "1" });

    const events = await pool.query<{ event_type: string }>(
      `select event_type from contract_events where user_id = $1
       union all
       select event_type from invoice_events where user_id = $1`,
      [userId],
    );

    expect(events.rows.map((row) => row.event_type).sort()).toEqual([
      "contract.demo_seeded",
      "invoice.demo_seeded",
    ]);
  });

  it("금액 스냅샷은 calcWithholding(3,000,000, wt_3_3)과 같다", async () => {
    const userId = await createUser(pool);
    await seedAs(userId);

    const invoice = await pool.query<{
      amount: string;
      withholding_amount: string;
      net_amount: string;
      payment_status: string;
    }>(
      "select amount, withholding_amount, net_amount, payment_status from invoices where user_id = $1",
      [userId],
    );

    expect(invoice.rows[0]).toEqual({
      amount: "3000000",
      withholding_amount: "99000",
      net_amount: "2901000",
      payment_status: "paid",
    });
  });

  it("이미 데모가 있으면 중복 생성하지 않는다(멱등)", async () => {
    const userId = await createUser(pool);

    expect(await seedAs(userId)).toBe(true);
    expect(await seedAs(userId)).toBe(false);

    const count = await pool.query<{ n: string }>(
      "select count(*) as n from clients where user_id = $1 and is_demo",
      [userId],
    );

    expect(count.rows[0].n).toBe("1");
  });

  it("세션이 없으면(anon) 실행 자체가 거부된다", async () => {
    const granted = await pool.query<{ has: boolean }>(
      "select has_function_privilege('anon', 'seed_demo_data()', 'execute') as has",
    );

    expect(granted.rows[0].has).toBe(false);
  });

  it("데모는 호출자 계정에만 생기고 다른 테넌트를 건드리지 않는다", async () => {
    const owner = await createUser(pool);
    const other = await createUser(pool);

    await seedAs(owner);

    const count = await pool.query<{ n: string }>(
      "select count(*) as n from clients where user_id = $1",
      [other],
    );

    expect(count.rows[0].n).toBe("0");
  });
});
