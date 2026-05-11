import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { GlobalConfig, SessionNode, SessionTree } from "../types/index.js";
import { THIRTY_SECONDS_MS } from "../ui/constants.js";
import { parseModelName } from "./activityParser.js";

function getProjectsDir(): string {
  return join(homedir(), ".claude", "projects");
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

function getSessionStatus(
  mtimeMs: number,
  config: GlobalConfig,
): "running" | "idle" | "done" {
  const age = Date.now() - mtimeMs;
  if (age < THIRTY_SECONDS_MS) return "running";
  if (age < config.sessionTimeoutMs) return "idle";
  return "done";
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

function buildSubAgents(
  parentId: string,
  projectDir: string,
  config: GlobalConfig,
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
      const filePath = join(subagentsDir, file);
      try {
        const stat = statSync(filePath);
        return {
          id,
          filePath,
          projectPath: "",
          projectName: "",
          lastModifiedMs: stat.mtimeMs,
          status: getSessionStatus(stat.mtimeMs, config),
          modelName: readModelName(filePath),
          subAgents: [],
        };
      } catch {
        return null;
      }
    })
    .filter((n): n is SessionNode => n !== null && n.status !== "done")
    .sort((a, b) => b.lastModifiedMs - a.lastModifiedMs);
}

export function discoverSessions(config: GlobalConfig): SessionTree {
  const projectsDir = getProjectsDir();

  if (!existsSync(projectsDir)) {
    return { sessions: [], totalCount: 0, timestamp: new Date().toISOString() };
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
    return { sessions: [], totalCount: 0, timestamp: new Date().toISOString() };
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
      const filePath = join(projectDir, file);
      try {
        const stat = statSync(filePath);
        const subAgents = buildSubAgents(id, projectDir, config);
        allSessions.push({
          id,
          filePath,
          projectPath: decodedPath,
          projectName,
          lastModifiedMs: stat.mtimeMs,
          status: getSessionStatus(stat.mtimeMs, config),
          modelName: readModelName(filePath),
          subAgents,
        });
      } catch {}
    }
  }

  allSessions.sort((a, b) => {
    const statusOrder = { running: 0, idle: 1, done: 2 };
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) return statusDiff;
    return b.lastModifiedMs - a.lastModifiedMs;
  });

  const visible = allSessions.filter((s) => s.status !== "done");
  const totalCount =
    visible.length + visible.reduce((sum, s) => sum + s.subAgents.length, 0);

  return {
    sessions: visible,
    totalCount,
    timestamp: new Date().toISOString(),
  };
}
