#!/bin/bash

# Claude Code 세션 실시간 모니터링 (jq 버전)
# 사용법: ./claude-watch.sh [프로젝트경로]

PROJECT_PATH="${1:-$(pwd)}"
CLAUDE_DIR="$HOME/.claude/projects"

# 프로젝트 경로를 Claude 세션 폴더명으로 변환
SESSION_DIR="$CLAUDE_DIR/$(echo "$PROJECT_PATH" | sed 's|/|-|g')"

echo "📁 Project: $PROJECT_PATH"
echo "📂 Session dir: $SESSION_DIR"
echo ""

if [ ! -d "$SESSION_DIR" ]; then
    echo "❌ No Claude session found for this project"
    exit 1
fi

# 가장 최근 수정된 jsonl 파일 찾기
LATEST=$(ls -t "$SESSION_DIR"/*.jsonl 2>/dev/null | head -1)

if [ -z "$LATEST" ]; then
    echo "❌ No session files found"
    exit 1
fi

echo "📄 Watching: $(basename "$LATEST")"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# jq 필터
read -r -d '' JQ_FILTER << 'EOF'
def color($c; $s): "\u001b[\($c)m\($s)\u001b[0m";

if .type == "user" then
  if (.message.content | type) == "string" then
    color("1;36"; "[\(.timestamp[11:19])] 👤 " + .message.content[0:100])
  else
    empty
  end
elif .type == "assistant" then
  if (.message.content | type) == "array" then
    (.timestamp[11:19]) as $ts |
    .message.content[] |
    if .type == "tool_use" then
      if .name == "Bash" then
        color("1;33"; "[\($ts)] 🔧 Bash: " + (.input.command | tostring))
      elif .name == "Read" then
        color("1;33"; "[\($ts)] 📖 Read: " + (.input.file_path | tostring))
      elif .name == "Edit" then
        color("1;33"; "[\($ts)] ✏️  Edit: " + (.input.file_path | tostring))
      elif .name == "Write" then
        color("1;33"; "[\($ts)] 📝 Write: " + (.input.file_path | tostring))
      elif .name == "MultiEdit" then
        color("1;33"; "[\($ts)] ✏️  MultiEdit: " + (.input.file_path | tostring))
      else
        color("1;33"; "[\($ts)] 🔧 " + .name + ": " + ((.input | tostring)[0:80]))
      end
    elif .type == "text" then
      color("1;32"; "[\($ts)] 🤖 " + (.text[0:100] | gsub("\n"; " ")))
    else
      empty
    end
  else
    empty
  end
elif .type == "summary" then
  color("1;34"; "[SESSION] 📋 " + .summary)
elif .type == "system" and .subtype == "stop_hook_summary" then
  color("1;35"; "[\(.timestamp[11:19])] ⏹️  stopped")
else
  empty
end
EOF

tail -f -n 30 "$LATEST" | jq -r --unbuffered "$JQ_FILTER"
