import { describe, expect, it } from "vitest";

import { EXPORT_TABLES, stripColumns } from "@/lib/account-export";

describe("EXPORT_TABLES", () => {
  it("사용자 데이터가 있는 테이블을 빠짐없이 포함한다", () => {
    const tables = EXPORT_TABLES.map((spec) => spec.table);

    expect(tables).toEqual([
      "profiles",
      "clients",
      "contracts",
      "contract_events",
      "invoices",
      "invoice_events",
      "signature_requests",
      "contract_signatures",
      "recurring_invoices",
      "dunning_reminders",
      "contract_insights",
      "subscriptions",
      "billing_events",
    ]);
  });

  it("서명 토큰 해시와 TSA 토큰 원문을 제외 대상으로 지정한다", () => {
    const spec = EXPORT_TABLES.find(
      (entry) => entry.table === "signature_requests",
    );

    expect(spec?.omit).toContain("token_hash");
    expect(spec?.omit).toContain("sent_tsa_token");
    expect(spec?.omit).toContain("completion_tsa_token");
  });

  it("서명 이미지 원본 바이트를 제외 대상으로 지정한다", () => {
    const spec = EXPORT_TABLES.find(
      (entry) => entry.table === "contract_signatures",
    );

    expect(spec?.omit).toEqual(["signature_image_data"]);
  });
});

describe("stripColumns", () => {
  it("지정한 컬럼만 제거하고 나머지는 보존한다", () => {
    const result = stripColumns(
      [{ id: "a", secret: "x", keep: 1 }],
      ["secret"],
    );

    expect(result).toEqual([{ id: "a", keep: 1 }]);
  });

  it("제외 목록이 비면 행을 그대로 돌려준다", () => {
    const rows = [{ id: "a" }];

    expect(stripColumns(rows, [])).toEqual(rows);
  });

  it("원본 행을 변형하지 않는다", () => {
    const rows = [{ id: "a", secret: "x" }];

    stripColumns(rows, ["secret"]);

    expect(rows[0]).toHaveProperty("secret");
  });

  it("없는 컬럼을 제외 목록에 넣어도 안전하다", () => {
    expect(stripColumns([{ id: "a" }], ["nope"])).toEqual([{ id: "a" }]);
  });
});
