/**
 * Workspace scoping — "summarize only THIS project".
 *
 * `report` and `summary` operate on every session of a day. When a user
 * works across many projects that is noise: they want the digest for one
 * workspace. A scope is one absolute project path, resolved from either
 * the current directory (`--cwd`) or an explicit `--project <path|name>`.
 *
 * Design decisions:
 * - Resolution runs against the DISCOVERED projects, not against
 *   `~/.claude/projects/` directory names. That is provider-neutral
 *   (a Kiro or DSH project has no encoded Claude directory) and it can
 *   compare real paths.
 * - `--cwd` picks the DEEPEST project path containing the cwd, so a
 *   nested checkout inside a project being worked on still resolves to
 *   the inner project.
 * - A scoped summary needs its OWN cache file: `2026-11-11.md` is the
 *   whole-day digest, and silently overwriting it with one project's
 *   digest would lose the other. Hence `--<slug>` in the filename, where
 *   the slug is `<project name>-<hash of path>` — readable, and stable
 *   across runs, with the hash keeping two projects named `web` apart.
 * - Comparison is case-insensitive on Windows/macOS (the filesystems
 *   are), case-sensitive elsewhere.
 */

import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { SessionTree } from "../types/index.js";

export interface ProjectRef {
  name: string;
  projectPath: string;
}

/** Every project in a discovered tree, deduped by path and sorted by
 * name — the candidate list a scope resolves against. */
export function projectRefsFromTree(tree: SessionTree): ProjectRef[] {
  const byPath = new Map<string, ProjectRef>();
  for (const project of [...tree.projects, ...tree.coldProjects]) {
    if (!byPath.has(project.projectPath)) {
      byPath.set(project.projectPath, {
        name: project.name,
        projectPath: project.projectPath,
      });
    }
  }
  return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type ScopeRequest =
  | { kind: "cwd"; cwd: string }
  | { kind: "ref"; value: string };

export type ScopeResult =
  | { ok: true; projectPath: string; projectName: string }
  | { ok: false; error: string };

const CASE_INSENSITIVE =
  process.platform === "win32" || process.platform === "darwin";

/** Forward slashes, no trailing separator, case-folded where the
 * filesystem is case-insensitive. */
export function normalizeProjectPath(p: string): string {
  let s = p.replace(/\\/g, "/");
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return CASE_INSENSITIVE ? s.toLowerCase() : s;
}

/** Is `child` inside (or equal to) `parent`? Path-segment aware, so
 * `/work/app` is NOT inside `/work/application`. */
export function isWithin(child: string, parent: string): boolean {
  const c = normalizeProjectPath(child);
  const p = normalizeProjectPath(parent);
  if (c === p) return true;
  return c.startsWith(`${p}/`);
}

/** `<name>-<6 hex of sha1(path)>` — the cache-filename discriminator.
 * Lower-case, ASCII-safe: it lands in a filename the index parses. */
export function scopeSlugFor(projectPath: string): string {
  const name = basename(normalizeProjectPath(projectPath).replace(/\/+$/, ""));
  const safeName =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "project";
  const hash = createHash("sha1")
    .update(normalizeProjectPath(projectPath))
    .digest("hex")
    .slice(0, 6);
  return `${safeName}-${hash}`;
}

/**
 * Cache-filename suffix for a scope SET: `--a-1b2c3d+b-4e5f6a`.
 *
 * Sorted, so `--project a --project b` and `--project b --project a`
 * share one cache file — the digest covers the same projects either
 * way. Empty for an unscoped run (the whole-day digest).
 */
export function scopeSuffixFor(projectPaths?: string[]): string {
  if (!projectPaths || projectPaths.length === 0) return "";
  const slugs = [...new Set(projectPaths.map(scopeSlugFor))].sort();
  return `--${slugs.join("+")}`;
}

function candidates(projects: ProjectRef[]): string {
  const list = projects
    .map((p) => `  ${p.name}  ${p.projectPath}`)
    .sort()
    .join("\n");
  return list || "  (no projects with sessions found)";
}

/**
 * Resolve a scope request to exactly one discovered project.
 *
 * Errors are actionable, not just "not found": they name what WAS found,
 * because the usual cause is a typo or running from a directory that has
 * no sessions yet.
 */
export function resolveScope(
  request: ScopeRequest,
  projects: ProjectRef[],
): ScopeResult {
  return resolveOne(request, projects);
}

/**
 * Resolve several scope requests into one deduped whitelist. Errors from
 * any single entry abort the whole set (a silently-dropped project would
 * make a digest look complete when it isn't).
 */
export function resolveScopes(
  requests: ScopeRequest[],
  projects: ProjectRef[],
):
  | { ok: true; projectPaths: string[]; names: string[] }
  | { ok: false; error: string } {
  const paths: string[] = [];
  const names: string[] = [];
  for (const request of requests) {
    const result = resolveOne(request, projects);
    if (!result.ok) return result;
    if (
      paths.some(
        (p) =>
          normalizeProjectPath(p) === normalizeProjectPath(result.projectPath),
      )
    ) {
      continue;
    }
    paths.push(result.projectPath);
    names.push(result.projectName);
  }
  return { ok: true, projectPaths: paths, names };
}

function resolveOne(
  request: ScopeRequest,
  projects: ProjectRef[],
): ScopeResult {
  if (projects.length === 0) {
    return {
      ok: false,
      error:
        "no projects with sessions were found to scope to (run `agenthud` once to check discovery)",
    };
  }

  if (request.kind === "cwd") {
    // Deepest match wins: the longest containing project path.
    let best: ProjectRef | null = null;
    for (const p of projects) {
      if (!isWithin(request.cwd, p.projectPath)) continue;
      if (
        !best ||
        normalizeProjectPath(p.projectPath).length >
          normalizeProjectPath(best.projectPath).length
      ) {
        best = p;
      }
    }
    if (!best) {
      return {
        ok: false,
        error: `--cwd: no project session lives at or above ${request.cwd}\nknown projects:\n${candidates(projects)}`,
      };
    }
    return { ok: true, projectPath: best.projectPath, projectName: best.name };
  }

  const wanted = request.value;
  if (!wanted.trim()) {
    return {
      ok: false,
      error: "--project needs a value (a path or a project name)",
    };
  }

  const byPath = projects.find(
    (p) => normalizeProjectPath(p.projectPath) === normalizeProjectPath(wanted),
  );
  if (byPath) {
    return {
      ok: true,
      projectPath: byPath.projectPath,
      projectName: byPath.name,
    };
  }

  const byName = projects.filter((p) => p.name === wanted);
  if (byName.length === 1) {
    return {
      ok: true,
      projectPath: byName[0].projectPath,
      projectName: byName[0].name,
    };
  }
  if (byName.length > 1) {
    return {
      ok: false,
      error: `--project "${wanted}" matches ${byName.length} projects — pass a path instead:\n${byName
        .map((p) => `  ${p.projectPath}`)
        .join("\n")}`,
    };
  }

  return {
    ok: false,
    error: `--project: no project named or located at "${wanted}"\nknown projects:\n${candidates(projects)}`,
  };
}
