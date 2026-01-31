import * as fs from "fs";
import * as path from "path";
import { nanoid } from "nanoid";

export type WorkspaceKind = "web" | "mobile" | "backend" | "generic";

export interface Workspace {
  id: string;
  name: string;
  projectId: string;
  kind: WorkspaceKind;
  rootPath: string;
  baseBranch: string;
  branch: string;
  createdAt: string;
  status: "active" | "archived";
}

export interface WorkspaceRegistry {
  version: number;
  projectId: string;
  workspaces: Workspace[];
}

export interface CreateWorkspaceOptions {
  name: string;
  projectId: string;
  kind: WorkspaceKind;
  baseBranch?: string;
  branch?: string;
  rootPath?: string;
}

const PROJECTS_DIR = path.resolve(process.cwd(), "projects");

function getRegistryPath(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, ".simpleaide", "workspaces.json");
}

function ensureRegistryDir(projectId: string): void {
  const dir = path.join(PROJECTS_DIR, projectId, ".simpleaide");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadWorkspaceRegistry(projectId: string): WorkspaceRegistry {
  const registryPath = getRegistryPath(projectId);
  
  if (fs.existsSync(registryPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
      return data as WorkspaceRegistry;
    } catch (e) {
      console.error(`[workspaces] Failed to load registry for ${projectId}:`, e);
    }
  }
  
  return {
    version: 1,
    projectId,
    workspaces: [],
  };
}

export function saveWorkspaceRegistry(projectId: string, registry: WorkspaceRegistry): void {
  ensureRegistryDir(projectId);
  const registryPath = getRegistryPath(projectId);
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}

export function listWorkspaces(projectId: string): Workspace[] {
  const registry = loadWorkspaceRegistry(projectId);
  return registry.workspaces.filter(ws => ws.status === "active");
}

export function getWorkspace(projectId: string, workspaceId: string): Workspace | null {
  const registry = loadWorkspaceRegistry(projectId);
  return registry.workspaces.find(ws => ws.id === workspaceId) || null;
}

export function createWorkspace(options: CreateWorkspaceOptions): Workspace {
  const { name, projectId, kind, baseBranch = "main", branch } = options;
  
  const workspaceId = `ws_${nanoid(8)}`;
  const workspaceBranch = branch || `ws/${workspaceId}`;
  const worktreePath = path.join(PROJECTS_DIR, projectId, ".worktrees", workspaceId);
  
  const workspace: Workspace = {
    id: workspaceId,
    name,
    projectId,
    kind,
    rootPath: worktreePath,
    baseBranch,
    branch: workspaceBranch,
    createdAt: new Date().toISOString(),
    status: "active",
  };
  
  const registry = loadWorkspaceRegistry(projectId);
  registry.workspaces.push(workspace);
  saveWorkspaceRegistry(projectId, registry);
  
  return workspace;
}

export function updateWorkspace(projectId: string, workspaceId: string, updates: Partial<Workspace>): Workspace | null {
  const registry = loadWorkspaceRegistry(projectId);
  const index = registry.workspaces.findIndex(ws => ws.id === workspaceId);
  
  if (index === -1) return null;
  
  registry.workspaces[index] = {
    ...registry.workspaces[index],
    ...updates,
  };
  
  saveWorkspaceRegistry(projectId, registry);
  return registry.workspaces[index];
}

export function archiveWorkspace(projectId: string, workspaceId: string): boolean {
  const result = updateWorkspace(projectId, workspaceId, { status: "archived" });
  return result !== null;
}

export function deleteWorkspace(projectId: string, workspaceId: string): boolean {
  const registry = loadWorkspaceRegistry(projectId);
  const index = registry.workspaces.findIndex(ws => ws.id === workspaceId);
  
  if (index === -1) return false;
  
  registry.workspaces.splice(index, 1);
  saveWorkspaceRegistry(projectId, registry);
  return true;
}

export function getWorkspaceRoot(projectId: string, workspaceId: string): string | null {
  const workspace = getWorkspace(projectId, workspaceId);
  if (!workspace) return null;
  return workspace.rootPath;
}

export function getDefaultWorkspace(projectId: string): Workspace | null {
  const workspaces = listWorkspaces(projectId);
  return workspaces.length > 0 ? workspaces[0] : null;
}

export function createMainWorkspace(projectId: string, projectPath: string): Workspace {
  const workspace: Workspace = {
    id: "main",
    name: "Main",
    projectId,
    kind: "generic",
    rootPath: projectPath,
    baseBranch: "main",
    branch: "main",
    createdAt: new Date().toISOString(),
    status: "active",
  };
  
  const registry = loadWorkspaceRegistry(projectId);
  const existing = registry.workspaces.find(ws => ws.id === "main");
  if (!existing) {
    registry.workspaces.push(workspace);
    saveWorkspaceRegistry(projectId, registry);
  }
  
  return workspace;
}
