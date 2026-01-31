import path from "path";
import fs from "fs";

const projectRoot = path.resolve(process.cwd());

export const DATA_DIR =
  process.env.SIMPLEAIDE_DATA_DIR
    ? path.resolve(process.env.SIMPLEAIDE_DATA_DIR)
    : path.join(projectRoot, ".simpleaide");

export const PROJECTS_DIR =
  process.env.SIMPLEAIDE_PROJECTS_DIR
    ? path.resolve(process.env.SIMPLEAIDE_PROJECTS_DIR)
    : path.join(projectRoot, "projects");

export const PROJECT_ROOT = projectRoot;

export function ensureDataDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

export function getSettingsDir(): string {
  return DATA_DIR;
}

export function getSettingsFile(): string {
  return path.join(DATA_DIR, "settings.json");
}

export function getActiveProjectFile(): string {
  return path.join(DATA_DIR, "active-project.json");
}

export function getSecretsFile(): string {
  return path.join(DATA_DIR, "secrets.enc");
}

export function getCapsulesDbPath(): string {
  return path.join(DATA_DIR, "capsules.db");
}

export function getAgentProfilesDbPath(): string {
  return path.join(DATA_DIR, "agent-profiles.db");
}
