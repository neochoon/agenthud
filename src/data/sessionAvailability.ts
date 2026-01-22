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
  if (path.startsWith(`${home}/`) || path.startsWith(`${home}\\`)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

/**
 * Project indicator files that suggest a directory is a development project
 */
const PROJECT_INDICATORS = [
  ".git", // Git repository
  "package.json", // Node.js
  "Cargo.toml", // Rust
  "pyproject.toml", // Python (modern)
  "setup.py", // Python (legacy)
  "go.mod", // Go
  "Makefile", // Make-based projects
  "CMakeLists.txt", // CMake projects
  "pom.xml", // Java Maven
  "build.gradle", // Java Gradle
  "Gemfile", // Ruby
  "composer.json", // PHP
];

/**
 * Check if a directory is a development project
 * Returns true if it contains .git or common project files
 */
export function isDevProject(projectPath: string): boolean {
  for (const indicator of PROJECT_INDICATORS) {
    if (existsSync(join(projectPath, indicator))) {
      return true;
    }
  }
  return false;
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
 * Excludes projects whose decoded path doesn't exist on filesystem
 * Excludes directories that are not development projects
 */
export function getProjectsWithSessions(currentPath: string): ProjectInfo[] {
  const allProjects = getAllProjects();
  const currentEncoded = currentPath.replace(/[/\\]/g, "-");

  // Get projects with their modification times
  // Filter out: current project, non-existent paths, and non-dev directories
  const projectsWithMtime = allProjects
    .filter((p) => p.encodedPath !== currentEncoded)
    .filter((p) => existsSync(p.decodedPath)) // Only include projects that exist
    .filter((p) => isDevProject(p.decodedPath)) // Only include development projects
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
export function checkSessionAvailability(
  cwd: string,
): SessionAvailabilityResult {
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
