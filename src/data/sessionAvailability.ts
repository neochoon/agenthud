import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { getAllProjects } from "./otherSessions.js";

export interface ProjectInfo {
  name: string;
  path: string;
}

export interface SessionAvailabilityResult {
  hasCurrentSession: boolean;
  otherProjects: ProjectInfo[];
}

/**
 * Shorten path by replacing home directory with ~
 * e.g., /Users/test/project → ~/project
 */
export function shortenPath(path: string): string {
  const home = homedir();
  if (path === home) {
    return "~";
  }
  if (path.startsWith(home + "/") || path.startsWith(home + "\\")) {
    return "~" + path.slice(home.length);
  }
  return path;
}

/**
 * Convert project path to Claude session directory path
 * e.g., /Users/test/project → ~/.claude/projects/-Users-test-project
 */
function getSessionPath(projectPath: string): string {
  const encoded = projectPath.replace(/[/\\]/g, "-");
  return join(homedir(), ".claude", "projects", encoded);
}

/**
 * Check if current project has a Claude session
 */
export function hasCurrentProjectSession(cwd: string): boolean {
  const sessionPath = getSessionPath(cwd);
  return existsSync(sessionPath);
}

/**
 * Get list of projects that have Claude sessions, excluding current project
 */
export function getProjectsWithSessions(currentPath: string): ProjectInfo[] {
  const allProjects = getAllProjects();
  const currentEncoded = currentPath.replace(/[/\\]/g, "-");

  return allProjects
    .filter((p) => p.encodedPath !== currentEncoded)
    .map((p) => ({
      name: basename(p.decodedPath),
      path: p.decodedPath,
    }));
}

/**
 * Check session availability for the application startup logic
 * Returns whether current project has session and list of other projects with sessions
 */
export function checkSessionAvailability(cwd: string): SessionAvailabilityResult {
  const hasCurrentSession = hasCurrentProjectSession(cwd);

  if (hasCurrentSession) {
    return {
      hasCurrentSession: true,
      otherProjects: [],
    };
  }

  const otherProjects = getProjectsWithSessions(cwd);

  return {
    hasCurrentSession: false,
    otherProjects,
  };
}
