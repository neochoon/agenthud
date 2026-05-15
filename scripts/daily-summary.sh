#!/bin/zsh
# Daily summary: pipe today's agenthud report to claude for summarization
# Usage: daily-summary.sh [--date YYYY-MM-DD]

DATE_ARG=""
if [[ "$1" == "--date" && -n "$2" ]]; then
  DATE_ARG="--date $2"
fi

agenthud report ${DATE_ARG} --detail-limit 0 --with-git | claude -p "다음은 오늘 Claude Code로 작업한 활동 로그입니다. 이를 바탕으로 오늘 작업 내용을 한국어로 간결하게 정리해주세요. 완료한 작업, 주요 변경사항, 커밋 내역 순으로 bullet point로 작성해주세요."
