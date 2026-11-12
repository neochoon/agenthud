import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
}));

const { existsSync } = await import("node:fs");
const {
  claudeEngine,
  codexEngine,
  kiroEngine,
  resolveSummaryEngine,
  ENGINES,
  engineMarker,
  parseEngineMarker,
  cacheMatchesEngine,
  escapeWindowsArg,
  launchSpec,
  resolveCommandPath,
} = await import("../../src/data/summaryEngines.js");

const origPath = process.env.PATH;

afterEach(() => {
  vi.resetAllMocks();
  process.env.PATH = origPath;
});

// Make `isAvailable()` deterministic. Takes engine NAMES and maps to
// the actual CLI binaries (kiro → kiro-cli), stubbing existsSync to
// report only those present under a single fake PATH dir. The expected
// lookup paths are built with the SAME `path.join` + extension logic as
// commandExists, so the comparison holds on Windows (backslash
// separators, `.exe`/`.cmd`/`.bat`) as well as POSIX.
const NAME_TO_CMD: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  kiro: "kiro-cli",
};
const FAKE_BIN = "/fakebin";
const EXTS = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
function onlyAvailable(...names: string[]): void {
  process.env.PATH = FAKE_BIN;
  const present = new Set<string>();
  for (const n of names) {
    const cmd = NAME_TO_CMD[n] ?? n;
    for (const ext of EXTS) present.add(join(FAKE_BIN, cmd + ext));
  }
  vi.mocked(existsSync).mockImplementation((p) => present.has(String(p)));
}

