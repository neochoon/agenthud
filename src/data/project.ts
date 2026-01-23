import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

// Language detection order (first match wins)
const LANGUAGE_INDICATORS: Array<{ file: string; language: string }> = [
  { file: "tsconfig.json", language: "TypeScript" },
  { file: "package.json", language: "JavaScript" },
  { file: "pyproject.toml", language: "Python" },
  { file: "requirements.txt", language: "Python" },
  { file: "setup.py", language: "Python" },
  { file: "go.mod", language: "Go" },
  { file: "Cargo.toml", language: "Rust" },
  { file: "Gemfile", language: "Ruby" },
  { file: "pom.xml", language: "Java" },
  { file: "build.gradle", language: "Java" },
];

// Well-known stack items by category (frameworks first, then tools)
const KNOWN_STACK = {
  frameworks: [
    // JS/TS frameworks
    "react",
    "vue",
    "angular",
    "svelte",
    "next",
    "nuxt",
    "express",
    "fastify",
    "koa",
    "hono",
    "ink",
    // Python frameworks
    "django",
    "flask",
    "fastapi",
    "tornado",
    "pyramid",
  ],
  tools: [
    // JS/TS tools
    "vitest",
    "jest",
    "mocha",
    "webpack",
    "vite",
    "rollup",
    "esbuild",
    "tsup",
    "eslint",
    "prettier",
    // Python tools
    "pytest",
    "pandas",
    "numpy",
    "tensorflow",
    "pytorch",
    "scikit-learn",
    "sqlalchemy",
    "celery",
  ],
};

// File extensions by language
const FILE_EXTENSIONS: Record<string, { ext: string; patterns: string[] }> = {
  TypeScript: { ext: "ts", patterns: ["*.ts", "*.tsx"] },
  JavaScript: { ext: "js", patterns: ["*.js", "*.jsx"] },
  Python: { ext: "py", patterns: ["*.py"] },
  Go: { ext: "go", patterns: ["*.go"] },
  Rust: { ext: "rs", patterns: ["*.rs"] },
  Ruby: { ext: "rb", patterns: ["*.rb"] },
  Java: { ext: "java", patterns: ["*.java"] },
};

// Source directories to check (in order)
const SOURCE_DIRS = ["src", "lib", "app"];

// Directories to exclude from counting
const EXCLUDE_DIRS = [
  "node_modules",
  "dist",
  "build",
  ".git",
  "__pycache__",
  "venv",
  ".venv",
  "target",
];

export interface ProjectInfo {
  name: string;
  license: string | null;
  prodDeps: number;
  devDeps: number;
  allDeps: string[];
}

export interface FileCount {
  count: number;
  extension: string;
}

export interface ProjectData {
  name: string;
  language: string | null;
  license: string | null;
  stack: string[];
  fileCount: number;
  fileExtension: string;
  lineCount: number;
  prodDeps: number;
  devDeps: number;
  error?: string;
}

export function detectLanguage(): string | null {
  for (const { file, language } of LANGUAGE_INDICATORS) {
    if (existsSync(file)) {
      return language;
    }
  }
  return null;
}

function parsePackageJson(content: string): ProjectInfo {
  const pkg = JSON.parse(content);
  const deps = Object.keys(pkg.dependencies || {});
  const devDeps = Object.keys(pkg.devDependencies || {});

  return {
    name: pkg.name || "unknown",
    license: pkg.license || null,
    prodDeps: deps.length,
    devDeps: devDeps.length,
    allDeps: [...deps, ...devDeps],
  };
}

