/**
 * Windows-only end-to-end regression guard for launching a `.cmd` shim.
 *
 * The bug this locks down: on Windows `agenthud summary` printed
 * "Error: codex not found. Install: npm i -g @openai/codex" on every
 * machine, because an npm-installed CLI is a `codex.cmd` shim and
 *
 *   spawn("codex")      → ENOENT (CreateProcess looks for .exe only)
 *   spawn("codex.cmd")  → EINVAL (Node refuses to run a batch file)
 *
 * so the only route is `cmd.exe /d /s /c "<escaped line>"`. This test
 * builds a real shim (the same shape npm generates: `%*` forwarded to
 * Node) and proves that `resolveCommandPath` + `launchSpec` deliver the
 * exact argv and stdin a CLI expects — through cmd.exe, with all its
 * re-parsing.
 *
 * Everything here is measured, not assumed: a cmd.exe round-trip drops
 * one caret level per `%*` expansion, which is why the escape double-
 * escapes `^` and nothing else.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { launchSpec, resolveCommandPath } = await import(
  "../../src/data/summaryEngines.js"
);

const IS_WINDOWS = process.platform === "win32";

// Child process: reports back exactly what it received.
const ARGDUMP = `
let stdin = "";
process.stdin.setEncoding("utf-8");
process.stdin.on("data", (c) => { stdin += c; });
process.stdin.on("end", () => {
  console.log(JSON.stringify({ argv: process.argv.slice(2), stdin }));
});
process.stdin.resume();
`;

// npm-style shim: forwards its whole command line to the Node script.
const SHIM = '@ECHO off\r\nnode "%~dp0argdump.js" %*\r\n';

interface Received {
  argv: string[];
  stdin: string;
}

// Arguments a summary run can realistically carry: flag names, a model
// id, an absolute output path in a profile with a space, and the usual
// punctuation a path may contain.
const TRICKY_ARGS = [
  "exec",
  "--skip-git-repo-check",
  "-o",
  "C:\\Users\\liu zhuo\\AppData\\Roaming\\agenthud\\summaries\\out.md",
  "-m",
  "gpt-5.4",
  "a&b|c",
  "e%f",
  "m^n",
  'quoted"arg',
  "中文",
];

describe.skipIf(!IS_WINDOWS)("Windows .cmd shim launching", () => {
  let dir: string;
  let shimPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agenthud-shim-"));
    writeFileSync(join(dir, "argdump.js"), ARGDUMP, "utf-8");
    shimPath = join(dir, "probe.cmd");
    writeFileSync(shimPath, SHIM, "utf-8");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Run the shim through the production launch path and collect the
   * child's report. `stdin` is written as one chunk and closed. */
  function runThroughSpec(args: string[], stdin = ""): Promise<Received> {
    const spec = launchSpec(shimPath, args);
    return new Promise((resolve, reject) => {
      const proc = spawn(spec.command, spec.args, {
        stdio: ["pipe", "pipe", "pipe"],
        ...(spec.windowsVerbatimArguments
          ? { windowsVerbatimArguments: true }
          : {}),
      });
      let out = "";
      let err = "";
      proc.stdout.on("data", (d) => {
        out += d.toString();
      });
      proc.stderr.on("data", (d) => {
        err += d.toString();
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        const line = out.trim().split(/\r?\n/).pop() ?? "";
        try {
          resolve(JSON.parse(line) as Received);
        } catch {
          reject(
            new Error(
              `shim produced no JSON (exit ${code}): ${JSON.stringify(out)} ${JSON.stringify(err)}`,
            ),
          );
        }
      });
      proc.stdin.end(stdin);
    });
  }

  it("delivers every argument intact through cmd.exe", async () => {
    const received = await runThroughSpec(TRICKY_ARGS);
    expect(received.argv).toEqual(TRICKY_ARGS);
  });

  it("delivers a multi-line prompt on stdin (why argv stays single-line)", async () => {
    const prompt = [
      "The following is an activity log from a single day of sessions.",
      "",
      "Each entry: `[HH:MM] <icon> <label>: <detail>`. Icons:",
      "  ○ Read    ~ Edit/Write    $ Bash",
      '  100% coverage & "quotes" — plus a tab\there',
      "",
      "Write a concise retro. Do NOT invent follow-ups.",
    ].join("\n");

    const received = await runThroughSpec(["-p"], `${prompt}\n\n## report\n`);
    expect(received.argv).toEqual(["-p"]);
    expect(received.stdin).toContain("The following is an activity log");
    expect(received.stdin).toContain("○ Read");
    expect(received.stdin).toContain('100% coverage & "quotes"');
    expect(received.stdin).toContain("## report");
    // Nothing of the prompt leaked into argv.
    expect(received.argv).not.toContain(prompt);
  });

  it("is reachable only via resolveCommandPath + launchSpec", async () => {
    // Make the shim discoverable as a PATH entry, exactly like npm's
    // `%APPDATA%\npm` directory.
    const originalPath = process.env.PATH;
    process.env.PATH = `${dir};${originalPath ?? ""}`;
    try {
      // The bare name is what the engine declares; resolution has to
      // find the `.cmd` shim rather than the extensionless file.
      writeFileSync(join(dir, "probe-bare"), "not executable\r\n", "utf-8");
      expect(resolveCommandPath("probe")).toBe(shimPath);
      expect(resolveCommandPath("probe-bare")).toBeNull();

      const received = await runThroughSpec(["--version"]);
      expect(received.argv).toEqual(["--version"]);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
