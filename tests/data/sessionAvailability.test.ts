import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock fs module
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
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

import { existsSync, readdirSync, statSync } from "node:fs";
import { getAllProjects } from "../../src/data/otherSessions.js";
import {
  checkSessionAvailability,
  getProjectsWithSessions,
  hasCurrentProjectSession,
  shortenPath,
} from "../../src/data/sessionAvailability.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockStatSync = vi.mocked(statSync);
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
    it("returns list of projects sorted by most recent modification time", () => {
      mockGetAllProjects.mockReturnValue([
        { encodedPath: "-Users-test-project-a", decodedPath: "/Users/test/project-a" },
        { encodedPath: "-Users-test-project-b", decodedPath: "/Users/test/project-b" },
        { encodedPath: "-Users-test-project-c", decodedPath: "/Users/test/project-c" },
      ]);

      // Mock session directories exist
      mockExistsSync.mockReturnValue(true);

      // Mock session files for each project
      mockReaddirSync.mockImplementation((dir) => {
        if (String(dir).includes("-Users-test-project-a")) return ["session1.jsonl"];
        if (String(dir).includes("-Users-test-project-b")) return ["session1.jsonl"];
        if (String(dir).includes("-Users-test-project-c")) return ["session1.jsonl"];
        return [];
      });

      // Mock modification times: project-c is newest, project-a is oldest
      mockStatSync.mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.includes("-Users-test-project-a")) return { mtimeMs: 1000, isDirectory: () => true } as any;
        if (pathStr.includes("-Users-test-project-b")) return { mtimeMs: 2000, isDirectory: () => true } as any;
        if (pathStr.includes("-Users-test-project-c")) return { mtimeMs: 3000, isDirectory: () => true } as any;
        return { mtimeMs: 0, isDirectory: () => true } as any;
      });

      const result = getProjectsWithSessions("/Users/test/current");

      // Should be sorted by most recent first
      expect(result).toEqual([
        { name: "project-c", path: "/Users/test/project-c" },
        { name: "project-b", path: "/Users/test/project-b" },
        { name: "project-a", path: "/Users/test/project-a" },
      ]);
    });

    it("excludes current project from the list", () => {
      mockGetAllProjects.mockReturnValue([
        { encodedPath: "-Users-test-project-a", decodedPath: "/Users/test/project-a" },
        { encodedPath: "-Users-test-current", decodedPath: "/Users/test/current" },
        { encodedPath: "-Users-test-project-b", decodedPath: "/Users/test/project-b" },
      ]);

      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(["session1.jsonl"] as any);
      mockStatSync.mockReturnValue({ mtimeMs: 1000, isDirectory: () => true } as any);

      const result = getProjectsWithSessions("/Users/test/current");

      expect(result.map((p) => p.name)).not.toContain("current");
      expect(result.length).toBe(2);
    });

    it("returns empty array when no projects exist", () => {
      mockGetAllProjects.mockReturnValue([]);

      const result = getProjectsWithSessions("/Users/test/current");

      expect(result).toEqual([]);
    });

    it("puts projects without sessions at the end", () => {
      mockGetAllProjects.mockReturnValue([
        { encodedPath: "-Users-test-project-a", decodedPath: "/Users/test/project-a" },
        { encodedPath: "-Users-test-project-b", decodedPath: "/Users/test/project-b" },
      ]);

      mockExistsSync.mockImplementation((path) => {
        // project-a has no session directory
        if (String(path).includes("-Users-test-project-a")) return false;
        return true;
      });

      mockReaddirSync.mockReturnValue(["session1.jsonl"] as any);
      mockStatSync.mockReturnValue({ mtimeMs: 1000, isDirectory: () => true } as any);

      const result = getProjectsWithSessions("/Users/test/current");

      // project-b should come first (has session), project-a last (no session)
      expect(result[0].name).toBe("project-b");
      expect(result[1].name).toBe("project-a");
    });
  });

  describe("shortenPath", () => {
    it("replaces home directory with ~", () => {
      expect(shortenPath("/home/user/projects/myapp")).toBe("~/projects/myapp");
      expect(shortenPath("/home/user")).toBe("~");
    });

    it("returns path unchanged if not under home directory", () => {
      expect(shortenPath("/var/www/project")).toBe("/var/www/project");
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

    it("returns otherProjects list sorted by most recent when current has no session", () => {
      // First call to existsSync checks current project session (returns false)
      // Subsequent calls check other project directories
      mockExistsSync.mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.includes("-Users-test-current")) return false;
        return true;
      });

      mockGetAllProjects.mockReturnValue([
        { encodedPath: "-Users-test-project-a", decodedPath: "/Users/test/project-a" },
        { encodedPath: "-Users-test-project-b", decodedPath: "/Users/test/project-b" },
      ]);

      mockReaddirSync.mockReturnValue(["session1.jsonl"] as any);

      // project-b is more recent than project-a
      mockStatSync.mockImplementation((path) => {
        const pathStr = String(path);
        if (pathStr.includes("-Users-test-project-a")) return { mtimeMs: 1000, isDirectory: () => true } as any;
        if (pathStr.includes("-Users-test-project-b")) return { mtimeMs: 2000, isDirectory: () => true } as any;
        return { mtimeMs: 0, isDirectory: () => true } as any;
      });

      const result = checkSessionAvailability("/Users/test/current");

      expect(result.hasCurrentSession).toBe(false);
      // Should be sorted by most recent first
      expect(result.otherProjects).toEqual([
        { name: "project-b", path: "/Users/test/project-b" },
        { name: "project-a", path: "/Users/test/project-a" },
      ]);
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
