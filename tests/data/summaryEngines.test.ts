import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
}));

const { existsSync } = await import("node:fs");
const { claudeEngine, codexEngine, kiroEngine, resolveSummaryEngine, ENGINES } =
  await import("../../src/data/summaryEngines.js");

const origPath = process.env.PATH;

afterEach(() => {
  vi.resetAllMocks();
  process.env.PATH = origPath;
});

// Make `isAvailable()` deterministic. Takes engine NAMES and maps to
// the actual CLI binaries (kiro → kiro-cli), stubbing existsSync to
// report only those present under a single fake PATH dir.
const NAME_TO_CMD: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  kiro: "kiro-cli",
};
function onlyAvailable(...names: string[]): void {
  process.env.PATH = "/fakebin";
  const cmds = names.map((n) => NAME_TO_CMD[n] ?? n);
  vi.mocked(existsSync).mockImplementation((p) => {
    const path = String(p);
    return cmds.some(
      (c) => path === `/fakebin/${c}` || path === `/fakebin/${c}.exe`,
    );
  });
}

describe("engine arg building", () => {
  it("claude: stream-json with optional model", () => {
    expect(claudeEngine.buildArgs({ prompt: "P" })).toEqual([
      "-p",
      "--no-session-persistence",
      "--output-format",
      "stream-json",
      "--verbose",
      "P",
    ]);
    expect(claudeEngine.buildArgs({ prompt: "P", model: "sonnet" })).toContain(
      "--model",
    );
  });

  it("codex: exec with output file and optional model", () => {
    const args = codexEngine.buildArgs({ prompt: "P", outFile: "/tmp/out" });
    expect(args[0]).toBe("exec");
    expect(args).toContain("--skip-git-repo-check");
    expect(args).toContain("-o");
    expect(args).toContain("/tmp/out");
    expect(args[args.length - 1]).toBe("P");
    expect(
      codexEngine.buildArgs({ prompt: "P", model: "gpt-5", outFile: "/x" }),
    ).toContain("-m");
  });

  it("kiro: non-interactive chat, no tools, prompt as input arg", () => {
    const args = kiroEngine.buildArgs({ prompt: "P" });
    expect(args[0]).toBe("chat");
    expect(args).toContain("--no-interactive");
    expect(args).toContain("--trust-tools=");
    expect(args[args.length - 1]).toBe("P");
  });
});

describe("resolveSummaryEngine", () => {
  it("explicit config name wins and must be available", () => {
    onlyAvailable("codex");
    expect(resolveSummaryEngine({ engine: "codex" }).name).toBe("codex");
  });

  it("flag overrides config", () => {
    onlyAvailable("claude", "kiro");
    expect(resolveSummaryEngine({ engine: "claude", flag: "kiro" }).name).toBe(
      "kiro",
    );
  });

  it("auto picks the first available in claude → codex → kiro order", () => {
    onlyAvailable("codex", "kiro");
    expect(resolveSummaryEngine({ engine: "auto" }).name).toBe("codex");
    onlyAvailable("kiro");
    expect(resolveSummaryEngine({ engine: "auto" }).name).toBe("kiro");
    onlyAvailable("claude", "codex", "kiro");
    expect(resolveSummaryEngine({ engine: "auto" }).name).toBe("claude");
  });

  it("auto with nothing installed throws a helpful error", () => {
    onlyAvailable();
    expect(() => resolveSummaryEngine({ engine: "auto" })).toThrow(
      /no .*agent CLI/i,
    );
  });

  it("explicit but unavailable engine throws naming the missing CLI", () => {
    onlyAvailable("claude");
    expect(() => resolveSummaryEngine({ engine: "codex" })).toThrow(/codex/i);
  });

  it("ENGINES lists all three in preference order", () => {
    expect(ENGINES.map((e) => e.name)).toEqual(["claude", "codex", "kiro"]);
  });
});

describe("engine output parsing", () => {
  it("claude parser extracts assistant text and usage from stream-json", () => {
    const parser = claudeEngine.makeParser();
    const out: string[] = [];
    parser.feed(
      `${JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello " }] },
      })}\n`,
      (t) => out.push(t),
    );
    parser.feed(
      `${JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "world" }] },
      })}\n`,
      (t) => out.push(t),
    );
    parser.feed(
      `${JSON.stringify({
        type: "result",
        usage: { input_tokens: 100, output_tokens: 20 },
        total_cost_usd: 0.01,
      })}\n`,
      (t) => out.push(t),
    );
    expect(out.join("")).toBe("Hello world");
    const usage = parser.usage();
    expect(usage?.inputTokens).toBe(100);
    expect(usage?.outputTokens).toBe(20);
    expect(usage?.costUsd).toBe(0.01);
  });

  it("kiro parser passes text through and strips ANSI", () => {
    const parser = kiroEngine.makeParser();
    const out: string[] = [];
    const esc = "\u001b";
    parser.feed(`${esc}[32mgreen${esc}[0m text`, (t) => out.push(t));
    expect(out.join("")).toBe("green text");
    expect(parser.usage()).toBeNull();
  });
});
