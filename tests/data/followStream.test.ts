import { describe, expect, it } from "vitest";
import { diffSnapshots } from "../../src/data/followStream.js";
import type { NodeSnapshot } from "../../src/data/followTypes.js";
import type { ActivityEntry } from "../../src/types/index.js";

const act = (
  label: string,
  ts: number,
  type: ActivityEntry["type"] = "tool",
): ActivityEntry => ({
  timestamp: new Date(ts),
  type,
  icon: "x",
  label,
  detail: `${label}-detail`,
});

const node = (o: Partial<NodeSnapshot> = {}): NodeSnapshot => ({
  session: "s1",
  subagent: null,
  provider: "claude",
  project: "proj",
  projectPath: "/p/proj",
  liveState: null,
  activities: [],
  ...o,
});

const NOW = 1_000_000;

describe("diffSnapshots", () => {
  it("emits session_start + activities for a never-seen node", () => {
    const snap = node({ activities: [act("Read", 10), act("Edit", 20)] });
    const { events } = diffSnapshots(new Map(), [snap], null, NOW);
    expect(events.map((e) => [e.type, e.kind ?? e.label])).toEqual([
      ["lifecycle", "session_start"],
      ["activity", "Read"],
      ["activity", "Edit"],
    ]);
    expect(events[0].ts).toBe(NOW); // lifecycle stamped at detection time
    expect(events[1].ts).toBe(10); // activity keeps its own ts
  });

  it("emits only NEW activities past the cursor on the next tick", () => {
    const first = node({ activities: [act("Read", 10)] });
    const r1 = diffSnapshots(new Map(), [first], null, NOW);
    const second = node({ activities: [act("Read", 10), act("Bash", 30)] });
    const { events } = diffSnapshots(r1.nextState, [second], null, NOW + 1);
    expect(events.map((e) => e.label)).toEqual(["Bash"]);
  });

  it("emits a state event when liveState changes", () => {
    const a = node({ liveState: "working", activities: [act("Edit", 10)] });
    const r1 = diffSnapshots(new Map(), [a], null, NOW);
    const b = node({ liveState: "waiting", activities: [act("Edit", 10)] });
    const { events } = diffSnapshots(r1.nextState, [b], null, NOW + 1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "state",
      from: "working",
      to: "waiting",
      ts: NOW + 1,
    });
  });

  it("emits session_end when a node disappears", () => {
    const a = node({ activities: [act("Edit", 10)] });
    const r1 = diffSnapshots(new Map(), [a], null, NOW);
    const { events } = diffSnapshots(r1.nextState, [], null, NOW + 1);
    expect(events).toEqual([
      expect.objectContaining({
        type: "lifecycle",
        kind: "session_end",
        session: "s1",
        ts: NOW + 1,
      }),
    ]);
  });

  it("uses subagent_spawn / subagent_done for sub-agent nodes", () => {
    const sub = node({ subagent: "rev", activities: [act("Read", 10)] });
    const r1 = diffSnapshots(new Map(), [sub], null, NOW);
    expect(r1.events[0]).toMatchObject({
      type: "lifecycle",
      kind: "subagent_spawn",
      subagent: "rev",
    });
    const { events } = diffSnapshots(r1.nextState, [], null, NOW + 1);
    expect(events[0]).toMatchObject({ kind: "subagent_done", subagent: "rev" });
  });

  it("honors the include filter on activities only (state/lifecycle always pass)", () => {
    const a = node({
      liveState: "working",
      activities: [act("Edit", 10), act("response", 20, "response")],
    });
    const include = new Set(["response"]);
    const r = diffSnapshots(new Map(), [a], include, NOW);
    // session_start (always) + only the response activity
    expect(r.events.map((e) => e.kind ?? e.label)).toEqual([
      "session_start",
      "response",
    ]);
  });

  it("emits no events when nothing changed", () => {
    const a = node({ activities: [act("Read", 10)] });
    const r1 = diffSnapshots(new Map(), [a], null, NOW);
    const { events } = diffSnapshots(r1.nextState, [a], null, NOW + 1);
    expect(events).toEqual([]);
  });

  it("orders a tick's events by ts", () => {
    const a = node({ session: "s2", activities: [act("Bash", 50)] });
    const b = node({ activities: [act("Read", 5)] });
    const { events } = diffSnapshots(new Map(), [a, b], null, NOW);
    const tss = events.filter((e) => e.type === "activity").map((e) => e.ts);
    expect(tss).toEqual([...tss].sort((x, y) => x - y));
  });
});
