import fs from "node:fs";
import path from "node:path";

export type ProjectType = "node" | "python" | "mixed" | "unknown";
export type NodePM = "npm" | "pnpm" | "yarn";

export interface ProjectInfo {
  type: ProjectType;
  nodePackageManager?: NodePM;
  hasPackageJson: boolean;
  hasPyProject: boolean;
  hasRequirements: boolean;
  nodeTestCommand: string | null;
  pythonTestCommand: string | null;
}

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function readJson(repoPath: string, rel: string): any | null {
  try {
    const p = path.join(repoPath, rel);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function detectProject(repoPath: string): ProjectInfo {
  const pkg = path.join(repoPath, "package.json");
  const pyproject = path.join(repoPath, "pyproject.toml");
  const requirements = path.join(repoPath, "requirements.txt");
  const pipfile = path.join(repoPath, "Pipfile");
  const poetryLock = path.join(repoPath, "poetry.lock");

  const hasPackageJson = exists(pkg);
  const hasPyProject = exists(pyproject);
  const hasRequirements = exists(requirements) || exists(pipfile) || exists(poetryLock);

  const hasPython = hasPyProject || hasRequirements;
  const hasNode = hasPackageJson;

  let type: ProjectType = "unknown";
  if (hasNode && hasPython) type = "mixed";
  else if (hasNode) type = "node";
  else if (hasPython) type = "python";

  let nodePackageManager: NodePM | undefined;
  let nodeTestCommand: string | null = null;
  
  if (hasPackageJson) {
    const hasPnpm = exists(path.join(repoPath, "pnpm-lock.yaml"));
    const hasYarn = exists(path.join(repoPath, "yarn.lock"));
    nodePackageManager = hasPnpm ? "pnpm" : hasYarn ? "yarn" : "npm";
    
    const pkgData = readJson(repoPath, "package.json");
    const testScript = pkgData?.scripts?.test;
    if (typeof testScript === "string" && testScript.trim().length > 0 && !testScript.includes("no test specified")) {
      nodeTestCommand = nodePackageManager === "npm" ? "npm test" : 
                        nodePackageManager === "pnpm" ? "pnpm test" : "yarn test";
    }
  }

  let pythonTestCommand: string | null = null;
  if (hasPython) {
    pythonTestCommand = "python3 -m pytest -q";
  }

  return {
    type,
    nodePackageManager,
    hasPackageJson,
    hasPyProject,
    hasRequirements,
    nodeTestCommand,
    pythonTestCommand,
  };
}

export function hasPython3Available(): boolean {
  try {
    const { execSync } = require("child_process");
    execSync("command -v python3", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function looksNonCode(goal: string): boolean {
  const g = (goal || "").toLowerCase().trim();
  if (!g) return false;
  
  // Code hints take priority - if any of these are present, it's a code task
  const codeHints = [
    "fix",
    "bug",
    "compile",
    "build error",
    "typescript",
    "refactor",
    "endpoint",
    "routes.ts",
    "patch",
    "diff",
    "unit test",
    "integration test",
    "ci",
    "dockerfile",
    "kubernetes",
    "component",
    "function",
    "class",
    "api",
    "server",
    "client",
    "frontend",
    "backend",
    "database",
    "model",
    "schema",
    "route",
    "controller",
    "service",
    "module",
    ".ts",
    ".js",
    ".py",
    ".tsx",
    ".jsx",
    ".css",
    ".html",
    "import",
    "export",
    "variable",
    "method",
    "interface",
    "type ",
    "add a ",
    "implement",
    "feature",
    "button",
    "form",
    "page",
    "modal",
    "dialog",
    "input",
    "table",
    "layout",
    "style",
    "code",
    "script",
    "file",
    "folder",
    "directory",
  ];
  
  // Check for code hints first - if any found, it's definitely code
  const hasCode = codeHints.some((k) => g.includes(k));
  if (hasCode) return false;
  
  // Explicit non-code content patterns - only match if very clearly content-only
  const explicitNonCodePatterns = [
    /^(can you |please )?(create|generate|write|list|give me) \d+ (math|trivia|quiz|test) questions/i,
    /^(summarize|explain|describe|translate|rewrite|paraphrase)/i,
    /^brainstorm/i,
    /^(create|generate|write) (a )?(marketing|sales|blog|article|essay|email|letter|story)/i,
    /^(create|generate|write) flashcards/i,
    /^(create|generate|write) (a )?poem/i,
    /^(create|generate|write) (a )?recipe/i,
    /^what (is|are|does|do)/i,
    /^how (does|do|to|can)/i,
    /^why (is|are|does|do)/i,
    /^tell me about/i,
  ];
  
  return explicitNonCodePatterns.some((pattern) => pattern.test(g));
}
