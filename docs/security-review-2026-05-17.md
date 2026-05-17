# AgentHUD Security Review — 2026-05-17

**Version reviewed:** v0.9.0 (commit `0b1d173`)
**Scope:** Source code review for high-confidence, exploitable security vulnerabilities. Read-only analysis, no command execution.

## Result

**No high-confidence (≥8/10) security vulnerabilities identified.**

Two issues were flagged during initial review but failed false-positive filtering. They are documented below as informational hardening candidates.

---

## Hardening candidate 1 — Command injection via filesystem directory name

**Files:** `src/data/gitCommits.ts:16, 36`

`execSync` is called with a template string containing `projectPath`. `decodeProjectPath` (`src/data/sessions.ts:27`) does not sanitize shell metacharacters in directory names, so a directory like `-tmp-$(cmd)` would produce `projectPath = /tmp/$(cmd)`, executed by `/bin/sh -c` when AgentHUD runs `git log` / `git show`.

**Confidence: 5/10 (dropped)** — Requires same-user write access to `~/.claude/projects/`, where the attacker already has shell. Cross-trust-boundary scenario (mounted backup via `CLAUDE_PROJECTS_DIR`) is theoretical for the primary use case.

**Recommended hardening regardless:** Switch both `execSync` calls to `spawnSync("git", [...args])` array form. Cheap, eliminates the entire class.

```typescript
// Before
execSync(`git --git-dir="${projectPath}/.git" show --stat --no-color ${hash}`, {...})

// After
spawnSync("git", ["--git-dir", `${projectPath}/.git`, "show", "--stat", "--no-color", hash], {...})
```

---

## Hardening candidate 2 — Incomplete ANSI escape stripping in detail rendering

**File:** `src/data/activityParser.ts:7`

Custom `stripAnsi` regex matches only SGR (CSI ending in `m`). Not applied to `response`/`thinking`/`user` detail at all. Escape sequences like `ESC[?1049h` (alternate screen buffer), `ESC]0;...` (window title), `ESC[6n` (cursor position query) could pass through to terminal.

**Confidence: 7/10 (dropped)** — Below 8 threshold. Exploit requires content with raw escape bytes in JSONL written by Claude Code — possible via prompt injection but limited blast radius (visual disruption, not RCE).

**Recommended hardening:** Replace custom regex with the `strip-ansi` npm package (already transitively present via `wrap-ansi`), apply to all `activity.detail` values at storage time.

---

## Non-findings (confirmed safe)

- `yaml` package's `parse()` returns plain objects (no class instantiation / code execution)
- `JSON.parse` usage with typed field extraction — no eval, no prototype pollution
- `spawn("claude", ["-p", prompt])` uses array args — no shell
- `git` `hash` interpolation — hash comes from `git log --format="%h"`, constrained to hex chars
- React/Ink rendering — no `dangerouslySetInnerHTML` usage
- `CLAUDE_PROJECTS_DIR` env var treated as trusted base path, never interpolated into shell strings
- Filepath construction uses `path.join` with sanitized components

---

## Separate concern: `npm audit` (5 vulns)

Outdated dependency CVEs are out of scope for code review per skill instructions, but actionable:

| Package | Severity | Type |
|---------|----------|------|
| `vite` 7.x | high | dev only (tsup/vitest) |
| `rollup` 4.x | high | dev only |
| `postcss` <8.5.10 | moderate | dev only |
| `yaml` 2.x | moderate | **runtime** (config parsing) |

All resolvable with `npm audit fix`. Only `yaml` has runtime impact (stack overflow on deeply nested input — threat model is low since config files are user-owned).

---

## Methodology

- Tool: superpowers `security-review` skill
- Sub-task 1: identify vulnerabilities (read-only static analysis of source tree)
- Sub-task 2: parallel false-positive filtering with concrete attack-path validation
- Threshold: confidence ≥ 8/10 kept as findings; below filtered out
