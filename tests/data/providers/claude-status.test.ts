import { describe, expect, it } from "vitest";
import {
  getSessionStatus,
  getSubAgentStatus,
} from "../../../src/data/providers/claude.js";

// Fixed "now" at UTC noon so same-day (cool) vs cold comparisons are stable.
const NOW = Date.UTC(2026, 5, 23, 12, 0, 0);
const minutesAgo = (m: number) => NOW - m * 60_000;

describe("getSubAgentStatus — sub-agents use a short (5-min) hot window", () => {
  it("is hot only within 5 minutes", () => {
    expect(getSubAgentStatus(minutesAgo(2), NOW)).toBe("hot");
    expect(getSubAgentStatus(minutesAgo(4), NOW)).toBe("hot");
  });

  it("is warm (not hot) once past 5 minutes — where a session would still be hot", () => {
    expect(getSubAgentStatus(minutesAgo(10), NOW)).toBe("warm");
    expect(getSubAgentStatus(minutesAgo(45), NOW)).toBe("warm");
  });

  it("falls to cool/cold by date after an hour, same as sessions", () => {
    expect(getSubAgentStatus(minutesAgo(90), NOW)).toBe("cool"); // earlier same UTC day
    expect(getSubAgentStatus(minutesAgo(60 * 30), NOW)).toBe("cold"); // 30h ago
  });
});

describe("getSessionStatus — top-level sessions keep the 30-min hot window", () => {
  it("stays hot up to 30 minutes", () => {
    expect(getSessionStatus(minutesAgo(10), NOW)).toBe("hot");
    expect(getSessionStatus(minutesAgo(29), NOW)).toBe("hot");
  });

  it("becomes warm between 30 and 60 minutes", () => {
    expect(getSessionStatus(minutesAgo(45), NOW)).toBe("warm");
  });
});
