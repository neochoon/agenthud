import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { SessionTreePanel } from "../../src/ui/SessionTreePanel.js";
import type { SessionNode } from "../../src/types/index.js";

const makeSession = (overrides: Partial<SessionNode> = {}): SessionNode => ({
  id: "abc123",
  filePath: "/home/user/.claude/projects/-proj/abc123.jsonl",
  projectPath: "/Users/neo/myproject",
  projectName: "myproject",
  lastModifiedMs: Date.now() - 5000,
  status: "running",
  modelName: "sonnet-4.6",
  subAgents: [],
  ...overrides,
});

describe("SessionTreePanel", () => {
  it("renders session project name", () => {
    const { lastFrame } = render(
      <SessionTreePanel
        sessions={[makeSession()]}
        selectedId="abc123"
        hasFocus={true}
        onSelect={() => {}}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("myproject");
  });

  it("renders status badge for running session", () => {
    const { lastFrame } = render(
      <SessionTreePanel
        sessions={[makeSession({ status: "running" })]}
        selectedId={null}
        hasFocus={false}
        onSelect={() => {}}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("running");
  });

  it("renders sub-agent indented under parent", () => {
    const session = makeSession({
      subAgents: [
        makeSession({
          id: "child1",
          projectName: "",
          status: "done",
          subAgents: [],
        }),
      ],
    });
    const { lastFrame } = render(
      <SessionTreePanel
        sessions={[session]}
        selectedId={null}
        hasFocus={false}
        onSelect={() => {}}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("»");
  });

  it("renders model name when present", () => {
    const { lastFrame } = render(
      <SessionTreePanel
        sessions={[makeSession({ modelName: "sonnet-4.6" })]}
        selectedId={null}
        hasFocus={false}
        onSelect={() => {}}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("sonnet-4.6");
  });

  it("renders empty message when no sessions", () => {
    const { lastFrame } = render(
      <SessionTreePanel
        sessions={[]}
        selectedId={null}
        hasFocus={false}
        onSelect={() => {}}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("No Claude sessions");
  });
});
