# Demo recordings

Reproducible terminal recordings for the README's animated demos,
written as [VHS](https://github.com/charmbracelet/vhs) tape files.

| Tape | Output | What it shows |
|------|--------|---------------|
| `live.tape` | `live.gif` | The three layers in one take: the live HUD (browse the tree, Tab into the viewer, scroll with the arrow key, open an activity's detail), then `agenthud summary` (a cached daily digest), then `agenthud report` (the structured timeline it's built from). |
| `summary-daily.tape` | `summary-daily.gif` | `agenthud summary --date <past date>` returning instantly from cache. |
| `summary-range.tape` | `summary-range.gif` | `agenthud summary --from X --to Y` returning a cross-day digest instantly from the range cache. |

## Regenerating

Install VHS:

```bash
brew install vhs       # macOS
# or: go install github.com/charmbracelet/vhs@latest
```

Run from the repo root:

```bash
vhs demo/live.tape
vhs demo/summary-daily.tape
vhs demo/summary-range.tape
```

Each command writes its `.gif` next to the `.tape`. Commit the GIFs so
the README renders without contributors needing VHS installed.

## Notes

- **Summary tapes use cached past dates** so playback is near-instant
  and free. Each tape has a commented-out block at the bottom for
  doing a real LLM call instead — uncomment if you want to show the
  streaming + token-usage line, accepting the time and cost.
- **Adjust dates** in the summary tapes to match what's actually cached
  on the machine generating the GIF (`ls ~/.agenthud/summaries/`).
- **Styling** (font size, theme, dimensions, typing speed) is set at
  the top of each tape. Edit there to retune.
- The `live.tape` recording captures the alt-screen exit too — after
  `q`, the pre-launch shell prompt reappears, and the recording then
  runs `summary` and `report` in that restored shell.
- `live.tape`'s summary step uses `--engine kiro` so it hits an existing
  cached digest instantly; adjust the engine/date to whatever is cached
  and logged in on the recording machine.
