import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearSessionHistoryCache,
  parseSessionHistory,
} from "../../src/data/sessionHistory.js";

// Real-filesystem integration (no node:fs mock): the live viewer must
// NOT load the whole of a giant session — only a recent window — or it
// bloats to hundreds of MB and freezes the TUI (a 104MB session spiked
// ~700MB). Older history is served by report/summary instead.
describe("parseSessionHistory viewer window", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agenthud-hist-"));
  });
  afterEach(() => {
    clearSessionHistoryCache();
    rmSync(dir, { recursive: true, force: true });
  });

  // ~1 KB per line so byte-size and line-count track each other.
  const line = (i: number) =>
    JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: `entry ${i} ${"x".repeat(900)}` }],
      },
      timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(),
    });

  const write = (name: string, count: number): string => {
    const path = join(dir, name);
    writeFileSync(
      path,
      Array.from({ length: count }, (_, i) => line(i)).join("\n"),
    );
    return path;
  };

  it("caps a huge session to a recent window (does not load the whole file)", () => {
    const total = 12_000; // ~12 MB, well over the viewer window
    const acts = parseSessionHistory(write("big.jsonl", total));

    // Only the recent window is loaded — far fewer than the full file.
    expect(acts.length).toBeGreaterThan(0);
    expect(acts.length).toBeLessThan(total);
    // ...and it is the MOST RECENT slice: newest present, oldest dropped.
    expect(acts[acts.length - 1].detail).toContain("entry 11999");
    expect(acts[0].detail).not.toContain("entry 0 ");
  });

  it("loads a small session in full", () => {
    const acts = parseSessionHistory(write("small.jsonl", 50));
    expect(acts.length).toBe(50);
    expect(acts[0].detail).toContain("entry 0 ");
    expect(acts[49].detail).toContain("entry 49 ");
  });
});
