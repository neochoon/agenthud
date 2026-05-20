# AgentHUD daily summary demo (cached past date).
# Generates: demo/summary-daily.gif
#
# To regenerate:
#   vhs demo/summary-daily.tape
#
# Uses a cached past-date summary so playback is near-instant. The
# resulting GIF shows: the command, the "cached summary from ..." line,
# and the structured markdown summary that streams to stdout.
#
# Pick a date you have cached locally; the default below works on the
# author's machine.

Output demo/summary-daily.gif

Set FontSize 16
Set Width 1400
Set Height 800
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms

Sleep 800ms

Type "agenthud summary --date 2026-05-17"
Enter

# Cache hit: the full summary dumps to stdout immediately.
Sleep 5s

# ────────────────────────────────────────────────────────────────────
# Want to demo a LIVE LLM call instead? Comment out the block above
# and uncomment the block below. Expect ~30 s of streaming output
# and a real claude API charge per regeneration.
#
# Type "agenthud summary --date today --force"
# Enter
# Sleep 40s
