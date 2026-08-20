// 규칙 정본(.claude/rules.json) 로더 — fs만 사용(네트워크·키 없음).
// 파싱·파생 로직은 src/lib/review/rules.ts(순수). 여기서는 읽기만 한다.
// alias(@/)는 node --experimental-strip-types 실행에서 해석되지 않으므로 상대 경로로 import한다.

import fs from "node:fs";
import path from "node:path";

import { parseRules, type RulesFile } from "../../../src/lib/review/rules.ts";

export const RULES_PATH = path.resolve(import.meta.dirname, "..", "..", "..", ".claude", "rules.json");

export function loadProjectRules(): RulesFile {
  return parseRules(JSON.parse(fs.readFileSync(RULES_PATH, "utf8")));
}
