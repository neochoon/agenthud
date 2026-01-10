import {
  existsSync as nodeExistsSync,
  mkdirSync as nodeMkdirSync,
  writeFileSync as nodeWriteFileSync,
  readFileSync as nodeReadFileSync,
  appendFileSync as nodeAppendFileSync,
} from "fs";

export interface FsMock {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
  writeFileSync: (path: string, data: string) => void;
  readFileSync: (path: string) => string;
  appendFileSync: (path: string, data: string) => void;
}

// Default fs functions
let fs: FsMock = {
  existsSync: nodeExistsSync,
  mkdirSync: nodeMkdirSync as FsMock["mkdirSync"],
  writeFileSync: nodeWriteFileSync as FsMock["writeFileSync"],
  readFileSync: (path: string) => nodeReadFileSync(path, "utf-8"),
  appendFileSync: nodeAppendFileSync as FsMock["appendFileSync"],
};

export function setFsMock(mock: FsMock): void {
  fs = mock;
}

export function resetFsMock(): void {
  fs = {
    existsSync: nodeExistsSync,
    mkdirSync: nodeMkdirSync as FsMock["mkdirSync"],
    writeFileSync: nodeWriteFileSync as FsMock["writeFileSync"],
    readFileSync: (path: string) => nodeReadFileSync(path, "utf-8"),
    appendFileSync: nodeAppendFileSync as FsMock["appendFileSync"],
  };
}

const AGENT_STATE_SECTION = `## Agent State

Maintain \`.agenthud/\` directory:
- Update \`plan.json\` when plan changes
- Append to \`decisions.json\` for key decisions
`;

const DEFAULT_CONFIG = `# agenthud configuration
panels:
  git:
    enabled: true
    interval: 30s
    command:
      branch: git branch --show-current
      commits: git log --since=midnight --pretty=format:"%h|%aI|%s"
      stats: git log --since=midnight --numstat --pretty=format:""

  plan:
    enabled: true
    interval: 10s
    source: .agenthud/plan.json

  tests:
    enabled: true
    interval: manual
    command: npx vitest run --reporter=json
`;

export interface InitResult {
  created: string[];
  skipped: string[];
}

export function runInit(): InitResult {
  const result: InitResult = {
    created: [],
    skipped: [],
  };

  // Create .agenthud/ directory
  if (!fs.existsSync(".agenthud")) {
    fs.mkdirSync(".agenthud", { recursive: true });
    result.created.push(".agenthud/");
  } else {
    result.skipped.push(".agenthud/");
  }

  // Create plan.json
  if (!fs.existsSync(".agenthud/plan.json")) {
    fs.writeFileSync(".agenthud/plan.json", "{}\n");
    result.created.push(".agenthud/plan.json");
  } else {
    result.skipped.push(".agenthud/plan.json");
  }

  // Create decisions.json
  if (!fs.existsSync(".agenthud/decisions.json")) {
    fs.writeFileSync(".agenthud/decisions.json", "[]\n");
    result.created.push(".agenthud/decisions.json");
  } else {
    result.skipped.push(".agenthud/decisions.json");
  }

  // Create config.yaml
  if (!fs.existsSync(".agenthud/config.yaml")) {
    fs.writeFileSync(".agenthud/config.yaml", DEFAULT_CONFIG);
    result.created.push(".agenthud/config.yaml");
  } else {
    result.skipped.push(".agenthud/config.yaml");
  }

  // Handle .gitignore
  if (!fs.existsSync(".gitignore")) {
    fs.writeFileSync(".gitignore", ".agenthud/\n");
    result.created.push(".gitignore");
  } else {
    const content = fs.readFileSync(".gitignore");
    if (!content.includes(".agenthud/")) {
      fs.appendFileSync(".gitignore", "\n.agenthud/\n");
      result.created.push(".gitignore");
    } else {
      result.skipped.push(".gitignore");
    }
  }

  // Handle CLAUDE.md
  if (!fs.existsSync("CLAUDE.md")) {
    fs.writeFileSync("CLAUDE.md", AGENT_STATE_SECTION);
    result.created.push("CLAUDE.md");
  } else {
    const content = fs.readFileSync("CLAUDE.md");
    if (!content.includes("## Agent State")) {
      fs.appendFileSync("CLAUDE.md", "\n" + AGENT_STATE_SECTION);
      result.created.push("CLAUDE.md");
    } else {
      result.skipped.push("CLAUDE.md");
    }
  }

  return result;
}
