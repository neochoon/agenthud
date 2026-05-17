import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type {
  GlobalConfig,
  ProjectNode,
  SessionNode,
  SessionStatus,
  SessionTree,
} from "../types/index.js";
import { ONE_HOUR_MS, THIRTY_MINUTES_MS } from "../ui/constants.js";
import { parseModelName } from "./activityParser.js";

export function getProjectsDir(): string {
  return (
    process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects")
  );
}

function decodeProjectPath(encoded: string): string {
  const windowsDriveMatch = encoded.match(/^([A-Za-z])--(.*)$/);
  if (windowsDriveMatch) {
    const drive = windowsDriveMatch[1];
    const rest = windowsDriveMatch[2].replace(/-/g, "\\");
    return `${drive}:\\${rest}`;
  }
  return encoded.replace(/-/g, "/");
}

function getSessionStatus(mtimeMs: number): SessionStatus {
  const now = Date.now();
  const age = now - mtimeMs;
  if (age < THIRTY_MINUTES_MS) return "hot";
  if (age < ONE_HOUR_MS) return "warm";

  // Use UTC date comparison for timezone-consistent behavior.
  const mtime = new Date(mtimeMs);
  const nowDate = new Date(now);
  if (
    mtime.getUTCFullYear() === nowDate.getUTCFullYear() &&
    mtime.getUTCMonth() === nowDate.getUTCMonth() &&
    mtime.getUTCDate() === nowDate.getUTCDate()
  ) {
    return "cool";
  }
  return "cold";
}

function extractTaskDescription(content: string): string {
  // "## Task N: Title" markdown header
  const headerMatch = content.match(/##\s*(Task\s+\d+[:\s].+)/m);
  if (headerMatch) return headerMatch[1].trim().slice(0, 60);

  // "**This Task (Task N of M):** Title"
  const thisTaskMatch = content.match(/\*\*This Task[^:]+:\*\*\s*(.+)/);
  if (thisTaskMatch) return thisTaskMatch[1].trim().slice(0, 60);

  // Fall back to first non-empty line
  const firstLine = content.split("\n").find((l) => l.trim());
  return (firstLine ?? "").trim().slice(0, 60);
}

function readSubAgentInfo(filePath: string): {
  agentId: string | null;
  taskDescription: string | null;
} {
  if (!existsSync(filePath)) return { agentId: null, taskDescription: null };
  try {
    const firstLine = readFileSync(filePath, "utf-8").split("\n")[0];
    if (!firstLine) return { agentId: null, taskDescription: null };
    const entry = JSON.parse(firstLine);
    const agentId = typeof entry.agentId === "string" ? entry.agentId : null;
    const content =
      typeof entry.message?.content === "string" ? entry.message.content : null;
    const taskDescription = content ? extractTaskDescription(content) : null;
    return { agentId, taskDescription };
  } catch {
    return { agentId: null, taskDescription: null };
  }
}

function readModelName(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    for (const line of lines.slice(-50).reverse()) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "assistant" && entry.message?.model) {
          return parseModelName(entry.message.model as string);
        }
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }
  return null;
}

function readEntrypoint(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const firstLine = readFileSync(filePath, "utf-8").split("\n")[0];
    if (!firstLine) return null;
    const entry = JSON.parse(firstLine);
    return typeof entry.entrypoint === "string" ? entry.entrypoint : null;
  } catch {
    return null;
  }
}

function buildSubAgents(
  parentId: string,
  projectDir: string,
  config: GlobalConfig,
  projectName: string,
): SessionNode[] {
  const subagentsDir = join(projectDir, parentId, "subagents");
  if (!existsSync(subagentsDir)) return [];

  let files: string[];
  try {
    files = (readdirSync(subagentsDir) as string[]).filter((f) =>
      f.endsWith(".jsonl"),
    );
  } catch {
    return [];
  }

  return files
    .map((file): SessionNode | null => {
      const id = file.replace(/\.jsonl$/, "");
      const hideKey = `${projectName}/${id}`;
      const filePath = join(subagentsDir, file);
      try {
        const stat = statSync(filePath);
        const { agentId, taskDescription } = readSubAgentInfo(filePath);
        return {
          id,
          hideKey,
          filePath,
          projectPath: "",
          projectName: "",
          lastModifiedMs: stat.mtimeMs,
          status: getSessionStatus(stat.mtimeMs),
          modelName: readModelName(filePath),
          subAgents: [],
          agentId: agentId ?? undefined,
          taskDescription: taskDescription ?? undefined,
          nonInteractive: false,
        };
      } catch {
        return null;
      }
    })
    .filter(
      (n): n is SessionNode =>
        n !== null && !config.hiddenSubAgents.includes(n.hideKey),
    )
    .sort((a, b) => b.lastModifiedMs - a.lastModifiedMs);
}

