import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSnapshots, runFollow } from "../../src/data/followRunner.js";
import type {
  ActivityEntry,
  SessionNode,
  SessionTree,
} from "../../src/types/index.js";

const sess = (o: Partial<SessionNode> = {}): SessionNode => ({
  id: "s1",
  hideKey: "p/s1",
  filePath: "/p/s1.jsonl",
  projectPath: "/p/proj",
  projectName: "proj",
  lastModifiedMs: 0,
  status: "hot",
  modelName: null,
  subAgents: [],
  nonInteractive: false,
  firstUserPrompt: null,
  liveState: null,
  provider: "claude",
  ...o,
});

describe("buildSnapshots", () => {
  it("flattens top-level sessions and sub-agents, parsing each filePath", () => {
    const tree: SessionTree = {
      projects: [
        {
          name: "proj",
          projectPath: "/p/proj",
          hotness: "hot",
          sessions: [
            sess({
              id: "top",
              subAgents: [sess({ id: "sub", filePath: "/p/sub.jsonl" })],
            }),
          ],
        },
      ],
      coldProjects: [],
      totalCount: 1,
      timestamp: "",
      hiddenStats: { total: 0, active: 0 },
    };
    // inject a fake parser so no filesystem is touched
    const parse = (_fp: string): ActivityEntry[] => [];
    const snaps = buildSnapshots(tree, parse);
    expect(snaps.map((s) => [s.session, s.subagent])).toEqual([
      ["top", null],
      ["top", "sub"],
    ]);
    expect(snaps[0].project).toBe("proj");
    expect(snaps[1].subagent).toBe("sub");
  });
});

describe("runFollow integration", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "follow-"));
    const proj = join(dir, "projects", "-Users-neo-proj");
    mkdirSync(proj, { recursive: true });
    // a Claude session JSONL with one assistant response
    const line = JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4-8",
        content: [{ type: "text", text: "hello world" }],
      },
      timestamp: new Date(2_000_000).toISOString(),
    });
    writeFileSync(join(proj, "sess.jsonl"), `${line}\n`);
    process.env.CLAUDE_PROJECTS_DIR = join(dir, "projects");
  });
  afterEach(() => {
    delete process.env.CLAUDE_PROJECTS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("backfills NDJSON for activity at or after --since", () => {
    const lines: string[] = [];
    const cfg = {
      refreshIntervalMs: 99999,
      hiddenSessions: [],
      hiddenSubAgents: [],
      filterPresets: [[]],
      hiddenProjects: [],
      report: {
        include: [],
        detailLimit: 0,
        withGit: false,
        format: "markdown" as const,
      },
      summary: {},
    };
    const { stop } = runFollow({
      config: cfg,
      sinceMs: 1_000_000,
      json: true,
      include: null,
      now: () => 3_000_000,
      write: (l) => lines.push(l),
    });
    stop();
    const events = lines.map((l) => JSON.parse(l));
    const responses = events.filter(
      (e) => e.type === "activity" && e.label === "Response",
    );
    expect(responses.length).toBeGreaterThanOrEqual(1);
    expect(responses[0]).toMatchObject({ project: "proj", provider: "claude" });
  });

  it("once: emits the seed then does not schedule the streaming interval", () => {
    const lines: string[] = [];
    const cfg = {
      refreshIntervalMs: 99999,
      hiddenSessions: [],
      hiddenSubAgents: [],
      filterPresets: [[]],
      hiddenProjects: [],
      report: {
        include: [],
        detailLimit: 0,
        withGit: false,
        format: "markdown" as const,
      },
      summary: {},
    };
    const spy = vi.spyOn(global, "setInterval");
    const { stop } = runFollow({
      config: cfg,
      sinceMs: 1_000_000,
      json: true,
      include: null,
      now: () => 3_000_000,
      write: (l) => lines.push(l),
      once: true,
    });
    // The seed (backfill) is still emitted...
    expect(
      lines.some(
        (l) => (JSON.parse(l) as { label?: string }).label === "Response",
      ),
    ).toBe(true);
    // ...but no streaming loop is scheduled.
    expect(spy).not.toHaveBeenCalled();
    stop(); // no-op, must be safe to call
    spy.mockRestore();
  });
});

describe("buildSnapshots — sub-agent projectPath", () => {
  it("a sub-agent snapshot inherits the top-level session's projectPath", () => {
    const tree: SessionTree = {
      projects: [
        {
          name: "proj",
          projectPath: "/p/proj",
          hotness: "hot",
          sessions: [
            sess({
              id: "top",
              projectPath: "/p/proj",
              subAgents: [
                sess({ id: "sub", projectPath: "", filePath: "/p/sub.jsonl" }),
              ],
            }),
          ],
        },
      ],
      coldProjects: [],
      totalCount: 1,
      timestamp: "",
      hiddenStats: { total: 0, active: 0 },
    };
    const snaps = buildSnapshots(tree, () => []);
    const sub = snaps.find((s) => s.subagent === "sub");
    expect(sub?.projectPath).toBe("/p/proj"); // not the sub-agent's empty path
  });
});