describe("engine arg building", () => {
  it("claude: stream-json with optional model, no positional prompt", () => {
    expect(claudeEngine.buildArgs({ prompt: "P" })).toEqual([
      "-p",
      "--no-session-persistence",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
    expect(claudeEngine.buildArgs({ prompt: "P", model: "sonnet" })).toContain(
      "--model",
    );
    // The prompt rides on stdin: argv must stay single-line so the
    // Windows `.cmd` shim launch can carry it through cmd.exe.
    expect(claudeEngine.buildArgs({ prompt: "P" })).not.toContain("P");
  });

  it("codex: exec with output file and optional model, no positional prompt", () => {
    const args = codexEngine.buildArgs({ prompt: "P", outFile: "/tmp/out" });
    expect(args[0]).toBe("exec");
    expect(args).toContain("--skip-git-repo-check");
    expect(args).toContain("-o");
    expect(args).toContain("/tmp/out");
    // `codex exec` reads its instructions from stdin when no positional
    // is given; a positional would also break the Windows shim launch.
    expect(args).not.toContain("P");
    expect(
      codexEngine.buildArgs({ prompt: "P", model: "gpt-5", outFile: "/x" }),
    ).toContain("-m");
  });

  it("kiro: non-interactive chat, no tools, NO positional (prompt goes via stdin)", () => {
    const args = kiroEngine.buildArgs({ prompt: "P" });
    expect(args[0]).toBe("chat");
    expect(args).toContain("--no-interactive");
    expect(args).toContain("--trust-tools=");
    // Kiro reads stdin only when no positional question is given; if we
    // pass the prompt as a positional it ignores the piped report. So
    // the prompt must NOT appear in argv — it's prepended to stdin.
    expect(args).not.toContain("P");
  });
});

describe("engine inputMode", () => {
  it("all engines take their prompt via stdin", () => {
    expect(claudeEngine.inputMode).toBe("stdin");
    expect(codexEngine.inputMode).toBe("stdin");
    expect(kiroEngine.inputMode).toBe("stdin");
  });
});

describe("engine stderrFilter", () => {
  it("kiro drops its benign empty-`--trust-tools` warning, nothing else", () => {
    const f = kiroEngine.stderrFilter;
    expect(f).toBeInstanceOf(RegExp);
    const esc = "\u001b";
    // The real warning is ANSI-wrapped; the stable token is the phrase.
    const warning = `${esc}[38;5;11mWARNING: ${esc}[0m--trust-tools arg for custom tool ${esc}[0m needs to be prepended with @{MCPSERVERNAME}/\n`;
    expect(warning.replace(f as RegExp, "")).toBe("");
    // A real diagnostic (e.g. an auth error) must pass through untouched.
    const real = "Error: not logged in. Please run /login\n";
    expect(real.replace(f as RegExp, "")).toBe(real);
  });

  it("claude and codex do not filter stderr", () => {
    expect(claudeEngine.stderrFilter).toBeUndefined();
    expect(codexEngine.stderrFilter).toBeUndefined();
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

describe("engine provenance marker", () => {
  it("round-trips engine + model through the marker", () => {
    const marker = engineMarker("codex", "gpt-5");
    expect(marker).toContain("codex");
    expect(marker).toContain("gpt-5");
    const parsed = parseEngineMarker(`${marker}\n\n## Summary body`);
    expect(parsed).toEqual({ engine: "codex", model: "gpt-5" });
  });

  it("records 'default' when no model is given", () => {
    const parsed = parseEngineMarker(engineMarker("claude"));
    expect(parsed).toEqual({ engine: "claude", model: "default" });
  });

  it("returns null when the content has no marker", () => {
    expect(parseEngineMarker("## just a body, no marker")).toBeNull();
  });

  describe("cacheMatchesEngine", () => {
    it("matches when marker engine + model equal the request", () => {
      const c = `${engineMarker("codex", "gpt-5")}\nbody`;
      expect(cacheMatchesEngine(c, "codex", "gpt-5")).toBe(true);
    });

    it("misses on a different engine", () => {
      const c = `${engineMarker("claude", "opus")}\nbody`;
      expect(cacheMatchesEngine(c, "codex", undefined)).toBe(false);
    });

    it("misses on a different model", () => {
      const c = `${engineMarker("claude", "opus")}\nbody`;
      expect(cacheMatchesEngine(c, "claude", "sonnet")).toBe(false);
    });

    it("treats `undefined` request model as 'default'", () => {
      const c = `${engineMarker("claude")}\nbody`;
      expect(cacheMatchesEngine(c, "claude", undefined)).toBe(true);
    });

    it("legacy cache (no marker) counts as a claude summary, model-agnostic", () => {
      const c = "## old summary written before provenance markers";
      expect(cacheMatchesEngine(c, "claude", "anything")).toBe(true);
      expect(cacheMatchesEngine(c, "codex", undefined)).toBe(false);
      expect(cacheMatchesEngine(c, "kiro", undefined)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Windows shim launching
//
// Regression guard for the Windows bug where `agenthud summary` failed
// with a bogus "codex not found" on every machine: npm installs the CLI
// as `codex.cmd`, `spawn("codex")` gives ENOENT, and `spawn("codex.cmd")`
// gives EINVAL. The escape rules below were measured against a real
// `.cmd` shim forwarding `%*` to Node (the extra `%*` pass is why a
// caret needs two escape levels), so these expectations are locked.
// ---------------------------------------------------------------------------
describe("escapeWindowsArg", () => {
  it("quotes and escapes a plain argument", () => {
    expect(escapeWindowsArg("plain")).toBe('^"plain^"');
  });

  it("escapes spaces so a path survives as one argument", () => {
    expect(escapeWindowsArg("C:\\Users\\liu zhuo\\out.md")).toBe(
      '^"C:\\Users\\liu^ zhuo\\out.md^"',
    );
  });

  it("escapes cmd metacharacters (% & | < > ( ) , ;)", () => {
    expect(escapeWindowsArg("e%f")).toBe('^"e^%f^"');
    expect(escapeWindowsArg("a&b|c")).toBe('^"a^&b^|c^"');
    expect(escapeWindowsArg("(x)")).toBe('^"^(x^)^"');
  });

  it("doubles a caret: the shim's %* expansion eats one level", () => {
    expect(escapeWindowsArg("m^n")).toBe('^"m^^n^"');
  });

  it("escapes embedded double quotes", () => {
    expect(escapeWindowsArg('i"j')).toBe('^"i\\^"j^"');
  });

  it("leaves non-ASCII intact", () => {
    expect(escapeWindowsArg("中文")).toBe('^"中文^"');
  });
});

describe("launchSpec", () => {
  const asPlatform = (platform: string, fn: () => void) => {
    const original = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", {
      value: platform,
      configurable: true,
    });
    try {
      fn();
    } finally {
      if (original) Object.defineProperty(process, "platform", original);
    }
  };

  it("passes a POSIX executable through untouched", () => {
    asPlatform("linux", () => {
      expect(launchSpec("/usr/local/bin/claude", ["-p", "x"])).toEqual({
        command: "/usr/local/bin/claude",
        args: ["-p", "x"],
      });
    });
  });

  it("leaves a real .exe alone on Windows", () => {
    asPlatform("win32", () => {
      const spec = launchSpec("C:\\bin\\codex.exe", ["exec"]);
      expect(spec.command).toBe("C:\\bin\\codex.exe");
      expect(spec.args).toEqual(["exec"]);
      expect(spec.windowsVerbatimArguments).toBeUndefined();
    });
  });

  it("routes a Windows .cmd shim through cmd.exe with escaped argv", () => {
    asPlatform("win32", () => {
      const spec = launchSpec("C:\\npm\\codex.cmd", ["exec", "-o", "/x y"]);
      expect(spec.command).toBe(process.env.ComSpec || "cmd.exe");
      expect(spec.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
      expect(spec.args).toHaveLength(4);
      // Every argv item is quoted and meta-escaped; nothing is left raw.
      expect(spec.args[3]).toBe(
        '^"C:\\npm\\codex.cmd^" ^"exec^" ^"-o^" ^"/x^ y^"',
      );
      expect(spec.windowsVerbatimArguments).toBe(true);
    });
  });

  it("does not shell-wrap a .bat-style path on POSIX", () => {
    asPlatform("linux", () => {
      const spec = launchSpec("/tmp/shim.cmd", ["a"]);
      expect(spec.command).toBe("/tmp/shim.cmd");
      expect(spec.windowsVerbatimArguments).toBeUndefined();
    });
  });
});

describe("resolveCommandPath", () => {
  it("returns null when nothing on PATH matches", () => {
    process.env.PATH = FAKE_BIN;
    expect(resolveCommandPath("definitely-not-installed")).toBeNull();
  });

  it("finds the executable on PATH", () => {
    onlyAvailable("claude");
    const found = resolveCommandPath("claude");
    expect(found).not.toBeNull();
    expect(String(found)).toContain("claude");
  });

  it("skips an extensionless shim on Windows (not spawnable)", () => {
    const asPlatform = (platform: string, fn: () => void) => {
      const original = Object.getOwnPropertyDescriptor(process, "platform");
      Object.defineProperty(process, "platform", {
        value: platform,
        configurable: true,
      });
      try {
        fn();
      } finally {
        if (original) Object.defineProperty(process, "platform", original);
      }
    };
    asPlatform("win32", () => {
      process.env.PATH = FAKE_BIN;
      // npm writes `codex`, `codex.cmd`, `codex.ps1`; only .cmd/.exe/.bat
      // can be launched, so the bare shim must be ignored.
      vi.mocked(existsSync).mockImplementation(
        (p) => String(p) === join(FAKE_BIN, "tool"),
      );
      expect(resolveCommandPath("tool")).toBeNull();

      vi.mocked(existsSync).mockImplementation(
        (p) => String(p) === join(FAKE_BIN, "tool.cmd"),
      );
      expect(resolveCommandPath("tool")).toBe(join(FAKE_BIN, "tool.cmd"));
    });
  });
});
