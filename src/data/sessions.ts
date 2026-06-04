import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type {
  GlobalConfig,
  LiveState,
  ProjectNode,
  SessionNode,
  SessionStatus,
  SessionTree,
} from "../types/index.js";
import { ONE_HOUR_MS, THIRTY_MINUTES_MS } from "../ui/constants.js";
import { parseModelName } from "./activityParser.js";
import { detectLiveState } from "./sessionLiveness.js";

export function getProjectsDir(): string {
  return (
    process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), ".claude", "projects")
  );
}

export function decodeProjectPath(encoded: string): string {
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

// Generous safety cap to keep arbitrarily long sub-agent task headers or
// user prompts out of memory while leaving the actual display-width
// truncation to the panel (which knows the terminal width and adds "…").
const MAX_TITLE_LEN = 300;

function capWithEllipsis(s: string, max = MAX_TITLE_LEN): string {
  const trimmed = s.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function extractTaskDescription(content: string): string {
  // "## Task N: Title" markdown header
  const headerMatch = content.match(/##\s*(Task\s+\d+[:\s].+)/m);
  if (headerMatch) return capWithEllipsis(headerMatch[1]);

  // "**This Task (Task N of M):** Title"
  const thisTaskMatch = content.match(/\*\*This Task[^:]+:\*\*\s*(.+)/);
  if (thisTaskMatch) return capWithEllipsis(thisTaskMatch[1]);

  // Fall back to first non-empty line
  const firstLine = content.split("\n").find((l) => l.trim());
  return capWithEllipsis(firstLine ?? "");
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

function readSessionTail(
  filePath: string,
  mtimeMs: number,
  now: number,
): { modelName: string | null; liveState: LiveState | null } {
  if (!existsSync(filePath)) return { modelName: null, liveState: null };
  try {
    const content = readFileSync(filePath, "utf-8");
    const tail = content.trim().split("\n").filter(Boolean).slice(-50);

    let modelName: string | null = null;
    for (const line of [...tail].reverse()) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "assistant" && entry.message?.model) {
          modelName = parseModelName(entry.message.model as string);
          break;
        }
      } catch {
        // skip
      }
    }

    return { modelName, liveState: detectLiveState(tail, mtimeMs, now) };
  } catch {
    return { modelName: null, liveState: null };
  }
}

const SYSTEM_PREFIXES = [
  "<command-name>",
  "<command-message>",
  "<command-args>",
  "<local-command-stdout>",
  "<local-command-caveat>",
  "<system-reminder>",
  "<bash-input>",
  "<bash-stdout>",
  "<bash-stderr>",
  "<user-prompt-submit-hook>",
];

function isSystemNoise(text: string): boolean {
  const trimmed = text.trimStart();
  return SYSTEM_PREFIXES.some((p) => trimmed.startsWith(p));
}

function readFirstUserPrompt(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let entry: {
      type?: string;
      message?: { content?: unknown };
      toolUseResult?: unknown;
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "user") continue;
    if (entry.toolUseResult !== undefined) continue; // tool result, not real user input

    const raw = entry.message?.content;
    let text: string;
    if (typeof raw === "string") {
      text = raw;
    } else if (Array.isArray(raw)) {
      // content can be an array of blocks; find first text block
      const textBlock = raw.find(
        (b: { type?: string; text?: string }) =>
          b && b.type === "text" && typeof b.text === "string",
      ) as { text?: string } | undefined;
      text = textBlock?.text ?? "";
    } else {
      continue;
    }

    if (!text || isSystemNoise(text)) continue;

    const firstLine = text.split("\n").find((l) => l.trim()) ?? "";
    if (!firstLine || isSystemNoise(firstLine)) continue;
    return capWithEllipsis(firstLine);
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
        const { modelName, liveState } = readSessionTail(
          filePath,
          stat.mtimeMs,
          Date.now(),
        );
        return {
          id,
          hideKey,
          filePath,
          projectPath: "",
          projectName: "",
          lastModifiedMs: stat.mtimeMs,
          status: getSessionStatus(stat.mtimeMs),
          modelName,
          subAgents: [],
          agentId: agentId ?? undefined,
          taskDescription: taskDescription ?? undefined,
          nonInteractive: false,
          firstUserPrompt: null,
          liveState,
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

// Returns the registered project whose path is the nearest ancestor of cwd
// (or equals cwd). Both inputs and the returned value are matched as strings,
// so callers that care about symlinks should pre-resolve their paths or
// inject a `realpath` via options.
export function findContainingProject(
  cwd: string,
  projectPaths: string[],
  options?: { realpath?: (p: string) => string },
): string | null {
  const resolve = options?.realpath ?? ((p: string) => p);
  const cwdR = resolve(cwd);

  let best: string | null = null;
  let bestLen = -1;
  for (const raw of projectPaths) {
    let pR: string;
    try {
      pR = resolve(raw);
    } catch {
      continue;
    }
    if (cwdR === pR) {
      if (pR.length > bestLen) {
        best = raw;
        bestLen = pR.length;
      }
      continue;
    }
    // Accept either separator as the boundary so the helper works on both
    // POSIX (/) and Windows (\), regardless of which form a particular
    // caller's paths happen to use.
    const boundary = cwdR[pR.length];
    if ((boundary === "/" || boundary === "\\") && cwdR.startsWith(pR)) {
      if (pR.length > bestLen) {
        best = raw;
        bestLen = pR.length;
      }
    }
  }
  return best;
}

export interface DiscoverOptions {
  // When set, drop every project whose decoded path is not exactly this
  // string. Caller is responsible for resolving symlinks and choosing
  // the matching project (see findContainingProject).
  scopeToProject?: string;
}

export function discoverSessions(
  config: GlobalConfig,
  options?: DiscoverOptions,
): SessionTree {
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

  const scope = options?.scopeToProject ?? null;

  for (const encodedDir of projectDirs) {
    const projectDir = join(projectsDir, encodedDir);
    const decodedPath = decodeProjectPath(encodedDir);
    if (scope !== null && decodedPath !== scope) continue;
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
        const nonInteractive = readEntrypoint(filePath) === "sdk-cli";
        const { modelName, liveState } = readSessionTail(
          filePath,
          stat.mtimeMs,
          Date.now(),
        );
        allSessions.push({
          id,
          hideKey,
          filePath,
          projectPath: decodedPath,
          projectName,
          lastModifiedMs: stat.mtimeMs,
          status: getSessionStatus(stat.mtimeMs),
          modelName,
          subAgents,
          nonInteractive,
          firstUserPrompt: readFirstUserPrompt(filePath),
          liveState: nonInteractive ? null : liveState,
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
