import * as fs from "fs";
import * as path from "path";

export interface StackDetection {
  packageManager: "npm" | "yarn" | "pnpm" | "pip" | "poetry" | "go" | "cargo" | "unknown";
  language: "javascript" | "typescript" | "python" | "go" | "rust" | "unknown";
  framework?: string;
  installCommand?: string;
  devCommand?: string;
  buildCommand?: string;
  testCommand?: string;
}

export function detectStack(projectPath: string): StackDetection {
  const files = new Set<string>();
  try {
    const entries = fs.readdirSync(projectPath);
    entries.forEach(e => files.add(e));
  } catch {
    return { packageManager: "unknown", language: "unknown" };
  }
  
  if (files.has("pnpm-lock.yaml")) {
    return detectNodeProject(projectPath, "pnpm");
  }
  if (files.has("yarn.lock")) {
    return detectNodeProject(projectPath, "yarn");
  }
  if (files.has("package-lock.json") || files.has("package.json")) {
    return detectNodeProject(projectPath, "npm");
  }
  
  if (files.has("pyproject.toml")) {
    const pyproject = fs.readFileSync(path.join(projectPath, "pyproject.toml"), "utf-8");
    if (pyproject.includes("[tool.poetry]")) {
      return detectPythonProject(projectPath, "poetry");
    }
    return detectPythonProject(projectPath, "pip");
  }
  if (files.has("requirements.txt") || files.has("setup.py")) {
    return detectPythonProject(projectPath, "pip");
  }
  
  if (files.has("go.mod")) {
    return {
      packageManager: "go",
      language: "go",
      installCommand: "go mod download",
      devCommand: "go run .",
      buildCommand: "go build",
      testCommand: "go test ./...",
    };
  }
  
  if (files.has("Cargo.toml")) {
    return {
      packageManager: "cargo",
      language: "rust",
      installCommand: "cargo fetch",
      devCommand: "cargo run",
      buildCommand: "cargo build --release",
      testCommand: "cargo test",
    };
  }
  
  return { packageManager: "unknown", language: "unknown" };
}

function detectNodeProject(projectPath: string, pm: "npm" | "yarn" | "pnpm"): StackDetection {
  const result: StackDetection = {
    packageManager: pm,
    language: "javascript",
    installCommand: `${pm} install`,
  };
  
  const pkgPath = path.join(projectPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      
      if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
        result.language = "typescript";
      }
      
      if (pkg.dependencies?.next) result.framework = "next";
      else if (pkg.dependencies?.express) result.framework = "express";
      else if (pkg.dependencies?.fastify) result.framework = "fastify";
      else if (pkg.dependencies?.react) result.framework = "react";
      else if (pkg.dependencies?.vue) result.framework = "vue";
      
      if (pkg.scripts?.dev) {
        result.devCommand = pm === "npm" ? "npm run dev" : `${pm} dev`;
      } else if (pkg.scripts?.start) {
        result.devCommand = pm === "npm" ? "npm start" : `${pm} start`;
      }
      
      if (pkg.scripts?.build) {
        result.buildCommand = pm === "npm" ? "npm run build" : `${pm} build`;
      }
      
      if (pkg.scripts?.test) {
        result.testCommand = pm === "npm" ? "npm test" : `${pm} test`;
      }
    } catch {}
  }
  
  return result;
}

function detectPythonProject(projectPath: string, pm: "pip" | "poetry"): StackDetection {
  const result: StackDetection = {
    packageManager: pm,
    language: "python",
  };
  
  if (pm === "poetry") {
    result.installCommand = "poetry install";
    result.devCommand = "poetry run python -m uvicorn src.main:app --reload";
  } else {
    result.installCommand = "pip install -r requirements.txt";
    result.devCommand = "python -m uvicorn src.main:app --reload";
  }
  
  const files = fs.readdirSync(projectPath);
  if (files.some(f => f.includes("fastapi") || f === "main.py")) {
    result.framework = "fastapi";
  } else if (files.some(f => f.includes("django"))) {
    result.framework = "django";
    result.devCommand = pm === "poetry" ? "poetry run python manage.py runserver" : "python manage.py runserver";
  } else if (files.some(f => f.includes("flask"))) {
    result.framework = "flask";
    result.devCommand = pm === "poetry" ? "poetry run flask run" : "flask run";
  }
  
  result.testCommand = pm === "poetry" ? "poetry run pytest" : "pytest";
  
  return result;
}

