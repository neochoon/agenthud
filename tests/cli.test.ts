import { describe, expect, it } from "vitest";
import { getHelp, parseArgs } from "../src/cli.js";

describe("parseArgs", () => {
  it("defaults to watch mode", () => {
    expect(parseArgs([])).toEqual({ mode: "watch" });
  });

  it("parses --once", () => {
    expect(parseArgs(["--once"])).toEqual({ mode: "once" });
  });

  it("parses --help", () => {
    expect(parseArgs(["--help"])).toEqual({ mode: "watch", command: "help" });
  });

  it("parses -h", () => {
    expect(parseArgs(["-h"])).toEqual({ mode: "watch", command: "help" });
  });

  it("parses --version", () => {
    expect(parseArgs(["--version"])).toEqual({
      mode: "watch",
      command: "version",
    });
  });

  it("parses -V", () => {
    expect(parseArgs(["-V"])).toEqual({ mode: "watch", command: "version" });
  });
});

describe("getHelp", () => {
  it("includes usage line", () => {
    expect(getHelp()).toContain("Usage: agenthud");
  });

  it("mentions config path", () => {
    expect(getHelp()).toContain("~/.agenthud/config.yaml");
  });
});
