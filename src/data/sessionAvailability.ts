import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { getAllProjects } from "./otherSessions.js";

export interface SessionAvailabilityResult {
  hasCurrentSession: boolean;
  otherProjects: string[];
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
 * Get list of project names that have Claude sessions, excluding current project
 */
export function getProjectsWithSessions(currentPath: string): string[] {
  const allProjects = getAllProjects();
  const currentEncoded = currentPath.replace(/[/\\]/g, "-");

  return allProjects
    .filter((p) => p.encodedPath !== currentEncoded)
    .map((p) => basename(p.decodedPath));
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
