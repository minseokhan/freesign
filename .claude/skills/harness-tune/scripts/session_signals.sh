#!/usr/bin/env bash
# 세션 전사(jsonl)에서 "하네스 마찰 신호"만 뽑는다.
# 컨텍스트가 압축돼 초반 대화가 사라졌을 때도 증거를 복원하기 위한 보조 도구다.
#
# usage: session_signals.sh [transcript.jsonl]
#   인자 생략 시 현재 프로젝트 디렉터리의 가장 최근 전사를 쓴다.
set -uo pipefail

F="${1:-}"
if [ -z "$F" ]; then
  SLUG="$(pwd | tr '/.' '-')"
  DIR="$HOME/.claude/projects/$SLUG"
  F="$(ls -t "$DIR"/*.jsonl 2>/dev/null | head -1)"
fi
[ -f "$F" ] || { echo "전사 파일을 찾지 못했습니다: ${F:-<none>}" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq가 필요합니다." >&2; exit 1; }

echo "# transcript: $F"

echo
echo "## 1. 사용자 발화 (정정·불만·재지시가 여기 있다)"
jq -r '
  select(.type=="user")
  | .message.content
  | (if type=="string" then . else (map(select(.type=="text").text) | join("\n")) end)
  | select(. != null and (. | ltrimstr(" ") | length) > 0)
' "$F" 2>/dev/null | grep -v '^\s*$' | cut -c1-300 | head -60

echo
echo "## 2. 마찰 신호 (실패한 툴콜·훅 차단·사용자 거부)"
# 파일 '내용'에 우연히 섞인 문구가 아니라, 실제로 실패로 표시된 결과만 본다.
jq -r '
  .. | objects | select(.type=="tool_result" and .is_error==true)
  | (.content | if type=="string" then . else (map(select(.type=="text").text) | join(" ")) end)
  | gsub("\n"; " ")
' "$F" 2>/dev/null | cut -c1-200 | sort -u | head -25
jq -r '
  .. | objects | select(.type=="tool_result")
  | (.content | if type=="string" then . else (map(select(.type=="text").text) | join(" ")) end)
  | gsub("\n"; " ")
  | select(test("^\\s*(BLOCKED|Error: BLOCKED)|doesn.t want to (proceed|take)|user rejected|사용자가 거부"))
' "$F" 2>/dev/null | cut -c1-200 | sort -u | head -15

echo
echo "## 3. 이번 세션에서 편집된 하네스 파일"
jq -r '
  .. | objects | select(.type=="tool_use" and (.name=="Edit" or .name=="Write" or .name=="NotebookEdit"))
  | .input.file_path // empty
' "$F" 2>/dev/null \
  | grep -aE 'CLAUDE\.md|AGENTS\.md|\.claude/|evals/harness|/memory/' \
  | sort -u | head -40

echo
echo "## 4. 규모 (참고: 신호가 적으면 이번 세션은 튠 대상이 아닐 수 있다)"
printf 'lines=%s\n' "$(wc -l < "$F" | tr -d ' ')"
