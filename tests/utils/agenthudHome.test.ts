import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { agenthudHome } from "../../src/utils/agenthudHome.js";

// The global setup sets AGENTHUD_HOME; snapshot it so we can restore
// after exercising both branches.
const fromSetup = process.env.AGENTHUD_HOME;

afterEach(() => {
  if (fromSetup === undefined) delete process.env.AGENTHUD_HOME;
  else process.env.AGENTHUD_HOME = fromSetup;
});

describe("agenthudHome", () => {
  it("returns the AGENTHUD_HOME override when set", () => {
    process.env.AGENTHUD_HOME = "/tmp/agenthud-elsewhere";
    expect(agenthudHome()).toBe("/tmp/agenthud-elsewhere");
  });

  it("defaults to ~/.agenthud when the override is unset", () => {
    delete process.env.AGENTHUD_HOME;
    expect(agenthudHome()).toBe(join(homedir(), ".agenthud"));
  });
});
