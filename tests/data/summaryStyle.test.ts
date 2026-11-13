/**
 * Style reference: loading, capping, and the composition invariant.
 *
 * The load-bearing property here is that composing a prompt WITHOUT a
 * style returns it byte-identical. That is what keeps a run with no style
 * file producing the same cache fingerprint as before the feature
 * existed — otherwise every user's cache would silently invalidate on
 * upgrade and re-bill.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promptFingerprint } from "../../src/data/summaryEngines.js";
import {
  composePromptWithStyle,
  MAX_STYLE_CHARS,
  resolveStyleReference,
  STYLE_FILENAME,
  styleFilePath,
} from "../../src/data/summaryStyle.js";

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "agenthud-style-"));
  // The default-file cases below write into the (temp) agenthud home;
  // clear it so each test starts from "no style file".
  rmSync(styleFilePath(), { force: true });
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Write `text` to `name` inside the scratch dir; return its path. */
function write(name: string, text: string): string {
  const p = join(scratch, name);
  writeFileSync(p, text, "utf-8");
  return p;
}

describe("styleFilePath", () => {
  it("points at summary-style.md under the agenthud home", () => {
    // tests/setup.ts redirects AGENTHUD_HOME to a temp dir.
    expect(styleFilePath()).toBe(
      join(process.env.AGENTHUD_HOME!, STYLE_FILENAME),
    );
  });

  it("resolves lazily, so an AGENTHUD_HOME set after import still wins", () => {
    const before = styleFilePath();
    const prev = process.env.AGENTHUD_HOME;
    process.env.AGENTHUD_HOME = scratch;
    try {
      expect(styleFilePath()).toBe(join(scratch, STYLE_FILENAME));
      expect(styleFilePath()).not.toBe(before);
    } finally {
      process.env.AGENTHUD_HOME = prev;
    }
  });
});

describe("resolveStyleReference — default file", () => {
  it("is simply off when no file exists (absence is not an error)", () => {
    const style = resolveStyleReference({});
    expect(style.text).toBeNull();
    expect(style.path).toBe("");
    expect(style.truncated).toBe(false);
    expect(style.error).toBeUndefined();
  });

  it("loads the default file when it exists", () => {
    const body = "省略主语，直接以动词开头。\n";
    writeFileSync(styleFilePath(), body, "utf-8");
    const style = resolveStyleReference({});
    expect(style.text).toBe(body.trim());
    expect(style.path).toBe(styleFilePath());
    expect(style.error).toBeUndefined();
  });

  it("treats a whitespace-only file as off", () => {
    writeFileSync(styleFilePath(), "  \n\t\n", "utf-8");
    const style = resolveStyleReference({});
    expect(style.text).toBeNull();
    expect(style.path).toBe("");
  });

  it("is off when disabled, even though the file exists", () => {
    writeFileSync(styleFilePath(), "whatever", "utf-8");
    expect(resolveStyleReference({ disabled: true }).text).toBeNull();
  });

  it("lets disabled win over an explicit path", () => {
    const p = write("custom.md", "sample");
    const style = resolveStyleReference({ path: p, disabled: true });
    expect(style.text).toBeNull();
  });
});

describe("resolveStyleReference — explicit path", () => {
  it("reads an absolute path", () => {
    const p = write("mine.md", "## 句子\n省略主语。");
    const style = resolveStyleReference({ path: p });
    expect(style.text).toContain("省略主语");
    expect(style.path).toBe(p);
  });

  it("resolves a relative path against cwd", () => {
    write("rel.md", "relative content");
    const cwd = process.cwd();
    process.chdir(scratch);
    try {
      const style = resolveStyleReference({ path: "rel.md" });
      expect(style.error).toBeUndefined();
      expect(style.text).toBe("relative content");
      expect(style.path).toBe(resolve(scratch, "rel.md"));
    } finally {
      process.chdir(cwd);
    }
  });

  it("reports a missing explicit path instead of failing silently", () => {
    const missing = join(scratch, "nope.md");
    const style = resolveStyleReference({ path: missing });
    expect(style.text).toBeNull();
    expect(style.error).toContain("not found");
    expect(style.error).toContain(missing);
  });

  it("expands a leading ~ to the home directory", () => {
    // Never reads the real home: the point is the expansion in the error
    // message for a path that certainly does not exist.
    const style = resolveStyleReference({
      path: "~/agenthud-no-such-style.md",
    });
    expect(style.error).toContain(join(homedir(), "agenthud-no-such-style.md"));
  });
});

