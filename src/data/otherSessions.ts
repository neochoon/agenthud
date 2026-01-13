import {
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
  readdirSync as nodeReaddirSync,
  statSync as nodeStatSync,
} from "fs";
import { homedir } from "os";
import { join, basename } from "path";

export interface FsMock {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string) => string;
  readdirSync: (path: string) => string[];
  statSync: (path: string) => { mtimeMs?: number; isDirectory?: () => boolean };
}

let fs: FsMock = {
  existsSync: nodeExistsSync,
  readFileSync: (path: string) => nodeReadFileSync(path, "utf-8"),
  readdirSync: (path: string) => nodeReaddirSync(path) as string[],
  statSync: nodeStatSync,
};

export function setFsMock(mock: FsMock): void {
  fs = mock;
}

export function resetFsMock(): void {
  fs = {
    existsSync: nodeExistsSync,
    readFileSync: (path: string) => nodeReadFileSync(path, "utf-8"),
    readdirSync: (path: string) => nodeReaddirSync(path) as string[],
    statSync: nodeStatSync,
  };
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const MAX_LINES_TO_SCAN = 100;

export interface ProjectInfo {
  encodedPath: string;
  decodedPath: string;
}

export interface SessionInfo {
  projectPath: string;
  projectName: string;
  lastModified: Date;
  lastMessage: string | null;
  isActive: boolean;
  relativeTime: string;
}

export interface OtherSessionsData {
  totalProjects: number;
  activeCount: number;
  recentSession: SessionInfo | null;
  timestamp: string;
}

export interface OtherSessionsOptions {
  activeThresholdMs?: number;
}

function getProjectsDir(): string {
  return join(homedir(), ".claude", "projects");
}

function decodeProjectPath(encoded: string): string {
  // Convert "-Users-test-project" back to "/Users/test/project"
  return encoded.replace(/-/g, "/");
}

export function getAllProjects(): ProjectInfo[] {
  const projectsDir = getProjectsDir();

  if (!fs.existsSync(projectsDir)) {
    return [];
  }

  const entries = fs.readdirSync(projectsDir);
  const projects: ProjectInfo[] = [];

  for (const entry of entries) {
    const fullPath = join(projectsDir, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory?.()) {
        projects.push({
          encodedPath: entry,
          decodedPath: decodeProjectPath(entry),
        });
      }
    } catch {
      // Skip entries we can't stat
    }
  }

  return projects;
}

interface JsonlAssistantEntry {
  type: "assistant";
  message: {
    content: Array<{
      type: string;
      text?: string;
    }>;
  };
}

export function parseLastAssistantMessage(sessionFile: string): string | null {
  if (!fs.existsSync(sessionFile)) {
    return null;
  }

  let content: string;
  try {
    content = fs.readFileSync(sessionFile);
  } catch {
    return null;
  }

  const lines = content.trim().split("\n").filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  // Scan from the end to find last assistant message with text
  const recentLines = lines.slice(-MAX_LINES_TO_SCAN).reverse();

  for (const line of recentLines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === "assistant") {
        const assistantEntry = entry as JsonlAssistantEntry;
        const content = assistantEntry.message?.content;
        if (Array.isArray(content)) {
          const textBlock = content.find((c) => c.type === "text" && c.text);
          if (textBlock?.text) {
            return textBlock.text.replace(/\n/g, " ");
          }
        }
      }
    } catch {
      // Skip invalid JSON
    }
  }

  return null;
}

export function formatRelativeTime(date: Date): string {
  const elapsed = Date.now() - date.getTime();
  const seconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 1) {
    return "just now";
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${days}d ago`;
}

function findMostRecentSession(projectDir: string): { file: string; mtimeMs: number } | null {
  if (!fs.existsSync(projectDir)) {
    return null;
  }

  let files: string[];
  try {
    files = fs.readdirSync(projectDir);
  } catch {
    return null;
  }

  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
  if (jsonlFiles.length === 0) {
    return null;
  }

  let latestFile: string | null = null;
  let latestMtime = 0;

  for (const file of jsonlFiles) {
    const filePath = join(projectDir, file);
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs && stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latestFile = filePath;
      }
    } catch {
      // Skip files we can't stat
    }
  }

  if (!latestFile) {
    return null;
  }

  return { file: latestFile, mtimeMs: latestMtime };
}

export function getOtherSessionsData(
  currentProjectPath: string,
  options: OtherSessionsOptions = {}
): OtherSessionsData {
  const activeThresholdMs = options.activeThresholdMs ?? FIVE_MINUTES_MS;
  const projectsDir = getProjectsDir();

  const defaultResult: OtherSessionsData = {
    totalProjects: 0,
    activeCount: 0,
    recentSession: null,
    timestamp: new Date().toISOString(),
  };

  if (!fs.existsSync(projectsDir)) {
    return defaultResult;
  }

  const allProjects = getAllProjects();
  defaultResult.totalProjects = allProjects.length;

  // Normalize current project path for comparison
  const normalizedCurrentPath = currentProjectPath.replace(/\/$/, "");

  // Collect session info for all OTHER projects
  const otherSessions: Array<{
    projectPath: string;
    projectName: string;
    lastModified: Date;
    mtimeMs: number;
    sessionFile: string;
  }> = [];

  for (const project of allProjects) {
    // Skip current project
    if (project.decodedPath === normalizedCurrentPath) {
      continue;
    }

    const projectDir = join(projectsDir, project.encodedPath);
    const sessionInfo = findMostRecentSession(projectDir);

    if (sessionInfo) {
      otherSessions.push({
        projectPath: project.decodedPath,
        projectName: basename(project.decodedPath),
        lastModified: new Date(sessionInfo.mtimeMs),
        mtimeMs: sessionInfo.mtimeMs,
        sessionFile: sessionInfo.file,
      });
    }
  }

  // Count active sessions
  const now = Date.now();
  let activeCount = 0;
  for (const session of otherSessions) {
    if (now - session.mtimeMs < activeThresholdMs) {
      activeCount++;
    }
  }
  defaultResult.activeCount = activeCount;

  // Find most recent session
  if (otherSessions.length === 0) {
    return defaultResult;
  }

  otherSessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const mostRecent = otherSessions[0];

  const lastMessage = parseLastAssistantMessage(mostRecent.sessionFile);
  const isActive = now - mostRecent.mtimeMs < activeThresholdMs;

  defaultResult.recentSession = {
    projectPath: mostRecent.projectPath,
    projectName: mostRecent.projectName,
    lastModified: mostRecent.lastModified,
    lastMessage,
    isActive,
    relativeTime: formatRelativeTime(mostRecent.lastModified),
  };

  return defaultResult;
}
