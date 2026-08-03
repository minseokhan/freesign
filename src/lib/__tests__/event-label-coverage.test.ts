// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CONTRACT_EVENT_LABELS } from "@/lib/contracts/event-labels";
import { INVOICE_EVENT_LABELS } from "@/lib/invoices/event-labels";

// 이벤트 타입을 새로 발생시키면서 라벨 등록을 빠뜨리면, 타임라인에 "invoice.sent" 같은
// 날것의 문자열이 그대로 노출된다(라벨 조회는 폴백이 있어 조용히 통과한다).
// 실제로 invoice.dunning_sent(fb9e660)·invoice.sent(0046) 두 번 연속 누락됐으므로 기계로 막는다.

const REPO_ROOT = path.resolve(__dirname, "../../..");

// 계약·인보이스 타임라인이 쓰는 이벤트만 대상이다(billing_events는 표시 표면이 다르다).
/** Server Action·라우트가 RPC로 넘기는 이벤트 타입: p_event_type: "..." / event_type: "..." */
const TS_EVENT_TYPE =
  /(?:p_)?event_type:\s*"((?:invoice|contract|signature_request)\.[a-z_]+)"/g;
/** DEFINER 함수가 직접 INSERT하는 이벤트 타입(크론·데모 시드 등) */
const SQL_EVENT_TYPE = /'((?:invoice|contract|signature_request)\.[a-z_]+)'/g;

function walk(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);

    if (statSync(full).isDirectory()) {
      return walk(full, extensions);
    }

    return extensions.some((ext) => full.endsWith(ext)) ? [full] : [];
  });
}

function collect(files: string[], pattern: RegExp): Set<string> {
  const found = new Set<string>();

  for (const file of files) {
    const source = readFileSync(file, "utf8");

    for (const match of source.matchAll(pattern)) {
      found.add(match[1]);
    }
  }

  return found;
}

const emitted = new Set([
  ...collect(walk(path.join(REPO_ROOT, "src"), [".ts", ".tsx"]), TS_EVENT_TYPE),
  ...collect(
    walk(path.join(REPO_ROOT, "supabase/migrations"), [".sql"]),
    SQL_EVENT_TYPE,
  ),
]);

describe("이벤트 타입 라벨 커버리지", () => {
  it("스캐너가 실제로 이벤트 타입을 찾는다 (공허한 통과 방지)", () => {
    expect(emitted.size).toBeGreaterThanOrEqual(8);
    expect(emitted).toContain("invoice.issued");
    expect(emitted).toContain("signature_request.sent");
  });

  it("코드가 발생시키는 모든 이벤트 타입에 사용자용 라벨이 있다", () => {
    const unlabeled = [...emitted].filter((eventType) => {
      const labels = eventType.startsWith("invoice.")
        ? INVOICE_EVENT_LABELS
        : CONTRACT_EVENT_LABELS;

      return labels[eventType] === undefined;
    });

    expect(unlabeled).toEqual([]);
  });
});
