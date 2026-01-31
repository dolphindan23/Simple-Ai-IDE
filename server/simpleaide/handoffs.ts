import * as fs from "fs";
import * as path from "path";
import { nanoid } from "nanoid";

export type HandoffType = "task" | "patch" | "decision" | "question" | "link" | "artifact" | "api_change" | "blocker" | "fyi";
export type HandoffStatus = "unread" | "acknowledged" | "done";

export interface TaskPayload {
  title: string;
  acceptance?: string[];
  filesHint?: string[];
  priority?: "low" | "medium" | "high";
}

export interface PatchPayload {
  summary: string;
  diff?: string;
  applyHint?: string;
  commitSha?: string;
}

export interface DecisionPayload {
  question: string;
  options: string[];
  recommendation?: string;
}

export interface QuestionPayload {
  question: string;
  context?: string;
}

export interface LinkPayload {
  url: string;
  title?: string;
  description?: string;
}

export interface ArtifactPayload {
  name: string;
  type: string;
  path?: string;
  data?: any;
}

export interface ApiChangePayload {
  endpoints?: string[];
  fields?: string[];
  breaking?: boolean;
  migrationNotes?: string;
}

export type HandoffPayload = TaskPayload | PatchPayload | DecisionPayload | QuestionPayload | LinkPayload | ArtifactPayload | ApiChangePayload | Record<string, any>;

export interface Handoff {
  id: string;
  fromWorkspaceId: string;
  toWorkspaceId: string;
  fromAgentKey?: string;
  toAgentKey?: string;
  type: HandoffType;
  title: string;
  body?: string;
  payload: HandoffPayload;
  status: HandoffStatus;
  createdAt: string;
  acknowledgedAt?: string;
  doneAt?: string;
}

export interface HandoffRegistry {
  version: number;
  handoffs: Handoff[];
}

export interface CreateHandoffOptions {
  fromWorkspaceId: string;
  toWorkspaceId: string;
  fromAgentKey?: string;
  toAgentKey?: string;
  type: HandoffType;
  title: string;
  body?: string;
  payload?: HandoffPayload;
}

const PROJECTS_DIR = path.resolve(process.cwd(), "projects");

function getHandoffsPath(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, ".simpleaide", "handoffs.json");
}

function ensureHandoffsDir(projectId: string): void {
  const dir = path.join(PROJECTS_DIR, projectId, ".simpleaide");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadHandoffRegistry(projectId: string): HandoffRegistry {
  const handoffsPath = getHandoffsPath(projectId);
  
  if (fs.existsSync(handoffsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(handoffsPath, "utf-8"));
      return data as HandoffRegistry;
    } catch (e) {
      console.error(`[handoffs] Failed to load handoffs for ${projectId}:`, e);
    }
  }
  
  return {
    version: 1,
    handoffs: [],
  };
}

export function saveHandoffRegistry(projectId: string, registry: HandoffRegistry): void {
  ensureHandoffsDir(projectId);
  const handoffsPath = getHandoffsPath(projectId);
  fs.writeFileSync(handoffsPath, JSON.stringify(registry, null, 2));
}

export function createHandoff(projectId: string, options: CreateHandoffOptions): Handoff {
  const handoff: Handoff = {
    id: `hnd_${nanoid(10)}`,
    fromWorkspaceId: options.fromWorkspaceId,
    toWorkspaceId: options.toWorkspaceId,
    fromAgentKey: options.fromAgentKey,
    toAgentKey: options.toAgentKey,
    type: options.type,
    title: options.title,
    body: options.body,
    payload: options.payload || {},
    status: "unread",
    createdAt: new Date().toISOString(),
  };
  
  const registry = loadHandoffRegistry(projectId);
  registry.handoffs.push(handoff);
  saveHandoffRegistry(projectId, registry);
  
  return handoff;
}

export function getHandoff(projectId: string, handoffId: string): Handoff | null {
  const registry = loadHandoffRegistry(projectId);
  return registry.handoffs.find(h => h.id === handoffId) || null;
}

export interface ListHandoffsOptions {
  workspaceId?: string;
  status?: HandoffStatus;
  type?: HandoffType;
  limit?: number;
}

export function listHandoffs(projectId: string, options: ListHandoffsOptions = {}): Handoff[] {
  const registry = loadHandoffRegistry(projectId);
  let handoffs = [...registry.handoffs];
  
  if (options.workspaceId) {
    handoffs = handoffs.filter(h => h.toWorkspaceId === options.workspaceId || h.fromWorkspaceId === options.workspaceId);
  }
  
  if (options.status) {
    handoffs = handoffs.filter(h => h.status === options.status);
  }
  
  if (options.type) {
    handoffs = handoffs.filter(h => h.type === options.type);
  }
  
  handoffs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  
  if (options.limit) {
    handoffs = handoffs.slice(0, options.limit);
  }
  
  return handoffs;
}

export function getInboxHandoffs(projectId: string, workspaceId: string, status?: HandoffStatus): Handoff[] {
  const registry = loadHandoffRegistry(projectId);
  let handoffs = registry.handoffs.filter(h => h.toWorkspaceId === workspaceId);
  
  if (status) {
    handoffs = handoffs.filter(h => h.status === status);
  }
  
  return handoffs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getUnreadCount(projectId: string, workspaceId: string): number {
  const registry = loadHandoffRegistry(projectId);
  return registry.handoffs.filter(h => h.toWorkspaceId === workspaceId && h.status === "unread").length;
}

export function acknowledgeHandoff(projectId: string, handoffId: string): Handoff | null {
  const registry = loadHandoffRegistry(projectId);
  const index = registry.handoffs.findIndex(h => h.id === handoffId);
  
  if (index === -1) return null;
  
  registry.handoffs[index].status = "acknowledged";
  registry.handoffs[index].acknowledgedAt = new Date().toISOString();
  
  saveHandoffRegistry(projectId, registry);
  return registry.handoffs[index];
}

export function markHandoffDone(projectId: string, handoffId: string): Handoff | null {
  const registry = loadHandoffRegistry(projectId);
  const index = registry.handoffs.findIndex(h => h.id === handoffId);
  
  if (index === -1) return null;
  
  registry.handoffs[index].status = "done";
  registry.handoffs[index].doneAt = new Date().toISOString();
  
  saveHandoffRegistry(projectId, registry);
  return registry.handoffs[index];
}

export function deleteHandoff(projectId: string, handoffId: string): boolean {
  const registry = loadHandoffRegistry(projectId);
  const index = registry.handoffs.findIndex(h => h.id === handoffId);
  
  if (index === -1) return false;
  
  registry.handoffs.splice(index, 1);
  saveHandoffRegistry(projectId, registry);
  return true;
}