export function discoverSessions(config: GlobalConfig): SessionTree {
  const projectsDir = getProjectsDir();

  if (!existsSync(projectsDir)) {
    return {
      projects: [],
      coldProjects: [],
      totalCount: 0,
      timestamp: new Date().toISOString(),
    };
  }

  let projectDirs: string[];
  try {
    projectDirs = (readdirSync(projectsDir) as string[]).filter((entry) => {
      try {
        return statSync(join(projectsDir, entry)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return {
      projects: [],
      coldProjects: [],
      totalCount: 0,
      timestamp: new Date().toISOString(),
    };
  }

  const allSessions: SessionNode[] = [];

  for (const encodedDir of projectDirs) {
    const projectDir = join(projectsDir, encodedDir);
    const decodedPath = decodeProjectPath(encodedDir);
    const projectName = basename(decodedPath);

    let files: string[];
    try {
      files = (readdirSync(projectDir) as string[]).filter((f) =>
        f.endsWith(".jsonl"),
      );
    } catch {
      continue;
    }

    for (const file of files) {
      const id = file.replace(/\.jsonl$/, "");
      const hideKey = `${projectName}/${id}`;
      const filePath = join(projectDir, file);
      try {
        const stat = statSync(filePath);
        const subAgents = buildSubAgents(id, projectDir, config, projectName);
        allSessions.push({
          id,
          hideKey,
          filePath,
          projectPath: decodedPath,
          projectName,
          lastModifiedMs: stat.mtimeMs,
          status: getSessionStatus(stat.mtimeMs),
          modelName: readModelName(filePath),
          subAgents,
          nonInteractive: readEntrypoint(filePath) === "sdk-cli",
        });
      } catch {}
    }
  }

  // Group by projectPath
  const byProject = new Map<string, SessionNode[]>();
  for (const s of allSessions) {
    if (config.hiddenSessions.includes(s.hideKey)) continue;
    const arr = byProject.get(s.projectPath) ?? [];
    arr.push(s);
    byProject.set(s.projectPath, arr);
  }

  const statusOrder: Record<SessionStatus, number> = {
    hot: 0,
    warm: 1,
    cool: 2,
    cold: 3,
  };

  const allProjects: ProjectNode[] = [];
  for (const [projectPath, sessions] of byProject) {
    if (sessions.length === 0) continue;
    const projectName = sessions[0].projectName;
    if (config.hiddenProjects.includes(projectName)) continue;

    // Sort: interactive first, then by status, then by mtime desc
    sessions.sort((a, b) => {
      if (a.nonInteractive !== b.nonInteractive) {
        return a.nonInteractive ? 1 : -1;
      }
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return b.lastModifiedMs - a.lastModifiedMs;
    });

    const hotness = sessions[0].status; // hottest = first after sort

    allProjects.push({ name: projectName, projectPath, sessions, hotness });
  }

  // Partition cold vs active
  const activeProjects = allProjects.filter((p) => p.hotness !== "cold");
  const coldProjects = allProjects.filter((p) => p.hotness === "cold");

  // Sort active projects by hottest session's status, then mtime of hottest session
  activeProjects.sort((a, b) => {
    const statusDiff = statusOrder[a.hotness] - statusOrder[b.hotness];
    if (statusDiff !== 0) return statusDiff;
    return b.sessions[0].lastModifiedMs - a.sessions[0].lastModifiedMs;
  });

  const countSessions = (projects: ProjectNode[]) =>
    projects.reduce(
      (sum, p) =>
        sum +
        p.sessions.length +
        p.sessions.reduce((s, sn) => s + sn.subAgents.length, 0),
      0,
    );

  const totalCount =
    countSessions(activeProjects) + countSessions(coldProjects);

  return {
    projects: activeProjects,
    coldProjects,
    totalCount,
    timestamp: new Date().toISOString(),
  };
}
