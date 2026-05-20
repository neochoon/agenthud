# AgentHUD range summary demo (all dailies cached, range cache hit).
# Generates: demo/summary-range.gif
#
# To regenerate:
#   vhs demo/summary-range.tape
#
# Shows how a past-only range returns the synthesized weekly summary
# instantly from cache — the "weekly digest in 0.5 s" pitch.
#
# Adjust the date range to one where:
#   1. every daily summary is already cached, AND
#   2. the range output is already cached at ~/.agenthud/summaries/range-FROM_TO.md.
# Run the range once normally beforehand to populate both layers.

Output demo/summary-range.gif

Set FontSize 16
Set Width 1400
Set Height 800
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms

Sleep 800ms

Type "agenthud summary --from 2026-05-11 --to 2026-05-16"
Enter

# Cache hit: "cached range summary from ..." then the meta-summary
# dumps to stdout in one shot.
Sleep 6s

# ────────────────────────────────────────────────────────────────────
# For a LIVE generation demo (much longer GIF, includes per-day
# confirmation prompts and Claude streaming), use:
#
# Type "agenthud summary --last 7d -y"
# Enter
# Sleep 90s
