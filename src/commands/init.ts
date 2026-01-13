import {
  existsSync as nodeExistsSync,
  mkdirSync as nodeMkdirSync,
  writeFileSync as nodeWriteFileSync,
  readFileSync as nodeReadFileSync,
  appendFileSync as nodeAppendFileSync,
} from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { homedir } from "os";

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getDefaultConfig(): string {
  // After bundling, __dirname is dist/, so templates is at dist/templates/
  // In source, __dirname is src/commands/, so templates is at src/templates/
  let templatePath = join(__dirname, "templates", "config.yaml");
  if (!nodeExistsSync(templatePath)) {
    templatePath = join(__dirname, "..", "templates", "config.yaml");
  }
  return nodeReadFileSync(templatePath, "utf-8");
}

export interface InitResult {
  created: string[];
  skipped: string[];
  warnings: string[];
}

function getClaudeSessionPath(projectPath: string): string {
  // Replace both forward and backslashes for cross-platform support
  const encoded = projectPath.replace(/[/\\]/g, "-");
  return join(homedir(), ".claude", "projects", encoded);
}

export function runInit(cwd: string = process.cwd()): InitResult {
  const result: InitResult = {
    created: [],
    skipped: [],
    warnings: [],
  };

  // Create .agenthud/ directory
  if (!fs.existsSync(".agenthud")) {
    fs.mkdirSync(".agenthud", { recursive: true });
    result.created.push(".agenthud/");
  } else {
    result.skipped.push(".agenthud/");
  }

  // Create .agenthud/tests/ directory
  if (!fs.existsSync(".agenthud/tests")) {
    fs.mkdirSync(".agenthud/tests", { recursive: true });
    result.created.push(".agenthud/tests/");
  } else {
    result.skipped.push(".agenthud/tests/");
  }

  // Create config.yaml
  if (!fs.existsSync(".agenthud/config.yaml")) {
    fs.writeFileSync(".agenthud/config.yaml", getDefaultConfig());
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

  // Check for warnings
  if (!fs.existsSync(".git")) {
    result.warnings.push("Not a git repository - Git panel will show limited info");
  }

  const claudeSessionPath = getClaudeSessionPath(cwd);
  if (!fs.existsSync(claudeSessionPath)) {
    result.warnings.push("No Claude session found - start Claude to see activity");
  }

  return result;
}
