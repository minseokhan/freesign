// 케이스 파일 로더 — fs만 사용(네트워크·키 없음). 파서는 lib/parse.ts.

import fs from "node:fs";
import path from "node:path";
import { parseCase } from "./parse.ts";
import type { ParsedCase } from "./types.ts";

/** evals/harness/cases 절대 경로. */
export const CASES_DIR = path.resolve(import.meta.dirname, "..", "cases");

/** dir 아래 모든 *.md 를 파싱해 id 순으로 반환. 파싱 실패 시 파일명과 함께 던진다. */
export function loadCases(dir: string): ParsedCase[] {
  const entries = fs.readdirSync(dir, { recursive: true, encoding: "utf8" });
  const files = entries.filter((f) => f.endsWith(".md")).sort();

  const cases = files.map((rel) => {
    const abs = path.join(dir, rel);
    const raw = fs.readFileSync(abs, "utf8");
    return parseCase(raw, rel);
  });

  cases.sort((a, b) => a.id.localeCompare(b.id));
  return cases;
}
