import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock fs module
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

// Mock os module
vi.mock("node:os", () => ({
  homedir: () => "/home/user",
}));

// Mock otherSessions module
vi.mock("../../src/data/otherSessions.js", () => ({
  getAllProjects: vi.fn(),
}));

import { existsSync } from "node:fs";
import { getAllProjects } from "../../src/data/otherSessions.js";
import {
  checkSessionAvailability,
  getProjectsWithSessions,
  hasCurrentProjectSession,
} from "../../src/data/sessionAvailability.js";

const mockExistsSync = vi.mocked(existsSync);
const mockGetAllProjects = vi.mocked(getAllProjects);

describe("sessionAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("hasCurrentProjectSession", () => {
    it("returns true when session directory exists for current path", () => {
      mockExistsSync.mockReturnValue(true);

      const result = hasCurrentProjectSession("/Users/test/my-project");

      expect(result).toBe(true);
      // Use join() for platform-independent path
      const expectedPath = join(
        "/home/user",
        ".claude",
        "projects",
        "-Users-test-my-project",
      );
      expect(mockExistsSync).toHaveBeenCalledWith(expectedPath);
    });

    it("returns false when session directory does not exist", () => {
      mockExistsSync.mockReturnValue(false);

      const result = hasCurrentProjectSession("/Users/test/my-project");

      expect(result).toBe(false);
    });
  });

  describe("getProjectsWithSessions", () => {
    it("returns list of project names that have sessions", () => {
      mockGetAllProjects.mockReturnValue([
        { encodedPath: "-Users-test-project-a", decodedPath: "/Users/test/project-a" },
        { encodedPath: "-Users-test-project-b", decodedPath: "/Users/test/project-b" },
        { encodedPath: "-Users-test-project-c", decodedPath: "/Users/test/project-c" },
      ]);

      const result = getProjectsWithSessions("/Users/test/current");

      expect(result).toEqual(["project-a", "project-b", "project-c"]);
    });

    it("excludes current project from the list", () => {
      mockGetAllProjects.mockReturnValue([
        { encodedPath: "-Users-test-project-a", decodedPath: "/Users/test/project-a" },
        { encodedPath: "-Users-test-current", decodedPath: "/Users/test/current" },
        { encodedPath: "-Users-test-project-b", decodedPath: "/Users/test/project-b" },
      ]);

      const result = getProjectsWithSessions("/Users/test/current");

      expect(result).toEqual(["project-a", "project-b"]);
      expect(result).not.toContain("current");
    });

    it("returns empty array when no projects exist", () => {
      mockGetAllProjects.mockReturnValue([]);

      const result = getProjectsWithSessions("/Users/test/current");

      expect(result).toEqual([]);
    });
  });

  describe("checkSessionAvailability", () => {
    it("returns hasCurrentSession: true when current project has session", () => {
      mockExistsSync.mockReturnValue(true);
      mockGetAllProjects.mockReturnValue([]);

      const result = checkSessionAvailability("/Users/test/current");

      expect(result.hasCurrentSession).toBe(true);
      expect(result.otherProjects).toEqual([]);
    });

    it("returns otherProjects list when current project has no session but others do", () => {
      mockExistsSync.mockReturnValue(false);
      mockGetAllProjects.mockReturnValue([
        { encodedPath: "-Users-test-project-a", decodedPath: "/Users/test/project-a" },
        { encodedPath: "-Users-test-project-b", decodedPath: "/Users/test/project-b" },
      ]);

      const result = checkSessionAvailability("/Users/test/current");

      expect(result.hasCurrentSession).toBe(false);
      expect(result.otherProjects).toEqual(["project-a", "project-b"]);
    });

    it("returns empty otherProjects when no sessions exist anywhere", () => {
      mockExistsSync.mockReturnValue(false);
      mockGetAllProjects.mockReturnValue([]);

      const result = checkSessionAvailability("/Users/test/current");

      expect(result.hasCurrentSession).toBe(false);
      expect(result.otherProjects).toEqual([]);
    });
  });
});
