// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";

import { createUser } from "@/test/pg";
import { seedDemo } from "@/lib/db/seed";

describe("demo database seed", () => {
  let pool: Pool;
  let userId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
    userId = await createUser(pool, "seed@example.test");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("inserts the scenario client, contract, and invoice as demo rows with valid FKs", async () => {
    const seeded = await seedDemo(pool, userId);

    const result = await pool.query<{
      client_id: string;
      client_user_id: string;
      client_name: string;
      channel: string;
      client_is_demo: boolean;
      contract_id: string;
      contract_user_id: string;
      title: string;
      scope: string;
      amount: string;
      start_date: string;
      end_date: string;
      status: string;
      clauses: unknown;
      contract_is_demo: boolean;
      invoice_id: string;
      invoice_user_id: string;
      invoice_amount: string;
      issue_date: string;
      due_date: string;
      withholding_type: string;
      withholding_amount: string;
      net_amount: string;
      payment_status: string;
      invoice_is_demo: boolean;
    }>(
      `
        select
          c.id as client_id,
          c.user_id as client_user_id,
          c.name as client_name,
          c.channel,
          c.is_demo as client_is_demo,
          ct.id as contract_id,
          ct.user_id as contract_user_id,
          ct.title,
          ct.scope,
          ct.amount,
          ct.start_date::text as start_date,
          ct.end_date::text as end_date,
          ct.status,
          ct.clauses,
          ct.is_demo as contract_is_demo,
          i.id as invoice_id,
          i.user_id as invoice_user_id,
          i.amount as invoice_amount,
          i.issue_date::text as issue_date,
          i.due_date::text as due_date,
          i.withholding_type,
          i.withholding_amount,
          i.net_amount,
          i.payment_status,
          i.is_demo as invoice_is_demo
        from clients c
        join contracts ct on ct.client_id = c.id
        join invoices i on i.contract_id = ct.id and i.client_id = c.id
        where c.id = $1 and ct.id = $2 and i.id = $3
      `,
      [seeded.clientId, seeded.contractId, seeded.invoiceId],
    );

    expect(result.rows).toHaveLength(1);

    const row = result.rows[0];
    expect(row.client_user_id).toBe(userId);
    expect(row.contract_user_id).toBe(userId);
    expect(row.invoice_user_id).toBe(userId);
    expect(row.client_is_demo).toBe(true);
    expect(row.contract_is_demo).toBe(true);
    expect(row.invoice_is_demo).toBe(true);
    expect(row.client_name).toBe("무디");
    expect(row.channel).toBe("instagram");
    expect(row.title).toBe("무디 브랜드 리뉴얼");
    expect(row.scope).toBe("브랜드 로고 리뉴얼 + 인스타 템플릿 5종");
    expect(Number(row.amount)).toBe(3_000_000);
    expect(Number(row.invoice_amount)).toBe(3_000_000);
    expect(row.start_date).toBe("2026-07-01");
    expect(row.end_date).toBe("2026-07-21");
    expect(row.status).toBe("signed");
    expect(row.withholding_type).toBe("wt_3_3");
    expect(Number(row.withholding_amount)).toBe(99_000);
    expect(Number(row.net_amount)).toBe(2_901_000);
    expect(Number(row.net_amount)).toBe(Number(row.invoice_amount) - Number(row.withholding_amount));
    expect(row.payment_status).toBe("paid");
    expect(row.issue_date).toBe("2026-07-22");
    expect(row.due_date).toBe("2026-08-05");
    expect(row.clauses).toEqual([
      {
        title: "업무 범위",
        body: "김하나는 무디의 브랜드 로고 리뉴얼과 인스타그램 템플릿 5종 제작 업무를 수행한다.",
        plain_summary: "로고와 인스타 템플릿 5개를 3주 안에 만든다는 뜻입니다.",
        needs_review: false,
      },
      {
        title: "대금 및 지급",
        body: "무디는 본 계약의 대가로 총 3,000,000원을 지급하며, 인보이스에 명시된 지급기한까지 입금한다.",
        plain_summary: "총 대금은 300만원이고 청구서 기한까지 입금합니다.",
        needs_review: false,
      },
      {
        title: "저작권 및 사용권",
        body: "최종 산출물의 사용 범위와 원본 파일 제공 여부는 당사자 간 별도 합의에 따른다.",
        plain_summary: "산출물을 어디까지 쓸 수 있는지는 별도 확인이 필요합니다.",
        needs_review: true,
      },
    ]);
  });
});
