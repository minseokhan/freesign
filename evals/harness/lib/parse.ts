// 케이스 파일 파서 — 순수 함수. 네트워크·fs·키 없음.
// 최소 frontmatter 서브셋만 지원: `key: value` 스칼라와 `key:` 뒤 `- item` 리스트.
// 의존성(yaml)을 끌어오지 않고 골든셋이 요구하는 형태만 정확히 파싱한다.

import type { ParsedCase, Track } from "./types.ts";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

interface RawFrontmatter {
  [key: string]: string | string[];
}

/** frontmatter 텍스트(--- 사이) → 키/값 맵. 순수. */
export function parseFrontmatter(fm: string): RawFrontmatter {
  const out: RawFrontmatter = {};
  let listKey: string | null = null;

  for (const rawLine of fm.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && listKey) {
      (out[listKey] as string[]).push(unquote(listItem[1]));
      continue;
    }

    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) {
      throw new Error(`frontmatter 파싱 실패: "${rawLine}"`);
    }
    const [, key, value] = kv;
    if (value === "") {
      out[key] = [];
      listKey = key;
    } else {
      out[key] = unquote(value);
      listKey = null;
    }
  }
  return out;
}

function unquote(s: string): string {
  const t = s.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function asString(v: string | string[] | undefined, field: string, id: string): string {
  if (typeof v !== "string") throw new Error(`[${id}] "${field}"는 스칼라여야 함`);
  return v;
}

function asList(v: string | string[] | undefined, field: string, id: string): string[] {
  if (!Array.isArray(v)) throw new Error(`[${id}] "${field}"는 리스트여야 함`);
  return v;
}

/** 케이스 파일 원문 → ParsedCase. 라벨 유효성까지 검증. 순수. */
export function parseCase(raw: string, filename = "<inline>"): ParsedCase {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) throw new Error(`${filename}: --- frontmatter --- 블록이 없음`);
  const fm = parseFrontmatter(m[1]);
  const body = m[2].trim();

  const id = asString(fm.id, "id", filename);
  const track = asString(fm.track, "track", filename) as Track;
  if (track !== "review" && track !== "qa") {
    throw new Error(`[${id}] track은 review|qa 여야 함 (받음: ${track})`);
  }
  if (body === "") throw new Error(`[${id}] 본문이 비어 있음`);

  const parsed: ParsedCase = { id, track, body };

  if (track === "review") {
    const expect = asString(fm.expect, "expect", id);
    if (expect !== "violation" && expect !== "pass") {
      throw new Error(`[${id}] review 케이스의 expect는 violation|pass 여야 함`);
    }
    parsed.expect = expect;
    if (expect === "violation") {
      parsed.rule = asString(fm.rule, "rule", id);
    }
  } else {
    parsed.must = asList(fm.must, "must", id);
    parsed.must_not = asList(fm.must_not, "must_not", id);
    if (parsed.must.length === 0) throw new Error(`[${id}] qa 케이스는 must 사실이 1개 이상 필요`);
    if (parsed.must_not.length === 0)
      throw new Error(`[${id}] qa 케이스는 must_not 사실이 1개 이상 필요`);
    if (typeof fm.guard === "string") parsed.guard = fm.guard;
  }

  return parsed;
}
