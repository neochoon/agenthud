import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectTestFramework } from "../data/detectTestFramework.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function getDefaultConfig(): string {
  // After bundling, __dirname is dist/, so templates is at dist/templates/
  // In source, __dirname is src/commands/, so templates is at src/templates/
  let templatePath = join(__dirname, "templates", "config.yaml");
  if (!existsSync(templatePath)) {
    templatePath = join(__dirname, "..", "templates", "config.yaml");
  }
  return readFileSync(templatePath, "utf-8");
}

export interface InitResult {
  created: string[];
  skipped: string[];
  warnings: string[];
  detectedTestFramework?: string;
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
  if (!existsSync(".agenthud")) {
    mkdirSync(".agenthud", { recursive: true });
    result.created.push(".agenthud/");
  } else {
    result.skipped.push(".agenthud/");
  }

  // Create .agenthud/tests/ directory
  if (!existsSync(".agenthud/tests")) {
    mkdirSync(".agenthud/tests", { recursive: true });
    result.created.push(".agenthud/tests/");
  } else {
    result.skipped.push(".agenthud/tests/");
  }

  // Detect test framework
  const testFramework = detectTestFramework();
  if (testFramework) {
    result.detectedTestFramework = testFramework.framework;
  }

  // Create config.yaml
  if (!existsSync(".agenthud/config.yaml")) {
    let configContent = getDefaultConfig();

    // Replace test command with detected framework command
    if (testFramework) {
      configContent = configContent.replace(
        /command: npx vitest run --reporter=json/,
        `command: ${testFramework.command}`,
      );
    } else {
      // No test framework detected - comment out the command
      configContent = configContent.replace(
        /command: npx vitest run --reporter=json/,
        "# command: (auto-detect failed - configure manually)",
      );
    }

    writeFileSync(".agenthud/config.yaml", configContent);
    result.created.push(".agenthud/config.yaml");
  } else {
    result.skipped.push(".agenthud/config.yaml");
  }

  // Handle .gitignore
  if (!existsSync(".gitignore")) {
    writeFileSync(".gitignore", ".agenthud/\n");
    result.created.push(".gitignore");
  } else {
    const content = readFileSync(".gitignore", "utf-8");
    if (!content.includes(".agenthud/")) {
      appendFileSync(".gitignore", "\n.agenthud/\n");
      result.created.push(".gitignore");
    } else {
      result.skipped.push(".gitignore");
    }
  }

  // Check for warnings
  if (!existsSync(".git")) {
    result.warnings.push(
      "Not a git repository - Git panel will show limited info",
    );
  }

  const claudeSessionPath = getClaudeSessionPath(cwd);
  if (!existsSync(claudeSessionPath)) {
    result.warnings.push(
      "No Claude session found - start Claude to see activity",
    );
  }

  return result;
}
