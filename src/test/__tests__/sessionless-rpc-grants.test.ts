// @vitest-environment node
import { inject } from "vitest";
import { Pool } from "pg";

// 세션 없는 경계(크론·웹훅·서명 링크)의 DEFINER RPC는 anon 클라이언트(lib/supabase/anon.ts)만
// 부른다. 인가는 함수 내부의 시크릿 게이트·토큰 해시가 담당하므로 로그인 사용자에게 실행권을
// 열어둘 이유가 없는데, 새 함수는 Supabase의 public 스키마 기본 권한으로 authenticated EXECUTE가
// 자동으로 붙고(0042), 초기 마이그레이션이 명시적으로 준 경우도 있었다(0043·0044).
//
// 게이트 함수(assert_cron_secret)는 anon에도 노출하지 않는다 — 맞으면 void·틀리면 예외라
// REST로 그대로 부를 수 있으면 부작용 없는 브루트포스 오라클이 된다. 실제 호출은 전부
// DEFINER 내부(owner 권한)라 회수해도 게이트는 동작한다.
describe("세션 없는 경계 RPC 실행 권한 (0042·0043·0044)", () => {
  let pool: Pool;

  // [함수 시그니처, anon 실행 가능, authenticated 실행 가능]
  const EXPECTED: Array<[string, boolean, boolean]> = [
    ["assert_cron_secret(text)", false, false],
    ["create_dunning_drafts_for_overdue(text, integer)", true, false],
    ["generate_due_recurring_invoices(text)", true, false],
    ["update_dunning_draft_body(text, uuid, text, text, text)", true, false],
    ["store_completion_tsa_token(text, text, text)", true, false],
    ["get_signing_session(text)", true, false],
    ["get_signed_contract_data(text)", true, false],
    ["get_certificate_data(text)", true, false],
  ];

  beforeAll(() => {
    pool = new Pool({ connectionString: inject("pgConnectionString") });
  });

  afterAll(async () => {
    await pool.end();
  });

  it.each(EXPECTED)("%s — anon=%s, authenticated=%s", async (signature, anon, authenticated) => {
    const granted = await pool.query<{ anon: boolean; authenticated: boolean }>(
      `select has_function_privilege('anon', $1, 'execute') as anon,
              has_function_privilege('authenticated', $1, 'execute') as authenticated`,
      [signature],
    );

    expect(granted.rows[0]).toEqual({ anon, authenticated });
  });
});
