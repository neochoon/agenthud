import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type {
  ProjectNode,
  SessionNode,
  TreeCensus,
} from "../../src/types/index.js";
import {
  buildTitleSegments,
  getBadge,
  isProjectAlive,
  SessionTreePanel,
} from "../../src/ui/SessionTreePanel.js";

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
  liveState: null,
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

  it("shows a 4-char short session ID for parent sessions with a project name", () => {
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
    const frame = lastFrame() ?? "";
    expect(frame).toContain("#abc1"); // 4 chars
    expect(frame).not.toContain("#abc12"); // not 5
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

  it("shows a 6-char truncated agentId as name for sub-agents", () => {
    const session = makeSession({
      subAgents: [
        makeSession({
          id: "agent-abce044562ca241ed",
          projectName: "",
          status: "hot",
          subAgents: [],
          agentId: "abce044562ca241ed", // 17-char hex, as Claude writes it
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
    expect(frame).toContain("abce04"); // first 6 chars
    expect(frame).not.toContain("abce044562ca241ed"); // not the full id
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

  it("renders ProjectRow with active count in green parens next to each total", () => {
    // 3 sessions total: 2 hot, 1 cool. Hot session has 2 active sub-agents.
    const hot1 = makeSession({
      id: "h1",
      status: "hot",
      subAgents: [
        makeSession({ id: "sa1", status: "hot", subAgents: [] }),
        makeSession({ id: "sa2", status: "warm", subAgents: [] }),
        makeSession({ id: "sa3", status: "cool", subAgents: [] }),
      ],
    });
    const hot2 = makeSession({ id: "h2", status: "hot", subAgents: [] });
    const cool1 = makeSession({ id: "c1", status: "cool", subAgents: [] });
    const project = makeProject("myproj", [hot1, hot2, cool1]);

    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
        selectedId={null}
        hasFocus={false}
        width={120}
      />,
    );
    const text = lastFrame() ?? "";
    // Sessions row: 3 sessions, 2 active (hot+hot) → "(2)" after "sessions"
    expect(text).toMatch(/3 sessions \(2\)/);
    // Sub-agents: 3 total under hot1, 2 active (hot+warm) → "(2)" after "sub-agents"
    expect(text).toMatch(/3 sub-agents \(2\)/);
  });

  it("omits active parens entirely when nothing is active", () => {
    const cool1 = makeSession({ id: "c1", status: "cool", subAgents: [] });
    const cool2 = makeSession({ id: "c2", status: "cool", subAgents: [] });
    const project = makeProject("myproj", [cool1, cool2], { hotness: "cool" });

    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
        selectedId={null}
        hasFocus={false}
        width={120}
      />,
    );
    const text = lastFrame() ?? "";
    expect(text).toContain("2 sessions");
    expect(text).toContain("0 sub-agents");
    // No "(N)" segments anywhere on the project row's counts area.
    expect(text).not.toMatch(/2 sessions \(\d+\)/);
    expect(text).not.toMatch(/0 sub-agents \(\d+\)/);
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

  describe("getBadge", () => {
    it("returns green [working] for a working session", () => {
      expect(getBadge(makeSession({ liveState: "working" }))).toEqual({
        text: "[working]",
        color: "green",
      });
    });

    it("returns magenta [waiting] for a waiting session", () => {
      expect(getBadge(makeSession({ liveState: "waiting" }))).toEqual({
        text: "[waiting]",
        color: "magenta",
      });
    });

    it("falls back to the time-based badge when liveState is null", () => {
      expect(getBadge(makeSession({ liveState: null, status: "hot" }))).toEqual(
        {
          text: "[hot]",
          color: "green",
        },
      );
      expect(
        getBadge(makeSession({ liveState: null, status: "cold" })),
      ).toEqual({
        text: "[cold]",
        color: "gray",
      });
    });
  });

  it("renders [working] badge for a working session", () => {
    const session = makeSession({ liveState: "working" });
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
    expect(lastFrame()).toContain("[working]");
  });

  it("renders [waiting] badge for a waiting session", () => {
    const session = makeSession({ liveState: "waiting" });
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
    expect(lastFrame()).toContain("[waiting]");
  });

  it("renders scope label in the header when scopeLabel is set", () => {
    const session = makeSession();
    const project = makeProject("agenthud", [session]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[project]}
        coldProjects={[]}
        selectedId={null}
        hasFocus={false}
        width={80}
        scopeLabel="agenthud"
      />,
    );
    expect(lastFrame()).toContain("Projects [agenthud]");
  });

  it("omits scope label when scopeLabel is not set", () => {
    const session = makeSession();
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
    expect(lastFrame()).not.toMatch(/Projects \[/);
  });
});

describe("isProjectAlive", () => {
  it("returns true when any session is hot or warm", () => {
    const p = makeProject("p", [
      makeSession({ status: "cool" }),
      makeSession({ status: "warm" }),
    ]);
    expect(isProjectAlive(p)).toBe(true);
  });

  it("returns true when an inactive parent has a hot sub-agent", () => {
    const parent = makeSession({
      status: "cool",
      subAgents: [makeSession({ status: "hot" })],
    });
    const p = makeProject("p", [parent]);
    expect(isProjectAlive(p)).toBe(true);
  });

  it("returns false when everything is cool or cold", () => {
    const parent = makeSession({
      status: "cool",
      subAgents: [
        makeSession({ status: "cool" }),
        makeSession({ status: "cold" }),
      ],
    });
    const p = makeProject("p", [parent, makeSession({ status: "cold" })]);
    expect(isProjectAlive(p)).toBe(false);
  });

  it("returns false for an empty project", () => {
    const p = makeProject("p", []);
    expect(isProjectAlive(p)).toBe(false);
  });
});

describe("buildTitleSegments", () => {
  const census: TreeCensus = {
    projects: { total: 12, active: 3 },
    sessions: { total: 68, active: 5 },
    subAgents: { total: 142, active: 2 },
    hidden: { total: 14, active: 1 },
  };

  const concat = (segs: { text: string }[]) => segs.map((s) => s.text).join("");

  it("returns just the label when no census provided", () => {
    const segs = buildTitleSegments("Projects", undefined, 80);
    expect(concat(segs)).toBe("Projects");
  });

  it("emits the full long form at wide widths", () => {
    const segs = buildTitleSegments("", census, 200);
    const text = concat(segs);
    // Every level keeps its noun ("projects" / "sessions" /
    // "sub-agents"); only the active count is dropped down to a
    // colored number inside parens with no " active" word — the
    // color carries that signal.
    expect(text).toContain("12 projects");
    expect(text).toContain("68 sessions");
    expect(text).toContain("142 sub-agents");
    expect(text).toContain("⊘ 14 hidden");
    expect(text).not.toContain("active");
    // Active counts present as bare numbers inside parens.
    expect(text).toMatch(/12 projects \(3\)/);
    expect(text).toMatch(/68 sessions \(5\)/);
    expect(text).toMatch(/142 sub-agents \(2\)/);
    expect(text).toMatch(/⊘ 14 hidden \(1\)/);
  });

  it("falls back to short form at medium widths", () => {
    // Tight enough that long form doesn't fit but everything in
    // short form does.
    const segs = buildTitleSegments("Projects", census, 60);
    const text = concat(segs);
    // Short form uses "s" / "a" instead of "sessions" / "sub-agents"
    // and drops the " active" word.
    expect(text).not.toContain("sessions");
    expect(text).not.toContain("sub-agents");
    expect(text).toContain("68s");
    expect(text).toContain("142a");
    expect(text).toContain("⊘");
  });

  it("drops segments from the right, keeping the hidden alert longest", () => {
    const segs = buildTitleSegments("Projects", census, 30);
    const text = concat(segs);
    // Hidden segment (including the (N active) alert) should
    // survive even when sub-agents and sessions are dropped.
    expect(text).toContain("⊘");
    expect(text).toContain("1"); // hidden active
  });

  it("falls back to just the label when too narrow for anything", () => {
    const segs = buildTitleSegments("Projects", census, 8);
    expect(concat(segs)).toBe("Projects");
  });

  it("colors active counts green and hidden active yellow", () => {
    const segs = buildTitleSegments("Projects", census, 200);
    const greenSegs = segs.filter((s) => s.color === "green");
    const yellowSegs = segs.filter((s) => s.color === "yellow");
    // Three green active segments (projects, sessions, sub-agents)
    // and one yellow (hidden active).
    expect(greenSegs).toHaveLength(3);
    expect(yellowSegs).toHaveLength(1);
    expect(yellowSegs[0].text).toContain("1");
  });

  it("omits the active parenthetical when count is zero", () => {
    const flatCensus: TreeCensus = {
      projects: { total: 5, active: 0 },
      sessions: { total: 10, active: 0 },
      subAgents: { total: 0, active: 0 },
      hidden: { total: 0, active: 0 },
    };
    const segs = buildTitleSegments("Projects", flatCensus, 200);
    const text = concat(segs);
    expect(text).not.toContain("(");
    expect(text).not.toContain("⊘");
  });

  it("omits the hidden segment entirely when nothing is hidden", () => {
    const noHidden: TreeCensus = {
      projects: { total: 5, active: 2 },
      sessions: { total: 10, active: 3 },
      subAgents: { total: 4, active: 1 },
      hidden: { total: 0, active: 0 },
    };
    const segs = buildTitleSegments("Projects", noHidden, 200);
    expect(concat(segs)).not.toContain("⊘");
  });
});

describe("SessionTreePanel — pinned live rows", () => {
  const coldFiller = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      makeProject(
        `coldp${i}`,
        [makeSession({ id: `coldsess${i}`, status: "cold" })],
        {
          hotness: "cold",
        },
      ),
    );

  it("keeps a live session visible when the selection scrolls to the bottom (short panel)", () => {
    // Several hot (but NOT live) sub-agents shown individually add rows, so
    // that with the selection on the bottom cold sentinel the live session
    // would otherwise scroll off the top.
    const live = makeSession({
      id: "live0001",
      status: "hot",
      liveState: "working",
      firstUserPrompt: "active work",
      subAgents: Array.from({ length: 6 }, (_, i) =>
        makeSession({
          id: `hs${i}`,
          status: "hot",
          liveState: null,
          projectName: "",
        }),
      ),
    });
    const active = makeProject("liveproj", [live]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[active]}
        coldProjects={coldFiller(8)}
        selectedId="__cold__"
        hasFocus={true}
        width={110}
        maxRows={4}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("#live"); // pinned, not scrolled off
  });

  it("pins by liveState, not the 30-min hot window: finished sub-agents don't flood", () => {
    // A live parent with one WORKING sub-agent and many recently-finished
    // (status hot, liveState null) ones. Only the working one should pin.
    const parent = makeSession({
      id: "par00001",
      status: "hot",
      liveState: "working",
      subAgents: [
        makeSession({
          id: "subwork1",
          status: "hot",
          liveState: "working",
          projectName: "",
        }),
        ...Array.from({ length: 6 }, (_, i) =>
          makeSession({
            id: `subdone${i}`,
            status: "hot",
            liveState: null,
            projectName: "",
          }),
        ),
      ],
    });
    const active = makeProject("liveproj", [parent]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[active]}
        coldProjects={coldFiller(8)}
        selectedId="__cold__"
        hasFocus={true}
        width={110}
        maxRows={6}
      />,
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("#par0"); // live parent pinned
    expect(frame).toContain("subwor"); // working sub-agent pinned
  });

  it("does not render a pinned live row twice (band + tree)", () => {
    const live = makeSession({
      id: "live0001",
      status: "hot",
      liveState: "working",
      subAgents: Array.from({ length: 6 }, (_, i) =>
        makeSession({
          id: `hs${i}`,
          status: "hot",
          liveState: null,
          projectName: "",
        }),
      ),
    });
    const active = makeProject("liveproj", [live]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[active]}
        coldProjects={coldFiller(8)}
        selectedId="live0001" // selecting the live row would scroll the tree to it
        hasFocus={true}
        width={110}
        maxRows={6}
      />,
    );
    const frame = lastFrame() ?? "";
    const occurrences = (frame.match(/#live/g) ?? []).length;
    expect(occurrences).toBe(1); // pinned only, removed from the tree
  });

  it("caps the band and summarizes the overflow as '+N more working'", () => {
    const live = Array.from({ length: 8 }, (_, i) =>
      makeProject(`lp${i}`, [
        makeSession({ id: `lv${i}aaaa`, status: "hot", liveState: "working" }),
      ]),
    );
    const { lastFrame } = render(
      <SessionTreePanel
        projects={live}
        coldProjects={coldFiller(4)}
        selectedId="__cold__"
        hasFocus={true}
        width={110}
        maxRows={8}
      />,
    );
    expect(lastFrame() ?? "").toContain("more working"); // overflow summarized
  });

  it("shows at least one live row even in a tiny panel (bandCap === 1)", () => {
    const live = Array.from({ length: 5 }, (_, i) =>
      makeProject(`lp${i}`, [
        makeSession({ id: `lv${i}aaaa`, status: "hot", liveState: "working" }),
      ]),
    );
    const { lastFrame } = render(
      <SessionTreePanel
        projects={live}
        coldProjects={coldFiller(4)}
        selectedId="__cold__"
        hasFocus={true}
        width={110}
        maxRows={3}
      />,
    );
    expect(lastFrame() ?? "").toContain("[working]"); // a real live row, not just a count
  });

  it("does not pin anything when no session is live (no regression)", () => {
    const hotButIdle = makeSession({
      id: "idle0001",
      status: "hot",
      liveState: null,
    });
    const active = makeProject("liveproj", [hotButIdle]);
    const { lastFrame } = render(
      <SessionTreePanel
        projects={[active]}
        coldProjects={coldFiller(8)}
        selectedId="__cold__"
        hasFocus={true}
        width={110}
        maxRows={4}
      />,
    );
    expect(lastFrame() ?? "").not.toContain("more working");
  });
});
