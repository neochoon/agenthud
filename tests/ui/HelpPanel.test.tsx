import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { HelpPanel } from "../../src/ui/HelpPanel.js";

describe("HelpPanel", () => {
  it("renders all section titles", () => {
    const { lastFrame } = render(<HelpPanel width={80} height={50} />);
    const out = lastFrame() ?? "";
    expect(out).toContain("Session tree");
    expect(out).toContain("Activity viewer");
    expect(out).toContain("Detail view");
    expect(out).toContain("CLI commands");
    expect(out).toContain("Files");
  });

  it("shows the help toggle shortcut", () => {
    const { lastFrame } = render(<HelpPanel width={80} height={50} />);
    expect(lastFrame() ?? "").toContain("Toggle this help");
  });

  it("renders plain (no box border characters)", () => {
    const { lastFrame } = render(<HelpPanel width={80} height={50} />);
    const out = lastFrame() ?? "";
    // Box chars from BOX constant: ╭╮╰╯─│
    expect(out).not.toContain("│");
    expect(out).not.toContain("╭");
  });

  it("includes hidden shortcuts (Ctrl+U/D for half page)", () => {
    const { lastFrame } = render(<HelpPanel width={80} height={50} />);
    const out = lastFrame() ?? "";
    expect(out).toContain("Ctrl+U / Ctrl+D");
  });

  it("documents config file locations", () => {
    const { lastFrame } = render(<HelpPanel width={80} height={50} />);
    const out = lastFrame() ?? "";
    expect(out).toContain("~/.agenthud/config.yaml");
    expect(out).toContain("~/.agenthud/state.yaml");
  });
});
