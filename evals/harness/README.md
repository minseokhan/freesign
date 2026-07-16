# 하네스 품질 eval

이 eval은 **제품(비즈니스 로직)을 재지 않는다.** 재는 대상은 "하네스 품질" —
즉 `CLAUDE.md`의 규약과 CRITICAL 경계가 **모델을 실제로 올바른 방향으로 몰아가는지**다.
`lib/tax.ts` 같은 도메인 로직 테스트는 `src/` 쪽 Vitest가 담당하고, 여기서는
"규약이 규약대로 작동하는가"만 회귀로 지킨다.

## 두 트랙

| 트랙 | 피험(subject) | 무엇을 재나 | 채점 |
|------|---------------|-------------|------|
| **review** | 경량 리뷰어 (Sonnet, CRITICAL **요약**을 시스템 프롬프트로) | 코드가 CRITICAL 경계를 어기면 잡는가, 정상 코드에 오탐하지 않는가 | Opus (LLM-as-judge) |
| **qa** | 응답자 (Sonnet, **라이브 `CLAUDE.md` 전문**을 컨텍스트로) | 규약·예외처리 gotcha 질문에 사실대로 답하는가, 틀린 전제를 반박하는가 | Opus (LLM-as-judge) |

- review 골든셋: **위반 4건 + 정상 1건**. 정상 1건은 오탐(false positive) 방지 앵커다.
- qa 골든셋: 각 케이스에 `must`/`must_not` 사실 라벨. 그중 1건은 **틀린 전제를 심은 반박 가드**(`guard: false-premise`) — 계약(contracts)은 soft-delete가 아니라 물리 삭제라는 예외를 응답자가 바로잡아야 pass.

두 트랙의 컨텍스트 주입 방식이 다른 것은 의도적이다. review는 CRITICAL을 **박제한 요약 루브릭**을 재고, qa는 **살아있는 문서 자체**가 정답을 지지하는지 재기 때문이다.

## 원칙: 작게 시작, 라벨은 사람이 박제한다

- 골든셋은 **작게 시작**한다. 케이스가 많아서가 아니라, 각 케이스가 **명확한 정답을 가진 대표 사례**라서 가치가 있다.
- **라벨(정답)은 사람이 박제한다.** `expect`·`rule`·`must`·`must_not`·`guard`는 자동 생성물이 아니라 사람이 검토해 고정한 진실이다. 모델이 스스로 정답을 정하게 두면 게이트가 자기 자신을 채점하는 순환에 빠진다.
- 케이스를 추가할 땐 라벨을 먼저 확정하고, 그 라벨이 `npm test`의 균형 검사를 통과하는지 확인한다.

## 실행: 두 층으로 분리

키·네트워크·비용이 **드는 것과 안 드는 것**을 반드시 갈라 둔다.

```bash
# 1) 키 없이 — 파서·집계·판정 순수 로직 + 골든셋 무결성/균형
npm test                    # (evals/harness/**/*.test.ts 가 자동 포함됨)

# 2) 키·비용 있음 — 라이브 채점 회귀 게이트
ANTHROPIC_API_KEY=... npm run eval    # 하나라도 fail → exit 1
```

`npm test`는 다음을 키 없이 보장한다:
- frontmatter 파서 / 집계기 / judge JSON 파서의 정확성
- 트랙 오케스트레이션 배선(피험→judge 순서, 프롬프트에 라벨·응답이 실림) — 네트워크는 목(mock)
- 골든셋 **균형**: review 위반 4+·정상 1+, qa 전 케이스 must/must_not 존재, 반박 가드 1+, id 유일성

## 케이스 파일 형식 (`cases/*.md`)

frontmatter 라벨 + 본문 입력.

```md
---
id: review-01
track: review
expect: violation        # violation | pass
rule: write-boundary     # violation일 때 필수(겨냥한 CRITICAL 슬러그)
---
클라이언트 컴포넌트에서 supabase.update 직접 호출 …   ← 본문 = 리뷰 대상 코드
```

```md
---
id: qa-01
track: qa
guard: false-premise     # (선택) 틀린 전제 반박 가드
must:
  - "계약(contracts)은 물리 삭제(hard delete)"
must_not:
  - "계약도 deleted_at 으로 soft-delete 된다"
---
계약도 soft-delete로 지워지죠? …   ← 본문 = 질문
```

## 구조

```
evals/harness/
  run.ts                게이트 엔트리 (npm run eval) — subject→judge, fail시 exit 1
  lib/parse.ts          frontmatter+본문 파서            (순수)
  lib/aggregate.ts      집계·exit code·요약 포맷          (순수)
  lib/judge.ts          judge JSON 판정 파서             (순수)
  lib/prompts.ts        CRITICAL 요약 시스템프롬프트·judge 프롬프트 (순수)
  lib/cases.ts          케이스 fs 로더                   (네트워크 없음)
  lib/anthropic.ts      SDK 래퍼                         (라이브 전용)
  tracks/review.ts,qa.ts  트랙별 subject+judge 오케스트레이션 (라이브)
  cases/review/*.md     위반 4 + 정상 1
  cases/qa/*.md         must/must_not + 반박 가드 1
  **/*.test.ts          키 없는 무결성/균형/배선 검사
```

## 모델

- 피험(subject): `claude-sonnet-5`
- 채점(judge): `claude-opus-4-8` — 피험과 **다른 모델**이어야 자기채점 편향을 피한다.

`lib/anthropic.ts`의 상수만 바꾸면 교체된다. 최신 모델(Opus 4.8·Sonnet 5)은 `temperature` 파라미터를 제거(보내면 400)했으므로 샘플링 파라미터는 넣지 않는다 — 결정성은 낮은 온도가 아니라 명확한 골든셋과 프롬프트로 담보한다.
