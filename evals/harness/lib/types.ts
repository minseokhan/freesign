// 하네스 품질 eval의 공용 타입. 순수 타입 정의만 — 런타임 코드 없음.

export type Track = "review" | "qa";

/** cases/*.md 한 파일을 파싱한 결과. frontmatter 라벨 + 본문 입력. */
export interface ParsedCase {
  id: string;
  track: Track;
  /** 본문: review는 코드 스니펫, qa는 질문. */
  body: string;

  // --- review 트랙 라벨 ---
  /** 이 코드가 위반인지 정상인지 (사람이 박제한 정답). */
  expect?: "violation" | "pass";
  /** 위반 케이스가 겨냥하는 CRITICAL 규칙 슬러그. */
  rule?: string;

  // --- qa 트랙 라벨 ---
  /** 답변에 반드시 담겨야 하는 사실. */
  must?: string[];
  /** 답변에 담기면 안 되는 사실(오답/틀린 전제 수용 등). */
  must_not?: string[];
  /** 가드 유형. 예: "false-premise"(틀린 전제 반박). */
  guard?: string;
}

/** 한 케이스를 subject→judge까지 돌린 라이브 채점 결과. */
export interface CaseResult {
  id: string;
  track: Track;
  verdict: "pass" | "fail";
  reason: string;
  /** subject(피험 모델)의 원문 응답 — 디버깅용. */
  subjectOutput: string;
}

/** 전체 집계 요약. run.ts가 exitCode로 게이트를 건다. */
export interface Summary {
  total: number;
  passed: number;
  failed: number;
  byTrack: Record<Track, { total: number; passed: number; failed: number }>;
  failures: CaseResult[];
  /** 하나라도 fail이면 1. */
  exitCode: 0 | 1;
}
