# Backlog

**Active backlog lives on the AgentHUD Project board:**
https://github.com/users/neochoon/projects/1

Ideas that don't yet warrant a GitHub Issue live there as **draft issues**
— no branch, PR, or commit needed — and become real Issues when work
starts. This file keeps only the archive of decisions already made, so
they don't get re-litigated.

---

## Closed / decided (for reference)

- **data → ui layer violation: time constants** — done 2026-06-20. Moved
  the time constants from `ui/constants.ts` to `src/utils/timeConstants.ts`
  (#192 / PR #193); the two unused constants were then removed (#194 /
  PR #195).
- **opencode lowercase tool labels** — done 2026-06-20 (#189 / PR #196).
  `canonicalToolLabel` / `iconForCanonicalLabel` are now shared by kiro and
  opencode; opencode emits canonical labels + per-tool icons.
- **`o` key to open file in detail view** — declined 2026-06-09. Detail
  view is "inspection mode" not "actor"; races with concurrent Claude
  edits; default-app association is fragile across platforms (especially
  WSL).
- **Separate test catalog doc** — replaced by the FEATURES.md rewrite
  (PR #120). `vitest list` output is the canonical spec.
- **Architecture audit doc** — discussed but not produced. File headers
  (PRs #121–#125) cover the per-module rationale; if a cross-cutting view
  is needed later, the headers are the starting material.
- **README ↔ FEATURES.md cross-link** — done in PR #131 (v0.13.2). README
  slimmed, links to FEATURES.md as the reference.
- **npm + GitHub search metadata** — done in PR #132 (v0.13.2) plus repo
  description / homepage / topics via `gh repo edit`.
