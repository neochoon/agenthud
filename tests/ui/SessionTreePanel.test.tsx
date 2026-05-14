import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { SessionNode } from "../../src/types/index.js";
import { SessionTreePanel } from "../../src/ui/SessionTreePanel.js";

const makeSession = (overrides: Partial<SessionNode> = {}): SessionNode => ({
  id: "abc123",
  hideKey: "myproject/abc123",
  filePath: "/home/user/.claude/projects/-proj/abc123.jsonl",
  projectPath: "/Users/neo/myproject",
  projectName: "myproject",
  lastModifiedMs: Date.now() - 5000,
  status: "hot",
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

  it("renders status badge for hot session", () => {
    const { lastFrame } = render(
      <SessionTreePanel
        sessions={[makeSession({ status: "hot" })]}
        selectedId={null}
        hasFocus={false}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("hot");
  });

  it("renders hot sub-agent indented under parent", () => {
    const session = makeSession({
      subAgents: [
        makeSession({
          id: "child1",
          projectName: "",
          status: "hot",
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

  it("collapses cool sub-agents into a summary line", () => {
    const session = makeSession({
      subAgents: [
        makeSession({
          id: "c1",
          projectName: "",
          status: "cool",
          subAgents: [],
        }),
        makeSession({
          id: "c2",
          projectName: "",
          status: "cool",
          subAgents: [],
        }),
        makeSession({
          id: "c3",
          projectName: "",
          status: "cool",
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
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("»");
    expect(frame).toContain("3 cool");
  });

  it("shows running sub-agents individually and summarizes idle ones", () => {
    const session = makeSession({
      subAgents: [
        makeSession({
          id: "r1",
          projectName: "",
          status: "hot",
          subAgents: [],
        }),
        makeSession({
          id: "i1",
          projectName: "",
          status: "cool",
          subAgents: [],
        }),
        makeSession({
          id: "i2",
          projectName: "",
          status: "cool",
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
    const frame = lastFrame() ?? "";
    expect(frame).toContain("»");
    expect(frame).toContain("2 cool");
  });

  it("shows short session ID for parent sessions with a project name", () => {
    const { lastFrame } = render(
      <SessionTreePanel
        sessions={[makeSession({ id: "abc12345", projectName: "myproject" })]}
        selectedId={null}
        hasFocus={false}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("#abc1");
  });

  it("shows project path for parent sessions", () => {
    const { lastFrame } = render(
      <SessionTreePanel
        sessions={[makeSession({ projectPath: "/test/path/myproject" })]}
        selectedId={null}
        hasFocus={false}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("/test/path/myproject");
  });

  it("does not show short ID for sub-agents", () => {
    const session = makeSession({
      subAgents: [
        makeSession({
          id: "child111",
          projectName: "myproject",
          status: "hot",
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
    expect(lastFrame()).not.toContain("#chil");
  });

  it("shows agentId as name for sub-agents", () => {
    const session = makeSession({
      subAgents: [
        makeSession({
          id: "agent-a26daaf",
          projectName: "",
          status: "hot",
          subAgents: [],
          agentId: "a26daaf",
          taskDescription: "Task 3: Create .env.example",
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
    const frame = lastFrame() ?? "";
    expect(frame).toContain("a26daaf");
    expect(frame).toContain("Task 3: Create .env.example");
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

  it("shows cool sub-agents individually when parent is in expandedIds", () => {
    const session = makeSession({
      subAgents: [
        makeSession({
          id: "i1",
          projectName: "",
          status: "cool",
          subAgents: [],
        }),
        makeSession({
          id: "i2",
          projectName: "",
          status: "cool",
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
        expandedIds={new Set(["abc123"])}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("»");
    expect(frame).not.toContain("... 2 cool");
  });

  it("shows hot and warm sub-agents individually", () => {
    const session = makeSession({
      subAgents: [
        makeSession({
          id: "h1",
          projectName: "",
          status: "hot",
          subAgents: [],
        }),
        makeSession({
          id: "w1",
          projectName: "",
          status: "warm",
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

  it("collapses two cool sub-agents into a summary line", () => {
    const session = makeSession({
      subAgents: [
        makeSession({
          id: "c1",
          projectName: "",
          status: "cool",
          subAgents: [],
        }),
        makeSession({
          id: "c2",
          projectName: "",
          status: "cool",
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
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("»");
    expect(frame).toContain("2 cool");
  });

  it("shows combined cool and cold sub-agent summary", () => {
    const session = makeSession({
      subAgents: [
        makeSession({
          id: "c1",
          projectName: "",
          status: "cool",
          subAgents: [],
        }),
        makeSession({
          id: "d1",
          projectName: "",
          status: "cold",
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
    const frame = lastFrame() ?? "";
    expect(frame).toContain("1 cool");
    expect(frame).toContain("1 cold");
  });

  it("shows hot sub-agent individually and summarizes cool/cold", () => {
    const session = makeSession({
      subAgents: [
        makeSession({
          id: "h1",
          projectName: "",
          status: "hot",
          subAgents: [],
        }),
        makeSession({
          id: "c1",
          projectName: "",
          status: "cool",
          subAgents: [],
        }),
        makeSession({
          id: "d1",
          projectName: "",
          status: "cold",
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
    const frame = lastFrame() ?? "";
    expect(frame).toContain("»");
    expect(frame).toContain("1 cool");
    expect(frame).toContain("1 cold");
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

  it("renders cold-sessions-summary row when cold sessions exist", () => {
    const coldSession = makeSession({
      id: "cold1",
      projectName: "oldproj",
      status: "cold",
      subAgents: [],
    });
    const { lastFrame } = render(
      <SessionTreePanel
        sessions={[coldSession]}
        selectedId={null}
        hasFocus={false}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("1 cold");
    expect(lastFrame()).not.toContain("oldproj");
  });

  it("shows cold sessions when __cold__ is in expandedIds", () => {
    const coldSession = makeSession({
      id: "cold1",
      projectName: "oldproj",
      status: "cold",
      subAgents: [],
    });
    const { lastFrame } = render(
      <SessionTreePanel
        sessions={[coldSession]}
        selectedId={null}
        hasFocus={false}
        width={80}
        expandedIds={new Set(["__cold__"])}
      />,
    );
    expect(lastFrame()).toContain("oldproj");
  });

  it("highlights cold-sessions-summary row when selectedId is __cold__", () => {
    const coldSession = makeSession({
      id: "cold1",
      status: "cold",
      subAgents: [],
    });
    const { lastFrame } = render(
      <SessionTreePanel
        sessions={[coldSession]}
        selectedId="__cold__"
        hasFocus={true}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("+");
  });
});