function parsePyprojectToml(content: string): ProjectInfo {
  // Simple TOML parsing for [project] section
  const lines = content.split("\n");
  let name = "unknown";
  let license: string | null = null;
  const deps: string[] = [];
  const devDeps: string[] = [];

  let inProject = false;
  let inDeps = false;
  let inDevDeps = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Track sections
    if (trimmed === "[project]") {
      inProject = true;
      inDeps = false;
      inDevDeps = false;
      continue;
    }
    if (trimmed.startsWith("[") && trimmed !== "[project]") {
      if (trimmed === "[project.optional-dependencies]") {
        inDevDeps = true;
        inDeps = false;
      } else {
        inProject = false;
        inDeps = false;
        inDevDeps = false;
      }
      continue;
    }

    if (inProject) {
      // Parse name
      const nameMatch = trimmed.match(/^name\s*=\s*"([^"]+)"/);
      if (nameMatch) {
        name = nameMatch[1];
      }

      // Parse license
      const licenseMatch = trimmed.match(
        /^license\s*=\s*\{text\s*=\s*"([^"]+)"/,
      );
      if (licenseMatch) {
        license = licenseMatch[1];
      }
      const simpleLicense = trimmed.match(/^license\s*=\s*"([^"]+)"/);
      if (simpleLicense) {
        license = simpleLicense[1];
      }

      // Check for dependencies array start
      if (trimmed.startsWith("dependencies")) {
        inDeps = true;
        // Handle inline array
        const inlineMatch = trimmed.match(/dependencies\s*=\s*\[([^\]]*)\]/);
        if (inlineMatch) {
          const items = inlineMatch[1].match(/"([^"]+)"/g);
          if (items) {
            deps.push(
              ...items.map((s) => s.replace(/"/g, "").split(/[<>=[]/)[0]),
            );
          }
          inDeps = false;
        }
        continue;
      }
    }

    // Parse dependency items
    if (inDeps && trimmed.startsWith('"')) {
      const depMatch = trimmed.match(/"([^"]+)"/);
      if (depMatch) {
        deps.push(depMatch[1].split(/[<>=[]/)[0]);
      }
      if (trimmed.endsWith("]")) {
        inDeps = false;
      }
    }

    // Parse dev dependencies
    if (inDevDeps && trimmed.startsWith('"')) {
      const depMatch = trimmed.match(/"([^"]+)"/);
      if (depMatch) {
        devDeps.push(depMatch[1].split(/[<>=[]/)[0]);
      }
    }
    if (inDevDeps && trimmed.match(/^dev\s*=\s*\[/)) {
      const inlineMatch = trimmed.match(/dev\s*=\s*\[([^\]]*)\]/);
      if (inlineMatch) {
        const items = inlineMatch[1].match(/"([^"]+)"/g);
        if (items) {
          devDeps.push(
            ...items.map((s) => s.replace(/"/g, "").split(/[<>=[]/)[0]),
          );
        }
      }
    }
  }

  return {
    name,
    license,
    prodDeps: deps.length,
    devDeps: devDeps.length,
    allDeps: [...deps, ...devDeps],
  };
}

