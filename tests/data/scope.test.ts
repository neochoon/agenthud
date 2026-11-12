import { describe, expect, it } from "vitest";
import {
  isWithin,
  normalizeProjectPath,
  projectRefsFromTree,
  resolveScope,
  scopeSlugFor,
} from "../../src/data/scope.js";
import type { ProjectNode, SessionTree } from "../../src/types/index.js";

const PROJECTS = [
  { name: "app", projectPath: "/work/app" },
  { name: "app-web", projectPath: "/work/app-web" },
  { name: "nested", projectPath: "/work/app/packages/nested" },
  // Same NAME, different paths: `--project web` must refuse to guess.
  { name: "web", projectPath: "/one/web" },
  { name: "web", projectPath: "/two/web" },
];

describe("normalizeProjectPath", () => {
  it("normalizes separators and strips trailing slashes", () => {
    // Windows/macOS also case-fold; compare against the same normalizer
    // so the assertion is platform-neutral.
    expect(normalizeProjectPath("C:\\work\\app\\")).toBe(
      normalizeProjectPath("C:/work/app"),
    );
    expect(normalizeProjectPath("C:\\work\\app")).toBe(
      normalizeProjectPath("C:/work/app"),
    );
    // A root path keeps its single slash.
    expect(normalizeProjectPath("/")).toBe("/");
  });
});

describe("isWithin", () => {
  it("matches the same path", () => {
    expect(isWithin("/work/app", "/work/app")).toBe(true);
  });

  it("matches a child directory", () => {
    expect(isWithin("/work/app/src", "/work/app")).toBe(true);
  });

  it("does not match a sibling that only shares a prefix", () => {
    // The whole point of segment awareness: /work/app-web is NOT inside
    // /work/app, even though the string starts the same way.
    expect(isWithin("/work/app-web", "/work/app")).toBe(false);
  });

  it("does not match a parent", () => {
    expect(isWithin("/work", "/work/app")).toBe(false);
  });
});

describe("scopeSlugFor", () => {
  it("is lowercase, filename-safe and stable", () => {
    const slug = scopeSlugFor("C:\\file\\sometime\\agenthud");
    expect(slug).toMatch(/^[a-z0-9-]+-[0-9a-f]{6}$/);
    expect(slug.startsWith("agenthud-")).toBe(true);
    expect(scopeSlugFor("C:\\file\\sometime\\agenthud")).toBe(slug);
  });

  it("keeps two projects with the same name apart", () => {
    expect(scopeSlugFor("/one/web")).not.toBe(scopeSlugFor("/two/web"));
  });

  it("sanitizes a name with spaces and punctuation", () => {
    const slug = scopeSlugFor("C:\\Users\\liu zhuo\\my app (v2)");
    expect(slug).toMatch(/^[a-z0-9-]+-[0-9a-f]{6}$/);
    expect(slug).not.toContain(" ");
  });
});

describe("resolveScope — cwd", () => {
  it("picks the project containing the cwd", () => {
    const r = resolveScope({ kind: "cwd", cwd: "/work/app/src" }, PROJECTS);
    expect(r).toMatchObject({ ok: true, projectPath: "/work/app" });
  });

  it("picks the deepest project when projects nest", () => {
    const r = resolveScope(
      { kind: "cwd", cwd: "/work/app/packages/nested/x" },
      PROJECTS,
    );
    expect(r).toMatchObject({
      ok: true,
      projectPath: "/work/app/packages/nested",
    });
  });

  it("does not match a sibling with a shared prefix", () => {
    const r = resolveScope({ kind: "cwd", cwd: "/work/app-web/x" }, PROJECTS);
    expect(r).toMatchObject({ ok: true, projectPath: "/work/app-web" });
  });

  it("errors with the known projects when nothing contains the cwd", () => {
    const r = resolveScope({ kind: "cwd", cwd: "/elsewhere" }, PROJECTS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("/elsewhere");
    expect(r.error).toContain("/work/app");
  });

  it("errors when there is nothing to scope to", () => {
    const r = resolveScope({ kind: "cwd", cwd: "/work/app" }, []);
    expect(r.ok).toBe(false);
  });
});

describe("resolveScope — explicit project", () => {
  it("matches an absolute path", () => {
    const r = resolveScope({ kind: "ref", value: "/work/app" }, PROJECTS);
    expect(r).toMatchObject({
      ok: true,
      projectPath: "/work/app",
      projectName: "app",
    });
  });

  it("matches a unique project name", () => {
    const r = resolveScope({ kind: "ref", value: "nested" }, PROJECTS);
    expect(r).toMatchObject({
      ok: true,
      projectPath: "/work/app/packages/nested",
    });
  });

  it("reports an ambiguous name instead of guessing", () => {
    const r = resolveScope({ kind: "ref", value: "web" }, PROJECTS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("matches 2 projects");
    expect(r.error).toContain("/one/web");
    expect(r.error).toContain("/two/web");
  });

  it("errors for an unknown value, listing candidates", () => {
    const r = resolveScope({ kind: "ref", value: "nope" }, PROJECTS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("nope");
    expect(r.error).toContain("app");
  });

  it("rejects an empty value", () => {
    const r = resolveScope({ kind: "ref", value: "   " }, PROJECTS);
    expect(r.ok).toBe(false);
  });
});

describe("projectRefsFromTree", () => {
  it("dedupes by path and includes cold projects", () => {
    const mk = (name: string, path: string): ProjectNode =>
      ({
        name,
        projectPath: path,
        sessions: [],
        hotness: "cold",
      }) as ProjectNode;
    const tree: SessionTree = {
      projects: [mk("app", "/work/app")],
      coldProjects: [mk("app", "/work/app"), mk("old", "/work/old")],
      totalCount: 0,
      timestamp: "",
      hiddenStats: { total: 0, active: 0 },
    };
    expect(projectRefsFromTree(tree)).toEqual([
      { name: "app", projectPath: "/work/app" },
      { name: "old", projectPath: "/work/old" },
    ]);
  });
});