export function createProjectMd(projectPath: string, stack: StackDetection): void {
  const content = `# Project Configuration

## Stack Detection
- **Language**: ${stack.language}
- **Package Manager**: ${stack.packageManager}
${stack.framework ? `- **Framework**: ${stack.framework}` : ""}

## Commands
${stack.installCommand ? `- **Install**: \`${stack.installCommand}\`` : ""}
${stack.devCommand ? `- **Dev**: \`${stack.devCommand}\`` : ""}
${stack.buildCommand ? `- **Build**: \`${stack.buildCommand}\`` : ""}
${stack.testCommand ? `- **Test**: \`${stack.testCommand}\`` : ""}

## Notes
This file was auto-generated when the project was imported. Update it as needed.
`;

  const simpleaidePath = path.join(projectPath, ".simpleaide");
  if (!fs.existsSync(simpleaidePath)) {
    fs.mkdirSync(simpleaidePath, { recursive: true });
  }
  
  fs.writeFileSync(path.join(simpleaidePath, "project.md"), content);
}

export function createRunPolicy(projectPath: string, stack: StackDetection): void {
  const allowedCommands: string[] = ["git", "ls", "cat", "head", "tail", "grep", "find"];
  
  if (stack.packageManager === "npm" || stack.packageManager === "yarn" || stack.packageManager === "pnpm") {
    allowedCommands.push("node", "npm", "npx", "yarn", "pnpm");
  }
  if (stack.language === "python") {
    allowedCommands.push("python", "python3", "pip", "poetry", "pytest", "uvicorn");
  }
  if (stack.language === "go") {
    allowedCommands.push("go");
  }
  if (stack.language === "rust") {
    allowedCommands.push("cargo", "rustc");
  }
  
  const policy = {
    version: 1,
    allowedCommands,
    deniedPatterns: [
      "rm -rf /",
      "sudo",
      "chmod 777",
      "> /dev/",
      "curl | sh",
      "wget | sh",
    ],
    networkPolicy: "deny",
    maxExecutionTimeMs: 300000,
  };
  
  const simpleaidePath = path.join(projectPath, ".simpleaide");
  if (!fs.existsSync(simpleaidePath)) {
    fs.mkdirSync(simpleaidePath, { recursive: true });
  }
  
  fs.writeFileSync(path.join(simpleaidePath, "runpolicy.json"), JSON.stringify(policy, null, 2));
}

export function createImmutablePaths(projectPath: string): void {
  const immutable = {
    version: 1,
    paths: [
      ".env",
      ".env.*",
      "**/*.pem",
      "**/*.key",
      ".git/**",
      ".simpleaide/runpolicy.json",
      ".simpleaide/immutable.json",
    ],
  };
  
  const simpleaidePath = path.join(projectPath, ".simpleaide");
  if (!fs.existsSync(simpleaidePath)) {
    fs.mkdirSync(simpleaidePath, { recursive: true });
  }
  
  fs.writeFileSync(path.join(simpleaidePath, "immutable.json"), JSON.stringify(immutable, null, 2));
}

export function createCapabilities(projectPath: string, stack: StackDetection): void {
  const capabilities = {
    schemaVersion: 1,
    templatesApplied: [],
    integrations: {},
    services: {},
    notes: {
      detectedStack: `${stack.language}/${stack.framework || "unknown"}`,
      packageManager: stack.packageManager,
    },
  };
  
  const simpleaidePath = path.join(projectPath, ".simpleaide");
  if (!fs.existsSync(simpleaidePath)) {
    fs.mkdirSync(simpleaidePath, { recursive: true });
  }
  
  const capPath = path.join(simpleaidePath, "capabilities.json");
  if (!fs.existsSync(capPath)) {
    fs.writeFileSync(capPath, JSON.stringify(capabilities, null, 2));
  }
}

export function bootstrapProject(projectPath: string): StackDetection {
  const stack = detectStack(projectPath);
  
  createProjectMd(projectPath, stack);
  createRunPolicy(projectPath, stack);
  createImmutablePaths(projectPath);
  createCapabilities(projectPath, stack);
  
  return stack;
}
