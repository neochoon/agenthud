import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { ProjectNode, SessionNode } from "../../src/types/index.js";
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
  nonInteractive: false,
  firstUserPrompt: null,
  ...overrides,
});

const makeProject = (
  name: string,
  sessions: SessionNode[],
  overrides: Partial<ProjectNode> = {},
): ProjectNode => ({
  name,
  projectPath: `/Users/neo/${name}`,
  sessions,
  hotness: sessions[0]?.status ?? "cold",
  ...overrides,
});

describe("SessionTreePanel", () => {
  it("renders session project name", () => {
    const session = makeSession();
    const project = makeProject("myproject", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
        selectedId="abc123"
        hasFocus={true}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("myproject");
  });

  it("renders status badge for hot session", () => {
    const session = makeSession({ status: "hot" });
    const project = makeProject("myproject", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
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
    const project = makeProject("myproject", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
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
    const project = makeProject("myproject", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
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
    const project = makeProject("myproject", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
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
    const session = makeSession({ id: "abc12345", projectName: "myproject" });
    const project = makeProject("myproject", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
        selectedId={null}
        hasFocus={false}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("#abc1");
  });

  it("shows project path on the project header row (not the session row)", () => {
    const session = makeSession({ projectPath: "/test/path/myproject" });
    const project = makeProject("myproject", [session], {
      projectPath: "/test/path/myproject",
    });
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
        selectedId={null}
        hasFocus={false}
        width={120}
      />,
    );
    const out = lastFrame() ?? "";
    // Path appears on the project header
    expect(out).toContain("> myproject");
    expect(out).toContain("/test/path/myproject");
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
    const project = makeProject("myproject", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
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
    const project = makeProject("myproject", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
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
    const session = makeSession({ modelName: "sonnet-4.6" });
    const project = makeProject("myproject", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
        selectedId={null}
        hasFocus={false}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("sonnet-4.6");
  });

  it("truncates sessions and shows overflow indicator when maxRows is set", () => {
    const projects = Array.from({ length: 5 }, (_, i) => {
      const session = makeSession({
        id: `sess${i}`,
        projectName: `proj${i}`,
        subAgents: [],
      });
      return makeProject(`proj${i}`, [session]);
    });
    const { lastFrame } = render(
      <SessionTreePanel
        projects={projects}
        coldProjects={[]}
        selectedId={null}
        hasFocus={false}
        width={80}
        maxRows={3}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("proj0");
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
    const project = makeProject("myproject", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
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
    const project = makeProject("myproject", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
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
    const project = makeProject("myproject", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
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
    const project = makeProject("myproject", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
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
    const project = makeProject("myproject", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
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
        projects={[]}
        coldProjects={[]}
        selectedId={null}
        hasFocus={false}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("No Claude sessions");
  });

  it("shows project path on project header row", async () => {
    const { homedir } = await import("node:os");
    const home = homedir();
    const projectPath = `${home}/myproject`;
    const session = makeSession({ projectPath });
    const project = makeProject("myproject", [session], { projectPath });
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
        selectedId={null}
        hasFocus={false}
        width={120}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("> myproject");
    expect(out).toContain("~/myproject"); // formatProjectPath replaces home with ~
  });

  it("shows first user prompt as session row middle text", () => {
    const session = makeSession({
      id: "abc1234",
      firstUserPrompt: "Implement the login flow",
    });
    const project = makeProject("myproject", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
        selectedId={null}
        hasFocus={false}
        width={120}
      />,
    );
    expect(lastFrame() ?? "").toContain("Implement the login flow");
  });

  it("does not show project name on session row (it is on the project header)", () => {
    const session = makeSession({ id: "abc1234", projectName: "uniqueproj" });
    const project = makeProject("uniqueproj", [session], {
      projectPath: "/no-home-match/uniqueproj",
    });
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
        selectedId={null}
        hasFocus={false}
        width={120}
      />,
    );
    const out = lastFrame() ?? "";
    const lines = out.split("\n");
    // The project header line should contain "> uniqueproj"
    const headerLine = lines.find((l) => l.includes("> uniqueproj")) ?? "";
    expect(headerLine).toBeTruthy();
    // The session row should contain #abc1 but NOT "uniqueproj"
    const sessionLine = lines.find((l) => l.includes("#abc1")) ?? "";
    expect(sessionLine).toBeTruthy();
    expect(sessionLine).not.toContain("uniqueproj");
  });

  it("renders cold-projects-summary row when cold projects exist", () => {
    const coldSession = makeSession({
      id: "cold1",
      projectName: "oldproj",
      status: "cold",
      subAgents: [],
    });
    const coldProject = makeProject("oldproj", [coldSession], {
      hotness: "cold",
    });
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[]}
        coldProjects={[coldProject]}
        selectedId={null}
        hasFocus={false}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("1 cold");
    expect(lastFrame()).not.toContain("oldproj");
  });

  it("shows cold projects when __cold__ is in expandedIds", () => {
    const coldSession = makeSession({
      id: "cold1",
      projectName: "oldproj",
      status: "cold",
      subAgents: [],
    });
    const coldProject = makeProject("oldproj", [coldSession], {
      hotness: "cold",
    });
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[]}
        coldProjects={[coldProject]}
        selectedId={null}
        hasFocus={false}
        width={80}
        expandedIds={new Set(["__cold__"])}
      />,
    );
    expect(lastFrame()).toContain("oldproj");
  });

  it("highlights cold-projects-summary row when selectedId is __cold__", () => {
    const coldSession = makeSession({
      id: "cold1",
      status: "cold",
      subAgents: [],
    });
    const coldProject = makeProject("myproject", [coldSession], {
      hotness: "cold",
    });
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[]}
        coldProjects={[coldProject]}
        selectedId="__cold__"
        hasFocus={true}
        width={80}
      />,
    );
    expect(lastFrame()).toContain("+");
  });

  // New tests for project-grouped tree

  it("renders project header with sessions nested below", () => {
    const session = makeSession({ id: "abc123", projectName: "myproject" });
    const project: ProjectNode = {
      name: "myproject",
      projectPath: "/Users/neo/myproject",
      sessions: [session],
      hotness: "hot",
    };
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
        selectedId={null}
        hasFocus={false}
        width={80}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("> myproject");
    // Session row uses short ID (#abc1 = first 4 chars of "abc123")
    expect(out).toContain("#abc1");
  });

  it("dims and parenthesizes non-interactive sessions", () => {
    const session = makeSession({ id: "ndi", nonInteractive: true });
    const project: ProjectNode = {
      name: "myproject",
      projectPath: "/Users/neo/myproject",
      sessions: [session],
      hotness: "hot",
    };
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
        selectedId={null}
        hasFocus={false}
        width={80}
      />,
    );
    expect(lastFrame() ?? "").toContain("(#ndi");
  });

  it("collapses cold projects under a summary row", () => {
    const project: ProjectNode = {
      name: "stale",
      projectPath: "/Users/neo/stale",
      sessions: [makeSession({ status: "cold" })],
      hotness: "cold",
    };
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[]}
        coldProjects={[project]}
        selectedId={null}
        hasFocus={false}
        width={80}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("cold");
    expect(out).not.toContain("> stale");
  });

  it("shows cold projects collapsed by default when __cold__ is expanded", () => {
    const session = makeSession({ status: "cold" });
    const project = makeProject("stale", [session], { hotness: "cold" });
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[]}
        coldProjects={[project]}
        selectedId={null}
        hasFocus={false}
        width={80}
        expandedIds={new Set(["__cold__"])}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("> stale"); // project header visible
    expect(out).not.toContain(session.id.slice(0, 4)); // no session row
  });

  it("expands cold project sessions when its __expanded- key is set", () => {
    const session = makeSession({ status: "cold", id: "coldsess" });
    const project = makeProject("stale", [session], { hotness: "cold" });
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[]}
        coldProjects={[project]}
        selectedId={null}
        hasFocus={false}
        width={80}
        expandedIds={new Set(["__cold__", "__expanded-__proj-stale__"])}
      />,
    );
    const out = lastFrame() ?? "";
    expect(out).toContain("> stale");
    expect(out).toContain("#cold"); // session visible
  });

  it("hides sub-agents of an alive session when __collapsed-session-{id} is set", () => {
    const subagent = makeSession({
      id: "child",
      status: "hot",
      projectName: "",
    });
    const session = makeSession({
      id: "sess1",
      status: "hot",
      subAgents: [subagent],
    });
    const project = makeProject("myproject", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
        selectedId={null}
        hasFocus={false}
        width={80}
        expandedIds={new Set(["__collapsed-session-sess1"])}
      />,
    );
    expect(lastFrame() ?? "").not.toContain("»"); // sub-agent marker absent
  });

  it("hides sub-agents of a cold session by default", () => {
    const subagent = makeSession({
      id: "child",
      status: "cold",
      projectName: "",
    });
    const session = makeSession({
      id: "deadSess",
      status: "cold",
      subAgents: [subagent],
    });
    // Cold session must live in a cold project to be cold-tree visible
    const project = makeProject("stale", [session], { hotness: "cold" });
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[]}
        coldProjects={[project]}
        selectedId={null}
        hasFocus={false}
        width={80}
        expandedIds={new Set(["__cold__", "__expanded-__proj-stale__"])}
      />,
    );
    // Cold project expanded, session visible, but its sub-agents hidden
    expect(lastFrame() ?? "").not.toContain("»");
  });

  it("expands sub-agents of a cold session when __expanded-session-{id} is set", () => {
    const subagent = makeSession({
      id: "child",
      status: "cold",
      projectName: "",
    });
    const session = makeSession({
      id: "deadSess",
      status: "cold",
      subAgents: [subagent],
    });
    const project = makeProject("stale", [session], { hotness: "cold" });
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[]}
        coldProjects={[project]}
        selectedId={null}
        hasFocus={false}
        width={80}
        expandedIds={
          new Set([
            "__cold__",
            "__expanded-__proj-stale__",
            "__expanded-session-deadSess",
          ])
        }
      />,
    );
    expect(lastFrame() ?? "").toContain("»");
  });
});
