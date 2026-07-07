import type { QueryResult, QueryResultRow } from "pg";

type SqlExecutor = {
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult<T>>;
};

type SeedDemoResult = {
  clientId: string;
  contractId: string;
  invoiceId: string;
};

const demoClauses = [
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
];

export async function seedDemo(exec: SqlExecutor, userId: string): Promise<SeedDemoResult> {
  const clientResult = await exec.query<{ id: string }>(
    `
      insert into clients (
        user_id, name, channel, contact_email, memo, is_demo
      )
      values (
        $1, '무디', 'instagram', 'hello@moodi.example', '인스타그램 DM으로 문의한 카페 브랜드', true
      )
      returning id
    `,
    [userId],
  );
  const clientId = clientResult.rows[0].id;

  const contractResult = await exec.query<{ id: string }>(
    `
      insert into contracts (
        user_id, client_id, title, scope, amount, start_date, end_date,
        status, clauses, is_demo
      )
      values (
        $1, $2, '무디 브랜드 리뉴얼', '브랜드 로고 리뉴얼 + 인스타 템플릿 5종',
        3000000, '2026-07-01', '2026-07-21', 'signed', $3::jsonb, true
      )
      returning id
    `,
    [userId, clientId, JSON.stringify(demoClauses)],
  );
  const contractId = contractResult.rows[0].id;

  const invoiceResult = await exec.query<{ id: string }>(
    `
      insert into invoices (
        user_id, contract_id, client_id, amount, issue_date, due_date,
        withholding_type, withholding_amount, net_amount, payment_status,
        paid_at, payment_method, is_demo
      )
      values (
        $1, $2, $3, 3000000, '2026-07-22', '2026-08-05',
        'wt_3_3', 99000, 2901000, 'paid',
        '2026-08-05T09:00:00+09:00', 'bank_transfer', true
      )
      returning id
    `,
    [userId, contractId, clientId],
  );
  const invoiceId = invoiceResult.rows[0].id;

  return { clientId, contractId, invoiceId };
}
