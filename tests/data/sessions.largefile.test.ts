import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearClaudeFileCaches } from "../../src/data/providers/claude.js";
import { discoverSessions } from "../../src/data/sessions.js";

// Real-fs integration: discovery reads every session on every refresh.
// For a huge session it must read only bounded head/tail slices (not the
// whole file) — slurping 100MB+ files is what bloated RSS and froze the
// TUI. This locks in that the bounded reads still yield correct model /
// liveState / title for an oversized file (> the 1MB prompt-tail cap).
describe("discoverSessions on an oversized session file", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agenthud-big-"));
    process.env.CLAUDE_PROJECTS_DIR = dir;
    clearClaudeFileCaches();
  });
  afterEach(() => {
    delete process.env.CLAUDE_PROJECTS_DIR;
    clearClaudeFileCaches();
    rmSync(dir, { recursive: true, force: true });
  });

  it("derives model + latest user prompt from a >1MB session via bounded reads", () => {
    const now = Date.now();
    const proj = join(dir, "-Users-x-proj");
    mkdirSync(proj, { recursive: true });

    const pad = "y".repeat(1500);
    const lines: string[] = [];
    // Bulk filler to push the file well past the 1MB prompt-tail cap.
    for (let i = 0; i < 1200; i++) {
      lines.push(
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: `filler ${i} ${pad}` }] },
          timestamp: new Date(now - 100_000 + i).toISOString(),
        }),
      );
    }
    // A recent user message (the row title) and a final assistant turn
    // carrying the model — both must be found from the file's tail.
    lines.push(
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "the most recent question" },
        timestamp: new Date(now - 2000).toISOString(),
      }),
    );
    lines.push(
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-opus-4-20250101",
          content: [{ type: "text", text: "answer" }],
          usage: { input_tokens: 5, output_tokens: 5 },
        },
        timestamp: new Date(now - 1000).toISOString(),
      }),
    );
    writeFileSync(join(proj, "big-session.jsonl"), `${lines.join("\n")}\n`);

    const tree = discoverSessions({
      refreshIntervalMs: 2000,
      hiddenSessions: [],
      hiddenSubAgents: [],
      filterPresets: [[]],
      hiddenProjects: [],
    });

    const session = tree.projects.flatMap((p) => p.sessions)[0];
    expect(session).toBeDefined();
    expect(session.modelName).toContain("opus");
    expect(session.firstUserPrompt).toContain("the most recent question");
  });
});
