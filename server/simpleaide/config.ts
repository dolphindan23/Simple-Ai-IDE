import * as fs from "fs";
import * as path from "path";

export interface ProjectConfig {
  immutablePaths: string[];
  runPolicy: {
    allowedCommands: string[];
    blockedCommands: string[];
    maxConcurrentRuns: number;
    autoApply: boolean;
  };
}

const DEFAULT_IMMUTABLE_PATHS = [
  ".git",
  ".simpleaide/settings.json",
  "node_modules",
  ".env",
  ".env.local",
  ".env.production"
];

const DEFAULT_RUN_POLICY = {
  allowedCommands: ["npm test", "npm run build", "npm run lint", "npx tsc --noEmit"],
  blockedCommands: ["rm -rf", "sudo", "chmod", "chown"],
  maxConcurrentRuns: 1,
  autoApply: false
};

export function loadProjectConfig(projectPath: string): ProjectConfig {
  const configDir = path.join(projectPath, ".simpleaide");
  
  let immutablePaths = DEFAULT_IMMUTABLE_PATHS;
  const immutableFile = path.join(configDir, "immutable.json");
  if (fs.existsSync(immutableFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(immutableFile, "utf-8"));
      if (Array.isArray(data.paths)) {
        immutablePaths = data.paths;
      }
    } catch {}
  }

  let runPolicy = DEFAULT_RUN_POLICY;
  const policyFile = path.join(configDir, "runpolicy.json");
  if (fs.existsSync(policyFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(policyFile, "utf-8"));
      runPolicy = { ...DEFAULT_RUN_POLICY, ...data };
    } catch {}
  }

  return { immutablePaths, runPolicy };
}

export async function initDefaultConfigs(projectPath: string): Promise<void> {
  const configDir = path.join(projectPath, ".simpleaide");
  
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const immutableFile = path.join(configDir, "immutable.json");
  if (!fs.existsSync(immutableFile)) {
    fs.writeFileSync(immutableFile, JSON.stringify({ paths: DEFAULT_IMMUTABLE_PATHS }, null, 2));
  }

  const policyFile = path.join(configDir, "runpolicy.json");
  if (!fs.existsSync(policyFile)) {
    fs.writeFileSync(policyFile, JSON.stringify(DEFAULT_RUN_POLICY, null, 2));
  }
}

export function isPathImmutable(filePath: string, immutablePaths: string[]): boolean {
  const normalizedPath = path.normalize(filePath);
  
  for (const immutablePath of immutablePaths) {
    const normalizedImmutable = path.normalize(immutablePath);
    if (normalizedPath === normalizedImmutable || normalizedPath.startsWith(normalizedImmutable + path.sep)) {
      return true;
    }
  }
  
  return false;
}
