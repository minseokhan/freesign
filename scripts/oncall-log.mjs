// 실패 잡 로그 정제 — stdin으로 받은 원본 로그를 꼬리만 남기고 시크릿을 마스킹해 stdout으로 낸다.
//
// GitHub이 등록된 시크릿을 ***로 가려 주긴 하지만, 조합해 만든 값·서드파티 도구가 뱉은 값은
// 그대로 나온다. 에이전트에 넣기 **전에** 한 번 지운다 (PR 본문에서 한 번 더 지운다).
//
//   gh run view "$RUN_ID" --log-failed | node --experimental-strip-types scripts/oncall-log.mjs > failed.log

import { readFileSync } from "node:fs";

import { redact, truncateLog } from "../src/lib/oncall/incident.ts";

const maxLines = Number(process.env.ONCALL_LOG_MAX_LINES || 1500);
const raw = readFileSync(0, "utf8");

process.stdout.write(redact(truncateLog(raw, maxLines)));
