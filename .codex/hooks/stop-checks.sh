#!/bin/bash
# Stop 훅 — 턴 종료 시 lint/build/test 를 실행해 품질 게이트를 강제한다.
# Codex Stop 훅은 exit 0 시 stdout 에 JSON 을 요구한다(plain text 는 무효).
# 검사 실패 시 decision:"block" 으로 Codex 가 수정을 이어가도록 한다.

INPUT=$(cat)

# 이미 한 번 Stop 훅으로 이어진 턴이면 재차단하지 않는다(무한 루프 방지).
if [ "$(echo "$INPUT" | jq -r '.stop_hook_active // false')" = "true" ]; then
  echo '{}'
  exit 0
fi

# package.json 이 없으면(템플릿 초기 상태) 검사를 건너뛴다.
if [ ! -f package.json ]; then
  echo '{}'
  exit 0
fi

run_check() {
  local NAME="$1"
  shift
  local OUT

  if OUT=$("$@" 2>&1); then
    CHECK_LOG="${CHECK_LOG}
## ${NAME}: 통과
${OUT}"
    return 0
  fi

  FAILED_STAGE="$NAME"
  FAILED_OUTPUT="$OUT"
  return 1
}

CHECK_LOG=""
FAILED_STAGE=""
FAILED_OUTPUT=""

if run_check "lint" npm run lint &&
   run_check "build" npm run build &&
   run_check "test" npm run test; then
  echo '{}'
  exit 0
fi

HINT=""
if echo "$FAILED_OUTPUT" | grep -qE 'listen EPERM: operation not permitted 127\.0\.0\.1'; then
  HINT="

분류: 샌드박스 로컬 리스닝 권한 문제
조치: 코드 실패가 아닐 수 있습니다. 필요한 경우 샌드박스 밖에서 테스트를 재실행하세요."
fi

jq -cn --arg r "품질 검사(lint/build/test) 실패.
실패 단계: ${FAILED_STAGE}${HINT}

통과한 단계:
${CHECK_LOG}

실패 출력:
${FAILED_OUTPUT}" '{decision: "block", reason: $r}'
exit 0
