#!/usr/bin/env bash
# Interactive screencast workflow: record what you do in the terminal,
# automatically encode to demo/live.gif on Ctrl+D.
#
# Usage:
#   scripts/record-demo.sh
#
# Override defaults with env vars, e.g.:
#   COLS=120 ROWS=32 AGG_THEME=dracula scripts/record-demo.sh
#
# Dependencies (install once):
#   brew install asciinema agg

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CAST="$ROOT/demo/.cache/live.cast"
GIF="$ROOT/demo/live.gif"

# Approximately matches the VHS tape (Width 1400, Height 800, FontSize 16).
# Tune COLS/ROWS to taste — most modern emulators honor the xterm resize
# escape used below.
COLS="${COLS:-140}"
ROWS="${ROWS:-38}"

# agg ships: asciinema, dracula, github-dark, github-light, monokai,
# solarized-dark, solarized-light. Pass a path to a TOML file for
# anything else (e.g. Catppuccin Mocha).
AGG_THEME="${AGG_THEME:-monokai}"
AGG_FONT_SIZE="${AGG_FONT_SIZE:-16}"

for cmd in asciinema agg; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[record-demo] $cmd not found. Install with: brew install $cmd" >&2
    exit 1
  fi
done

mkdir -p "$(dirname "$CAST")"
rm -f "$CAST"

# Ask the terminal to resize itself. Works in iTerm2, Terminal.app,
# kitty, alacritty, wezterm; silently ignored elsewhere.
printf '\033[8;%d;%dt' "$ROWS" "$COLS"

cat <<EOF
[record-demo]
  size   : ${COLS} cols × ${ROWS} rows
  cast   : ${CAST}
  gif    : ${GIF}

  Tips:
    - Type 'clear' once the recording shell appears so the prompt
      starts on a clean screen (your normal PS1 will be captured
      otherwise).
    - Run your scenario at a natural pace.
    - When you're done, press Ctrl+D (or type 'exit') to stop.

EOF

read -r -p "Press Enter to start recording..." _

asciinema rec "$CAST"

echo
echo "[record-demo] Encoding ${CAST} → ${GIF}"
agg --font-size "$AGG_FONT_SIZE" --theme "$AGG_THEME" "$CAST" "$GIF"

echo "[record-demo] Done: ${GIF}"
echo "[record-demo] Preview: open '${GIF}'"