describe("size cap", () => {
  it("leaves an under-cap file untouched", () => {
    const body = "短句。\n\n又一段。";
    const p = write("small.md", body);
    const style = resolveStyleReference({ path: p });
    expect(style.truncated).toBe(false);
    expect(style.text).toBe(body);
  });

  it("cuts an oversize file at a paragraph break", () => {
    const para = `${"a".repeat(100)}\n\n`;
    const raw = para.repeat(100); // 10,200 chars
    const p = write("big.md", raw);
    const style = resolveStyleReference({ path: p });
    expect(style.truncated).toBe(true);
    expect(style.text!.length).toBeLessThanOrEqual(MAX_STYLE_CHARS);
    // A prefix of the original, ending on a whole paragraph (the trim
    // drops the trailing blank line, so the last char is content).
    expect(raw.startsWith(style.text!)).toBe(true);
    expect(style.text!.endsWith("a")).toBe(true);
    expect(style.text).not.toContain("\n\n\n");
  });

  it("still caps a file with no paragraph breaks at all", () => {
    const p = write("wall.md", "b".repeat(MAX_STYLE_CHARS + 500));
    const style = resolveStyleReference({ path: p });
    expect(style.truncated).toBe(true);
    expect(style.text!.length).toBe(MAX_STYLE_CHARS);
  });
});

describe("composePromptWithStyle", () => {
  const base = "Summarize the log.\n\nActivity log:";

  it("returns the prompt untouched when there is no style", () => {
    expect(composePromptWithStyle(base, null)).toBe(base);
    expect(composePromptWithStyle(base, "   \n ")).toBe(base);
  });

  it("prepends the style block and keeps the base prompt at the end", () => {
    const composed = composePromptWithStyle(base, "省略主语。");
    expect(composed.endsWith(base)).toBe(true);
    expect(composed).toContain("<sample>\n省略主语。\n</sample>");
    // Style must land BEFORE the payload marker, never after it — the
    // templates end with "Activity log:" and the report is appended next.
    expect(composed.indexOf("省略主语")).toBeLessThan(
      composed.indexOf("Activity log:"),
    );
  });

  it("tells the model to copy the writing, not the content", () => {
    const composed = composePromptWithStyle(base, "x");
    expect(composed).toMatch(/Copy the\s+WRITING ONLY/i);
  });

  it("changes the prompt fingerprint, which is what invalidates the cache", () => {
    const plain = promptFingerprint(composePromptWithStyle(base, null));
    const styled = promptFingerprint(
      composePromptWithStyle(base, "省略主语。"),
    );
    const edited = promptFingerprint(
      composePromptWithStyle(base, "省略主语！"),
    );
    expect(styled).not.toBe(plain);
    // Editing only the style file must regenerate too.
    expect(edited).not.toBe(styled);
  });

  it("does not mutate the caller's prompt string", () => {
    const original = String(base);
    composePromptWithStyle(original, "style");
    expect(original).toBe(base);
  });
});

describe("shipped templates", () => {
  const templateDir = join(process.cwd(), "src", "templates");

  it.each([
    "summary-prompt.md",
    "summary-range-prompt.md",
  ])("%s asks for the project-grouped numbered shape and no subject", (name) => {
    const text = readFileSync(join(templateDir, name), "utf-8");
    expect(text).toContain("### 工作内容");
    expect(text).toContain("1、");
    expect(text).toContain("（1）");
    expect(text).toMatch(/省略主语/);
    // The old five-section shape must be gone from both templates.
    expect(text).not.toContain("## 主要成果");
    expect(text).not.toContain("## 区间概览");
    // And the old explicit first-person instruction must not linger.
    expect(text).not.toMatch(/first-person voice/);
  });
});

describe("scratch isolation", () => {
  it("never reads the developer's real style file", () => {
    // tests/setup.ts points AGENTHUD_HOME at a temp dir; the default
    // resolution must therefore not be the real home.
    expect(styleFilePath()).not.toContain(
      join(homedir(), ".agenthud", STYLE_FILENAME),
    );
  });
});
