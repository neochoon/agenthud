import { existsSync, readdirSync, statSync } from "node:fs";
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
 * Get the most recent modification time of session files in a project directory
 * Returns 0 if no session files exist
 */
function getProjectMostRecentMtime(encodedPath: string): number {
  const projectDir = join(homedir(), ".claude", "projects", encodedPath);

  if (!existsSync(projectDir)) {
    return 0;
  }

  let files: string[];
  try {
    files = readdirSync(projectDir) as string[];
  } catch {
    return 0;
  }

  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
  if (jsonlFiles.length === 0) {
    return 0;
  }

  let latestMtime = 0;
  for (const file of jsonlFiles) {
    const filePath = join(projectDir, file);
    try {
      const stat = statSync(filePath);
      if (stat.mtimeMs && stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
      }
    } catch {
      // Skip files we can't stat
    }
  }

  return latestMtime;
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
 * Sorted by most recent modification time (newest first)
 */
export function getProjectsWithSessions(currentPath: string): ProjectInfo[] {
  const allProjects = getAllProjects();
  const currentEncoded = currentPath.replace(/[/\\]/g, "-");

  // Get projects with their modification times
  const projectsWithMtime = allProjects
    .filter((p) => p.encodedPath !== currentEncoded)
    .map((p) => ({
      name: basename(p.decodedPath),
      path: p.decodedPath,
      mtime: getProjectMostRecentMtime(p.encodedPath),
    }));

  // Sort by modification time (newest first), projects without sessions go last
  projectsWithMtime.sort((a, b) => b.mtime - a.mtime);

  // Return without mtime
  return projectsWithMtime.map(({ name, path }) => ({ name, path }));
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
