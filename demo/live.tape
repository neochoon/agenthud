# AgentHUD demo — the three layers, in one recording.
# Generates: demo/live.gif
#
# To regenerate:
#   vhs demo/live.tape
#
# Mirrors the README's structure, by who's reading:
#   1. `agenthud`          — the live HUD: browse the tree, Tab into the
#                            activity viewer, scroll history with the arrow
#                            key, peek at one activity's detail, then quit
#                            (alt-screen restores the pre-launch shell).
#   2. `agenthud summary`  — the daily digest: an engineering summary,
#                            served instantly from cache (Kiro engine).
#   3. `agenthud report`   — the machine layer: the structured activity
#                            timeline the summary is built from.

Output demo/live.gif

Set FontSize 16
Set Width 1400
Set Height 800
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms

# ── 1 · The live HUD ───────────────────────────────────────────────
# Pre-launch shell prompt visible
Sleep 800ms

Type "agenthud"
Enter
Sleep 2500ms

# Browse the project tree
Type "j"
Sleep 600ms
Type "j"
Sleep 600ms
Type "j"
Sleep 800ms

# Tab into the activity viewer, then scroll up through history with the
# arrow key
Tab
Sleep 1200ms
Up
Sleep 450ms
Up
Sleep 450ms
Up
Sleep 450ms
Up
Sleep 700ms

# Peek at the selected activity's detail (tool body / edit diff / output),
# then collapse back to the viewer
Enter
Sleep 3000ms
Escape
Sleep 700ms

# Quit — alt-screen exits, the pre-launch shell prompt returns
Type "q"
Sleep 1300ms

# ── 2 · The daily digest ───────────────────────────────────────────
# Instant from cache. --engine picks which agent CLI synthesizes it.
Type "agenthud summary --date 2026-06-10 --engine kiro"
Enter
Sleep 4000ms

# ── 3 · The machine layer ──────────────────────────────────────────
# The same day as a structured timeline — what `summary` is built from.
# `report` scans every provider before printing (~3.5s here), so the
# Sleep covers that discovery plus a few seconds to read the timeline.
Type "agenthud report --date 2026-06-10"
Enter
Sleep 7500ms
