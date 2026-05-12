import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { SessionNode } from "../../src/types/index.js";
import { SessionTreePanel } from "../../src/ui/SessionTreePanel.js";

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
        width={80}
      />,
    );
    expect(lastFrame()).toContain("sonnet-4.6");
  });

  it("truncates sessions and shows overflow indicator when maxRows is set", () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      makeSession({ id: `sess${i}`, projectName: `proj${i}`, subAgents: [] }),
    );
    const { lastFrame } = render(
      <SessionTreePanel
        sessions={sessions}
        selectedId={null}
        hasFocus={false}
        width={80}
        maxRows={3}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("proj0");
    expect(frame).toContain("proj1");
    expect(frame).not.toContain("proj2");
    expect(frame).toContain("more");
  });

  it("renders empty message when no sessions", () => {
    const { lastFrame } = render(
      <SessionTreePanel
        sessions={[]}
        selectedId={null}
        hasFocus={false}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("No Claude sessions");
  });
});
