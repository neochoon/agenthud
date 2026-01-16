import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { WelcomePanel } from "../../src/ui/WelcomePanel.js";

describe("WelcomePanel", () => {
  it("shows welcome title", () => {
    const { lastFrame } = render(<WelcomePanel />);

    expect(lastFrame()).toContain("Welcome to agenthud");
  });

  it("shows no .agenthud/ directory message", () => {
    const { lastFrame } = render(<WelcomePanel />);

    expect(lastFrame()).toContain("No .agenthud/ directory found");
  });

  it("shows init command instruction", () => {
    const { lastFrame } = render(<WelcomePanel />);

    expect(lastFrame()).toContain("npx agenthud init");
  });

  it("shows github link", () => {
    const { lastFrame } = render(<WelcomePanel />);

    expect(lastFrame()).toContain("github.com/neochoon/agenthud");
  });

  it("shows quit instruction", () => {
    const { lastFrame } = render(<WelcomePanel />);

    expect(lastFrame()).toContain("Press q to quit");
  });
});