function parseSetupPy(content: string): ProjectInfo {
  let name = "unknown";
  const deps: string[] = [];

  // Parse name
  const nameMatch = content.match(/name\s*=\s*["']([^"']+)["']/);
  if (nameMatch) {
    name = nameMatch[1];
  }

  // Parse install_requires
  const reqMatch = content.match(/install_requires\s*=\s*\[([^\]]+)\]/s);
  if (reqMatch) {
    const items = reqMatch[1].match(/["']([^"']+)["']/g);
    if (items) {
      deps.push(...items.map((s) => s.replace(/["']/g, "").split(/[<>=[]/)[0]));
    }
  }

  return {
    name,
    license: null,
    prodDeps: deps.length,
    devDeps: 0,
    allDeps: deps,
  };
}

function getFolderName(): string {
  return basename(process.cwd());
}

export function getProjectInfo(): ProjectInfo {
  // Try package.json first
  if (existsSync("package.json")) {
    try {
      const content = readFileSync("package.json", "utf-8");
      return parsePackageJson(content);
    } catch {
      // Fall through
    }
  }

  // Try pyproject.toml
  if (existsSync("pyproject.toml")) {
    try {
      const content = readFileSync("pyproject.toml", "utf-8");
      return parsePyprojectToml(content);
    } catch {
      // Fall through
    }
  }

  // Try setup.py
  if (existsSync("setup.py")) {
    try {
      const content = readFileSync("setup.py", "utf-8");
      return parseSetupPy(content);
    } catch {
      // Fall through
    }
  }

  // Fallback to folder name
  return {
    name: getFolderName(),
    license: null,
    prodDeps: 0,
    devDeps: 0,
    allDeps: [],
  };
}

export function detectStack(deps: string[]): string[] {
  const normalizedDeps = deps.map((d) => d.toLowerCase());
  const frameworks: string[] = [];
  const tools: string[] = [];

  for (const framework of KNOWN_STACK.frameworks) {
    if (normalizedDeps.includes(framework)) {
      frameworks.push(framework);
    }
  }

  for (const tool of KNOWN_STACK.tools) {
    if (normalizedDeps.includes(tool)) {
      tools.push(tool);
    }
  }

  // Frameworks first, then tools, max 5
  return [...frameworks, ...tools].slice(0, 5);
}

function findSourceDir(): string | null {
  for (const dir of SOURCE_DIRS) {
    if (existsSync(dir)) {
      return dir;
    }
  }
  return null;
}

/**
 * Convert glob pattern to regex (e.g., "*.ts" -> /\.ts$/)
 */
function globToRegex(pattern: string): RegExp {
  // Extract extension from pattern like "*.ts" or "*.tsx"
  const ext = pattern.replace("*", "").replace(".", "\\.");
  return new RegExp(`${ext}$`, "i");
}

/**
 * Recursively find all files matching patterns, excluding certain directories
 * Cross-platform implementation using Node.js fs module
 */
function findFiles(
  dir: string,
  patterns: RegExp[],
  excludeDirs: string[],
): string[] {
  const files: string[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip excluded directories
        if (!excludeDirs.includes(entry.name)) {
          files.push(...findFiles(fullPath, patterns, excludeDirs));
        }
      } else if (entry.isFile()) {
        // Check if file matches any pattern
        if (patterns.some((regex) => regex.test(entry.name))) {
          files.push(fullPath);
        }
      }
    }
  } catch {
    // Ignore errors (permission denied, etc.)
  }

  return files;
}

export function countFiles(language: string | null): FileCount {
  const sourceDir = findSourceDir();
  if (!sourceDir || !language) {
    return { count: 0, extension: "" };
  }

  const config = FILE_EXTENSIONS[language];
  if (!config) {
    return { count: 0, extension: "" };
  }

  try {
    const patterns = config.patterns.map(globToRegex);
    const files = findFiles(sourceDir, patterns, EXCLUDE_DIRS);
    return { count: files.length, extension: config.ext };
  } catch {
    return { count: 0, extension: config.ext };
  }
}

export function countLines(language: string | null): number {
  const sourceDir = findSourceDir();
  if (!sourceDir || !language) {
    return 0;
  }

  const config = FILE_EXTENSIONS[language];
  if (!config) {
    return 0;
  }

  try {
    const patterns = config.patterns.map(globToRegex);
    const files = findFiles(sourceDir, patterns, EXCLUDE_DIRS);

    let totalLines = 0;
    for (const file of files) {
      try {
        const content = readFileSync(file, "utf-8");
        // Count newlines (add 1 for last line if file doesn't end with newline)
        const lines = content.split("\n").length;
        totalLines += lines;
      } catch {
        // Skip files that can't be read
      }
    }

    return totalLines;
  } catch {
    return 0;
  }
}

export function getProjectData(): ProjectData {
  try {
    const language = detectLanguage();
    const projectInfo = getProjectInfo();
    const stack = detectStack(projectInfo.allDeps);
    const fileCount = countFiles(language);
    const lineCount = countLines(language);

    return {
      name: projectInfo.name,
      language,
      license: projectInfo.license,
      stack,
      fileCount: fileCount.count,
      fileExtension: fileCount.extension,
      lineCount,
      prodDeps: projectInfo.prodDeps,
      devDeps: projectInfo.devDeps,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: getFolderName(),
      language: null,
      license: null,
      stack: [],
      fileCount: 0,
      fileExtension: "",
      lineCount: 0,
      prodDeps: 0,
      devDeps: 0,
      error: message,
    };
  }
}
