// judge(Opus) 응답에서 pass/fail 판정을 추출 — 순수 함수.
// judge에게 JSON을 요구하지만 산문·코드펜스가 섞여 올 수 있어 관대하게 첫 오브젝트를 뽑는다.

export interface JudgeVerdict {
  verdict: "pass" | "fail";
  reason: string;
}

/** judge 원문 → {verdict, reason}. 파싱 실패/라벨 이상 시 던진다. 순수. */
export function parseJudgeVerdict(raw: string): JudgeVerdict {
  const json = extractFirstJsonObject(raw);
  if (!json) throw new Error(`judge 응답에서 JSON을 찾지 못함: ${raw.slice(0, 120)}`);

  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new Error(`judge JSON 파싱 실패: ${json.slice(0, 120)}`);
  }

  const rec = obj as Record<string, unknown>;
  if (rec.verdict !== "pass" && rec.verdict !== "fail") {
    throw new Error(`judge verdict는 pass|fail 여야 함 (받음: ${String(rec.verdict)})`);
  }
  return {
    verdict: rec.verdict,
    reason: typeof rec.reason === "string" ? rec.reason : "",
  };
}

/** 문자열에서 균형 잡힌 첫 번째 {...} 블록을 추출. 순수. */
function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}
