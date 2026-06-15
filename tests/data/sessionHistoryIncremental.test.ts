import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearSessionHistoryCache,
  parseSessionHistory,
} from "../../src/data/sessionHistory.js";

// Real-filesystem test (no fs mock): exercises the bounded-tail
// incremental parse, which only triggers for files larger than the
// 2 MB TAIL_TARGET. Builds a >2 MB Claude JSONL, grows it in
// chunks parsing each time, and asserts the incrementally-built
// result is byte-identical to a cold full parse.

let dir: string;
let projectsDir: string;
let filePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agenthud-inc-"));
  projectsDir = join(dir, "projects");
  const proj = join(projectsDir, "-Users-neo-proj");
  filePath = join(proj, "sess.jsonl");
  mkdirSync(proj, { recursive: true });
  process.env.CLAUDE_PROJECTS_DIR = projectsDir;
  clearSessionHistoryCache();
});

afterEach(() => {
  delete process.env.CLAUDE_PROJECTS_DIR;
  clearSessionHistoryCache();
  rmSync(dir, { recursive: true, force: true });
});

// One turn = a user prompt, an assistant tool_use, and the matching
// tool_result that enriches the Edit detail. Repeated to exceed 2 MB.
function turn(i: number): string[] {
  const toolId = `t${i}`;
  const padding = "x".repeat(400); // bulk up so we cross 2 MB quickly
  return [
    JSON.stringify({
      type: "user",
      message: { role: "user", content: `prompt ${i} ${padding}` },
      timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(),
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4-8",
        content: [
          {
            type: "tool_use",
            id: toolId,
            name: "Edit",
            input: { file_path: `/src/file${i}.ts` },
          },
        ],
      },
      timestamp: new Date(1_700_000_000_000 + i * 1000 + 1).toISOString(),
    }),
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolId, content: "ok" }],
      },
      toolUseResult: {
        filePath: `/src/file${i}.ts`,
        structuredPatch: [
          { oldStart: 1, oldLines: 2, newStart: 1, newLines: 4 },
        ],
      },
      timestamp: new Date(1_700_000_000_000 + i * 1000 + 2).toISOString(),
    }),
  ];
}

describe("parseSessionHistory incremental (real fs, >2 MB)", () => {
  it("incremental growth matches a cold full parse exactly", () => {
    const lines: string[] = [];
    // ~3.4 MB: big enough to cross TAIL_MAX (2 MB) so a prefix-advance
    // fold happens, but under MAX_VIEWER_BYTES (4 MB) so the viewer reads
    // the whole file and incremental must equal a cold full parse.
    for (let i = 0; i < 3500; i++) lines.push(...turn(i));

    // Grow the file in 6 chunks, parsing after each (drives tail
    // re-parse + at least one prefix-advance fold past TAIL_MAX).
    let incremental: ReturnType<typeof parseSessionHistory> = [];
    for (let k = 1; k <= 6; k++) {
      const upto = Math.floor((lines.length * k) / 6);
      writeFileSync(filePath, `${lines.slice(0, upto).join("\n")}\n`);
      incremental = parseSessionHistory(filePath);
    }

    clearSessionHistoryCache();
    const full = parseSessionHistory(filePath);

    expect(incremental.length).toBe(full.length);
    expect(full.length).toBeGreaterThan(6000); // sanity: it parsed a lot
    for (let i = 0; i < full.length; i++) {
      expect(incremental[i].label).toBe(full[i].label);
      expect(incremental[i].detail).toBe(full[i].detail);
      expect(incremental[i].count ?? 1).toBe(full[i].count ?? 1);
    }
  });
});
