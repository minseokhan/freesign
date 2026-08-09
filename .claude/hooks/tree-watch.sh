#!/bin/bash
# Tree Watch Hook — PreToolUse[Edit|Write]
#
# 같은 워킹트리를 다른 세션·에이전트가 함께 쓰면, 브랜치가 바뀌거나 누군가 stash를
# 쌓는 순간 내 미커밋 편집이 조용히 사라진다. 그 상태를 모른 채 편집을 이어가면
# 되돌아간 파일 위에 편집이 얹혀 반쯤 되살아난 중복 변경이 커밋된다.
#
# 편집 직전에 그 변화를 감지해 1회 차단하고, 상태를 먼저 갱신하므로
# 확인 후 같은 편집을 다시 시도하면 통과한다(자기해제).
#
# 추적 대상은 브랜치명과 stash 개수 둘뿐이다. HEAD 커밋 해시는 일부러 보지 않는다 —
# 내가 커밋할 때마다 바뀌어서 오탐이 매번 난다.

cat >/dev/null  # stdin(tool_input)은 쓰지 않지만 파이프는 비워 준다

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
GIT_DIR=$(git rev-parse --absolute-git-dir 2>/dev/null) || exit 0

BRANCH=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
STASHES=$(git -C "$ROOT" stash list 2>/dev/null | wc -l | tr -d ' ')

STATE_FILE="$GIT_DIR/claude-tree-watch"
CURRENT="${BRANCH}:${STASHES}"

# 첫 편집이면 기준선만 잡고 통과
if [ ! -f "$STATE_FILE" ]; then
  printf '%s' "$CURRENT" >"$STATE_FILE"
  exit 0
fi

PREVIOUS=$(cat "$STATE_FILE" 2>/dev/null)

# 자기해제: 차단하기 전에 먼저 갱신해 둔다. 재시도는 통과한다.
printf '%s' "$CURRENT" >"$STATE_FILE"

[ "$PREVIOUS" = "$CURRENT" ] && exit 0

PREV_BRANCH=${PREVIOUS%%:*}
PREV_STASHES=${PREVIOUS##*:}

REASON=""
if [ "$PREV_BRANCH" != "$BRANCH" ]; then
  REASON="브랜치가 '${PREV_BRANCH}' → '${BRANCH}' 로 바뀌었습니다."
fi
if [ "$PREV_STASHES" != "$STASHES" ]; then
  REASON="${REASON}${REASON:+ }stash 개수가 ${PREV_STASHES} → ${STASHES} 로 바뀌었습니다."
fi

cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "TREE WATCH: 마지막 편집 이후 워킹트리가 움직였습니다. ${REASON} 다른 세션·에이전트가 같은 트리를 쓰고 있고, 그 과정에서 커밋하지 않은 편집이 stash로 치워졌을 수 있습니다. 편집을 이어가기 전에 'git status'와 'git stash list'로 이전 변경이 남아 있는지 확인하세요(복구가 필요하면 'git stash show -p stash@{0}' 로 내용을 먼저 확인하고 패치로 백업). 확인했다면 같은 편집을 다시 시도하면 통과합니다 — 상태는 이미 갱신됐습니다."
  }
}
EOF

exit 0
