import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { runTask, applyTaskDiff, checkGitAvailable, getDefaultTrustSettings, type ApplyDiffOptions, type ApplyDiffResult } from "./taskRunner";
import { createTaskSchema, settingsSchema, defaultSettings, type Settings, createRunSchema, executeStepSchema, rerunSchema, createProjectSchema, projectSchema, type Project, activeProjectSchema } from "@shared/schema";
import * as fs from "fs";
import * as path from "path";
import { vaultExists, createVault, unlockVault, saveVault, setSecret, deleteSecret, listSecretKeys, maskSecret, deleteVault } from "./secrets";
import { runsStorage } from "./runs";
import { runAutoWorkflow, applyDiffWithBackup, revertDiff, isWorkflowRunning } from "./autoRunner";
import * as db from "./database";
import { setupShellWebSocket, getActiveSessions as getActiveShellSessions } from "./shell";
import * as aiDb from "./aiDb";
import { subscribeToRun, subscribeToAllRuns, emitRunStatus, emitAgentStatus, emitStep } from "./aiEvents";
import { randomUUID } from "crypto";
import { nanoid } from "nanoid";
import { loadProjectConfig, initDefaultConfigs } from "./simpleaide/config";
import { 
  getCapsulesDb, 
  createAgentRun, 
  getAgentRun, 
  listAgentRuns, 
  updateAgentRun,
  listToolAuditLog,
  searchChunks
} from "./simpleaide/db";
import { capsuleProvider } from "./simpleaide/capsule";
import { 
  createStashCheckpoint, 
  rollbackToCheckpoint, 
  applyPatchFile, 
  createApprovalToken, 
  validateApprovalToken,
  clearApprovalToken
} from "./simpleaide/git";
import { buildIndex, getIndexMeta, searchLexical, incrementalUpdate } from "./simpleaide/indexer";
import { listTemplates, loadTemplate, validateTemplate } from "./simpleaide/templates/engine";
import { applyTemplateInCapsule } from "./simpleaide/templates/apply";
import { readCapabilities } from "./simpleaide/capabilities";
import { templateToolDefinitions, dispatchTemplateTool } from "./simpleaide/tools";
import { cloneRepository, pullRepository, getGitOpStatus, getGitOpLogTail } from "./simpleaide/git/gitWorker";
import { bootstrapProject } from "./simpleaide/git/bootstrap";
import { validateRemoteUrl } from "./simpleaide/git/gitUrl";
import { listGitOps, getProjectRemote, getGitOp } from "./simpleaide/db";

const PROJECT_ROOT = path.resolve(process.cwd());
const SETTINGS_DIR = path.join(PROJECT_ROOT, ".simpleaide");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");
const PROJECTS_DIR = path.join(PROJECT_ROOT, "projects");
const ACTIVE_PROJECT_FILE = path.join(SETTINGS_DIR, "active-project.json");

const backendHealthCache = new Map<string, { online: boolean; lastChecked: number; error?: string }>();
const HEALTH_CACHE_TTL_MS = 60 * 1000;

async function checkBackendHealth(backendUrl: string): Promise<{ online: boolean; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${backendUrl}/api/tags`, {
      method: "GET",
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    return { online: response.ok };
  } catch (error: any) {
    return { online: false, error: error.message || "Connection failed" };
  }
}

async function getBackendHealthStatus(backendId: string, backendUrl: string, forceRefresh: boolean = false): Promise<{ online: boolean; error?: string }> {
  const cached = backendHealthCache.get(backendId);
  const now = Date.now();
  
  if (!forceRefresh && cached && (now - cached.lastChecked) < HEALTH_CACHE_TTL_MS) {
    return { online: cached.online, error: cached.error };
  }
  
  const result = await checkBackendHealth(backendUrl);
  backendHealthCache.set(backendId, { 
    online: result.online, 
    lastChecked: now, 
    error: result.error 
  });
  
  return result;
}

function isPathSafe(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(PROJECT_ROOT, resolved);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function getFileTree(dirPath: string, basePath: string = ""): any[] {
  const items: any[] = [];
  
  // Security check
  if (!isPathSafe(dirPath)) {
    return items;
  }
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      // Skip hidden files, node_modules, and other common excludes
      if (entry.name.startsWith(".") || 
          entry.name === "node_modules" || 
          entry.name === "__pycache__" ||
          entry.name === ".git" ||
          entry.name === "dist" ||
          entry.name === "build") {
        continue;
      }
      
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.join(basePath, entry.name);
      
      // Security check for each path
      if (!isPathSafe(fullPath)) {
        continue;
      }
      
      if (entry.isDirectory()) {
        items.push({
          name: entry.name,
          path: relativePath,
          type: "directory",
          children: getFileTree(fullPath, relativePath),
        });
      } else {
        items.push({
          name: entry.name,
          path: relativePath,
          type: "file",
        });
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
  }
  
  // Sort: directories first, then files, alphabetically
  items.sort((a, b) => {
    if (a.type === b.type) return a.name.localeCompare(b.name);
    return a.type === "directory" ? -1 : 1;
  });
  
  return items;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Helper to read settings (defined early for use in all routes)
  function readSettings(): Settings {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
        const parsed = JSON.parse(data);
        return settingsSchema.parse(parsed);
      }
    } catch (error) {
      console.error("Error reading settings:", error);
    }
    return defaultSettings;
  }

  // Helper to write settings
  function writeSettings(settings: Settings): void {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  }

  // Setup shell WebSocket
  setupShellWebSocket(httpServer);

  // ==================== Project Management Routes ====================

  // Helper to get active project path
  function getActiveProjectPath(): string | null {
    try {
      if (fs.existsSync(ACTIVE_PROJECT_FILE)) {
        const data = JSON.parse(fs.readFileSync(ACTIVE_PROJECT_FILE, "utf-8"));
        const parsed = activeProjectSchema.safeParse(data);
        if (parsed.success) {
          const projectPath = path.join(PROJECTS_DIR, parsed.data.projectId);
          if (fs.existsSync(projectPath)) {
            return projectPath;
          }
        }
      }
    } catch (error) {
      console.error("Error reading active project:", error);
    }
    return null;
  }

  // Helper to get project metadata
  function getProjectMetadata(projectId: string): Project | null {
    const projectPath = path.join(PROJECTS_DIR, projectId);
    const metaPath = path.join(projectPath, ".simpleaide", "project.json");
    try {
      if (fs.existsSync(metaPath)) {
        const data = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        return projectSchema.parse(data);
      }
    } catch (error) {
      console.error("Error reading project metadata:", error);
    }
    return null;
  }

  // Helper to save project metadata
  function saveProjectMetadata(project: Project): void {
    const projectPath = path.join(PROJECTS_DIR, project.id);
    const metaDir = path.join(projectPath, ".simpleaide");
    const metaPath = path.join(metaDir, "project.json");
    if (!fs.existsSync(metaDir)) {
      fs.mkdirSync(metaDir, { recursive: true });
    }
    fs.writeFileSync(metaPath, JSON.stringify(project, null, 2));
  }

  // ==================== Health Check ====================
  // Lightweight health endpoint for Docker/orchestration health checks
  // Returns quickly without DB or external service calls
  app.get("/health", (req: Request, res: Response) => {
    res.status(200).json({ status: "ok", timestamp: Date.now() });
  });

  // List all projects
  app.get("/api/projects", (req: Request, res: Response) => {
    try {
      if (!fs.existsSync(PROJECTS_DIR)) {
        return res.json({ projects: [], activeProjectId: null });
      }
      
      const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
      const projects: Project[] = [];
      
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith(".")) {
          const meta = getProjectMetadata(entry.name);
          if (meta) {
            projects.push(meta);
          } else {
            // Create metadata for legacy projects
            const projectPath = path.join(PROJECTS_DIR, entry.name);
            const stat = fs.statSync(projectPath);
            const project: Project = {
              id: entry.name,
              name: entry.name,
              path: projectPath,
              createdAt: stat.birthtime.toISOString(),
            };
            saveProjectMetadata(project);
            projects.push(project);
          }
        }
      }
      
      // Sort by lastOpenedAt or createdAt
      projects.sort((a, b) => {
        const aDate = a.lastOpenedAt || a.createdAt;
        const bDate = b.lastOpenedAt || b.createdAt;
        return new Date(bDate).getTime() - new Date(aDate).getTime();
      });
      
      // Get active project ID
      let activeProjectId: string | null = null;
      try {
        if (fs.existsSync(ACTIVE_PROJECT_FILE)) {
          const data = JSON.parse(fs.readFileSync(ACTIVE_PROJECT_FILE, "utf-8"));
          activeProjectId = data.projectId || null;
        }
      } catch {}
      
      res.json({ projects, activeProjectId });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create a new project
  app.post("/api/projects", (req: Request, res: Response) => {
    try {
      const parsed = createProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      
      // Generate project ID from name (sanitize for filesystem)
      const projectId = parsed.data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 50) + "-" + Date.now().toString(36);
      
      const projectPath = path.join(PROJECTS_DIR, projectId);
      
      // Ensure projects directory exists
      if (!fs.existsSync(PROJECTS_DIR)) {
        fs.mkdirSync(PROJECTS_DIR, { recursive: true });
      }
      
      // Create project directory
      if (fs.existsSync(projectPath)) {
        return res.status(409).json({ error: "Project already exists" });
      }
      
      fs.mkdirSync(projectPath, { recursive: true });
      
      // Create project metadata
      const project: Project = {
        id: projectId,
        name: parsed.data.name,
        path: projectPath,
        createdAt: new Date().toISOString(),
        lastOpenedAt: new Date().toISOString(),
      };
      
      saveProjectMetadata(project);
      
      // Set as active project
      if (!fs.existsSync(SETTINGS_DIR)) {
        fs.mkdirSync(SETTINGS_DIR, { recursive: true });
      }
      fs.writeFileSync(ACTIVE_PROJECT_FILE, JSON.stringify({ projectId }, null, 2));
      
      res.json(project);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get active project
  app.get("/api/projects/active", (req: Request, res: Response) => {
    try {
      if (!fs.existsSync(ACTIVE_PROJECT_FILE)) {
        return res.json({ project: null });
      }
      
      const data = JSON.parse(fs.readFileSync(ACTIVE_PROJECT_FILE, "utf-8"));
      const projectId = data.projectId;
      
      if (!projectId) {
        return res.json({ project: null });
      }
      
      const project = getProjectMetadata(projectId);
      res.json({ project });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Switch active project
  app.post("/api/projects/:id/activate", (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      
      // Validate project ID doesn't contain path traversal
      if (!projectId || projectId.includes("..") || projectId.includes("/") || projectId.includes("\\")) {
        return res.status(400).json({ error: "Invalid project ID" });
      }
      
      const projectPath = path.resolve(PROJECTS_DIR, projectId);
      
      // Security check
      const relativePath = path.relative(PROJECTS_DIR, projectPath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return res.status(403).json({ error: "Invalid project path" });
      }
      
      if (!fs.existsSync(projectPath)) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      // Update lastOpenedAt
      const project = getProjectMetadata(projectId);
      if (project) {
        project.lastOpenedAt = new Date().toISOString();
        saveProjectMetadata(project);
      }
      
      // Set as active
      if (!fs.existsSync(SETTINGS_DIR)) {
        fs.mkdirSync(SETTINGS_DIR, { recursive: true });
      }
      fs.writeFileSync(ACTIVE_PROJECT_FILE, JSON.stringify({ projectId }, null, 2));
      
      res.json({ success: true, project });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a project
  app.delete("/api/projects/:id", (req: Request, res: Response) => {
    try {
      const projectId = req.params.id;
      
      // Validate project ID doesn't contain path traversal
      if (!projectId || projectId.includes("..") || projectId.includes("/") || projectId.includes("\\")) {
        return res.status(400).json({ error: "Invalid project ID" });
      }
      
      const projectPath = path.resolve(PROJECTS_DIR, projectId);
      
      // Security check: ensure resolved path is within PROJECTS_DIR
      const relativePath = path.relative(PROJECTS_DIR, projectPath);
      if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return res.status(403).json({ error: "Invalid project path" });
      }
      
      if (!fs.existsSync(projectPath)) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      // Remove directory recursively
      fs.rmSync(projectPath, { recursive: true, force: true });
      
      // If this was the active project, clear active project
      try {
        if (fs.existsSync(ACTIVE_PROJECT_FILE)) {
          const data = JSON.parse(fs.readFileSync(ACTIVE_PROJECT_FILE, "utf-8"));
          if (data.projectId === projectId) {
            fs.unlinkSync(ACTIVE_PROJECT_FILE);
          }
        }
      } catch {}
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get files for active project (or root if no project)
  function getProjectFilesRoot(): string {
    const activeProjectPath = getActiveProjectPath();
    return activeProjectPath || process.cwd();
  }

  // File system routes
  app.get("/api/files", (req: Request, res: Response) => {
    const rootDir = getProjectFilesRoot();
    const tree = getFileTree(rootDir);
    res.json(tree);
  });

  app.get("/api/files/content", (req: Request, res: Response) => {
    const filePath = req.query.path as string;
    if (!filePath) {
      return res.status(400).json({ error: "Path is required" });
    }
    
    const rootDir = path.resolve(getProjectFilesRoot());
    const fullPath = path.resolve(rootDir, filePath);
    
    // Security check: ensure the path is within the project directory
    // Use path.relative to detect traversal attempts - if it starts with ".." it's outside
    const relativePath = path.relative(rootDir, fullPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    // Additional check: ensure resolved path is within root
    if (!fullPath.startsWith(rootDir + path.sep) && fullPath !== rootDir) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      res.json({ content, path: filePath });
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  });

  // Task routes
  app.post("/api/tasks", async (req: Request, res: Response) => {
    try {
      const parsed = createTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      
      const task = await storage.createTask(parsed.data);
      
      // Start task in background
      runTask(task.id).catch(console.error);
      
      res.json(task);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/tasks/:id", async (req: Request, res: Response) => {
    const task = await storage.getTask(req.params.id as string);
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }
    res.json(task);
  });

  app.get("/api/tasks/:id/events", (req: Request, res: Response) => {
    const taskId = req.params.id as string;
    
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });
    
    // Send existing logs first
    const existingLogs = storage.getTaskLogs(taskId);
    for (const log of existingLogs) {
      res.write(`data: ${log}\n\n`);
    }
    
    // Listen for new logs
    const emitter = storage.getTaskEventEmitter(taskId);
    
    const onLog = (log: string) => {
      res.write(`data: ${log}\n\n`);
    };
    
    emitter.on("log", onLog);
    
    // Clean up on close
    req.on("close", () => {
      emitter.off("log", onLog);
    });
  });

  app.get("/api/tasks/:id/diffs", (req: Request, res: Response) => {
    const taskId = req.params.id as string;
    const artifacts = storage.listArtifacts(taskId);
    const diffs = artifacts.filter(name => name.endsWith(".diff"));
    res.json({ diffs });
  });

  app.get("/api/tasks/:id/artifact", (req: Request, res: Response) => {
    const taskId = req.params.id as string;
    const name = req.query.name as string;
    
    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }
    
    const content = storage.getArtifact(taskId, name);
    if (content === undefined) {
      return res.status(404).json({ error: "Artifact not found" });
    }
    
    res.json({ name, content });
  });

  app.post("/api/tasks/:id/apply", async (req: Request, res: Response) => {
    const taskId = req.params.id as string;
    const { diffName, confirmationToken } = req.body;
    
    if (!diffName) {
      return res.status(400).json({ error: "diffName is required" });
    }
    
    const settings = readSettings();
    const trustSettings = settings.trust || getDefaultTrustSettings();
    
    const options: ApplyDiffOptions = {
      confirmationToken,
      trustSettings,
    };
    
    const result: ApplyDiffResult = await applyTaskDiff(taskId, diffName, options);
    
    if (result.requiresConfirmation && !confirmationToken) {
      return res.status(428).json({
        success: false,
        requiresConfirmation: true,
        confirmationToken: result.confirmationToken,
        dangerSummary: result.dangerSummary,
        error: result.error,
        validationReport: result.validationReport,
      });
    }
    
    if (result.success) {
      res.json({ 
        success: true, 
        message: "Diff applied successfully",
        filesModified: result.filesModified,
        validationReport: result.validationReport,
      });
    } else {
      res.status(400).json({ 
        success: false, 
        error: result.error,
        validationReport: result.validationReport,
      });
    }
  });

  // ============================================
  // File System Operations (Phase A)
  // ============================================

  // Write file content
  app.put("/api/fs/file", (req: Request, res: Response) => {
    const { path: filePath, content } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: "Path is required" });
    }
    if (content === undefined) {
      return res.status(400).json({ error: "Content is required" });
    }
    
    const rootDir = path.resolve(getProjectFilesRoot());
    const fullPath = path.resolve(rootDir, filePath);
    
    // Security check
    const relativePath = path.relative(rootDir, fullPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (!fullPath.startsWith(rootDir + path.sep) && fullPath !== rootDir) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    try {
      fs.writeFileSync(fullPath, content, "utf-8");
      res.json({ success: true, path: filePath });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create new file
  app.post("/api/fs/new-file", (req: Request, res: Response) => {
    const { path: filePath, content = "" } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: "Path is required" });
    }
    
    const rootDir = path.resolve(getProjectFilesRoot());
    const fullPath = path.resolve(rootDir, filePath);
    
    // Security check
    const relativePath = path.relative(rootDir, fullPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    try {
      if (fs.existsSync(fullPath)) {
        return res.status(409).json({ error: "File already exists" });
      }
      
      // Ensure parent directory exists
      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      
      fs.writeFileSync(fullPath, content, "utf-8");
      res.json({ success: true, path: filePath });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create new folder
  app.post("/api/fs/new-folder", (req: Request, res: Response) => {
    const { path: folderPath } = req.body;
    
    if (!folderPath) {
      return res.status(400).json({ error: "Path is required" });
    }
    
    const rootDir = path.resolve(getProjectFilesRoot());
    const fullPath = path.resolve(rootDir, folderPath);
    
    // Security check
    const relativePath = path.relative(rootDir, fullPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    try {
      if (fs.existsSync(fullPath)) {
        return res.status(409).json({ error: "Folder already exists" });
      }
      
      fs.mkdirSync(fullPath, { recursive: true });
      res.json({ success: true, path: folderPath });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Rename file or folder
  app.post("/api/fs/rename", (req: Request, res: Response) => {
    const { oldPath, newPath } = req.body;
    
    if (!oldPath || !newPath) {
      return res.status(400).json({ error: "Both oldPath and newPath are required" });
    }
    
    const rootDir = path.resolve(getProjectFilesRoot());
    const fullOldPath = path.resolve(rootDir, oldPath);
    const fullNewPath = path.resolve(rootDir, newPath);
    
    // Security check for both paths
    const relOld = path.relative(rootDir, fullOldPath);
    const relNew = path.relative(rootDir, fullNewPath);
    if (relOld.startsWith("..") || path.isAbsolute(relOld) ||
        relNew.startsWith("..") || path.isAbsolute(relNew)) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    try {
      if (!fs.existsSync(fullOldPath)) {
        return res.status(404).json({ error: "Source path not found" });
      }
      if (fs.existsSync(fullNewPath)) {
        return res.status(409).json({ error: "Destination already exists" });
      }
      
      fs.renameSync(fullOldPath, fullNewPath);
      res.json({ success: true, oldPath, newPath });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete file or folder
  app.post("/api/fs/delete", (req: Request, res: Response) => {
    const { path: targetPath } = req.body;
    
    if (!targetPath) {
      return res.status(400).json({ error: "Path is required" });
    }
    
    const rootDir = path.resolve(getProjectFilesRoot());
    const fullPath = path.resolve(rootDir, targetPath);
    
    // Security check
    const relativePath = path.relative(rootDir, fullPath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    // Prevent deleting root or critical files
    if (relativePath === "" || relativePath === ".") {
      return res.status(403).json({ error: "Cannot delete project root" });
    }
    
    try {
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: "Path not found" });
      }
      
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true });
      } else {
        fs.unlinkSync(fullPath);
      }
      
      res.json({ success: true, path: targetPath });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Duplicate file
  app.post("/api/fs/duplicate", (req: Request, res: Response) => {
    const { path: sourcePath, newPath } = req.body;
    
    if (!sourcePath) {
      return res.status(400).json({ error: "Source path is required" });
    }
    
    const rootDir = path.resolve(getProjectFilesRoot());
    const fullSourcePath = path.resolve(rootDir, sourcePath);
    
    // Security check
    const relSource = path.relative(rootDir, fullSourcePath);
    if (relSource.startsWith("..") || path.isAbsolute(relSource)) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    try {
      if (!fs.existsSync(fullSourcePath)) {
        return res.status(404).json({ error: "Source file not found" });
      }
      
      // Generate new path if not provided
      let destPath = newPath;
      if (!destPath) {
        const ext = path.extname(sourcePath);
        const base = path.basename(sourcePath, ext);
        const dir = path.dirname(sourcePath);
        destPath = path.join(dir, `${base}_copy${ext}`);
      }
      
      const fullDestPath = path.resolve(rootDir, destPath);
      const relDest = path.relative(rootDir, fullDestPath);
      if (relDest.startsWith("..") || path.isAbsolute(relDest)) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      // Ensure unique name if destination exists
      let finalDestPath = fullDestPath;
      let counter = 1;
      while (fs.existsSync(finalDestPath)) {
        const ext = path.extname(destPath);
        const base = path.basename(destPath, ext);
        const dir = path.dirname(fullDestPath);
        finalDestPath = path.join(dir, `${base}_${counter}${ext}`);
        counter++;
      }
      
      fs.copyFileSync(fullSourcePath, finalDestPath);
      const finalRelPath = path.relative(rootDir, finalDestPath);
      res.json({ success: true, sourcePath, newPath: finalRelPath });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Settings API (Phase B)
  // ============================================

  // Get settings
  app.get("/api/settings", (req: Request, res: Response) => {
    try {
      const settings = readSettings();
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update settings
  app.put("/api/settings", (req: Request, res: Response) => {
    try {
      const newSettings = settingsSchema.parse(req.body);
      writeSettings(newSettings);
      res.json({ success: true, settings: newSettings });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // Partial update settings (patch specific section)
  app.patch("/api/settings/:section", (req: Request, res: Response) => {
    try {
      const section = req.params.section as string;
      const currentSettings = readSettings();
      
      if (!(section in currentSettings)) {
        return res.status(400).json({ error: `Invalid section: ${section}` });
      }
      
      const updatedSettings = {
        ...currentSettings,
        [section]: { ...currentSettings[section as keyof Settings], ...req.body },
      };
      
      const validated = settingsSchema.parse(updatedSettings);
      writeSettings(validated);
      res.json({ success: true, settings: validated });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  });

  // ============================================
  // Secrets Vault API (Phase C)
  // ============================================
  
  // In-memory storage for the unlocked vault session with auto-lock
  let currentVault: any = null;
  let currentMasterPassword: string | null = null;
  let vaultLastActivity: number = 0;
  let vaultAutoLockMinutes: number = 15; // 15 minutes default
  let autoLockTimer: ReturnType<typeof setTimeout> | null = null;

  const resetVaultAutoLock = () => {
    vaultLastActivity = Date.now();
    if (autoLockTimer) {
      clearTimeout(autoLockTimer);
    }
    if (currentVault) {
      autoLockTimer = setTimeout(() => {
        currentVault = null;
        currentMasterPassword = null;
        console.log("[Vault] Auto-locked due to inactivity");
      }, vaultAutoLockMinutes * 60 * 1000);
    }
  };

  const lockVaultNow = () => {
    currentVault = null;
    currentMasterPassword = null;
    if (autoLockTimer) {
      clearTimeout(autoLockTimer);
      autoLockTimer = null;
    }
  };

  // Check if vault exists
  app.get("/api/secrets/status", (req: Request, res: Response) => {
    res.json({
      exists: vaultExists(),
      unlocked: currentVault !== null,
      autoLockMinutes: vaultAutoLockMinutes,
    });
  });

  // ==================== ENVIRONMENT HELPERS ====================
  // Determine effective environment: SIMPLEAIDE_ENV overrides NODE_ENV
  function getEffectiveEnv(): "DEV" | "PROD" {
    if (process.env.SIMPLEAIDE_ENV === "prod" || process.env.SIMPLEAIDE_ENV === "production") {
      return "PROD";
    }
    if (process.env.NODE_ENV === "production") {
      return "PROD";
    }
    return "DEV";
  }

  function isProdEnv(): boolean {
    return getEffectiveEnv() === "PROD";
  }

  // ==================== GLOBAL STATUS ENDPOINT ====================
  app.get("/api/status", async (req: Request, res: Response) => {
    try {
      // Environment with both values for debugging
      const effectiveEnv = getEffectiveEnv();
      const nodeEnv = process.env.NODE_ENV || "development";
      const simpleaideEnv = process.env.SIMPLEAIDE_ENV || null;
      
      // Runs status
      const activeRunCount = await runsStorage.getActiveRunCount();
      const latestRun = await runsStorage.getLatestRunSummary();
      const busy = await runsStorage.isBusy();
      
      // Vault status
      const vaultStatus = {
        exists: vaultExists(),
        locked: currentVault === null,
        autoLockMinutes: vaultAutoLockMinutes,
        autoLockRemainingMs: currentVault && vaultLastActivity > 0
          ? Math.max(0, (vaultLastActivity + vaultAutoLockMinutes * 60 * 1000) - Date.now())
          : null,
      };
      
      // Database status
      let dbStatus: { connected: boolean; count: number; type: string } = {
        connected: false,
        count: 0,
        type: "sqlite",
      };
      try {
        const databases = db.listDatabases();
        dbStatus = {
          connected: true,
          count: databases.length,
          type: "sqlite",
        };
      } catch {
        // Database not available
      }
      
      // LLM backends status with real health checks
      let llmStatus: { online: number; total: number; backends: Array<{ id: string; name: string; online: boolean; lastChecked?: number; error?: string }> } = {
        online: 0,
        total: 0,
        backends: [],
      };
      try {
        const settings = readSettings();
        const backends = settings.aiAgents?.backends || [];
        llmStatus.total = backends.length;
        
        const healthResults = await Promise.all(
          backends.map(async (b: any) => {
            const health = await getBackendHealthStatus(b.id, b.baseUrl);
            const cached = backendHealthCache.get(b.id);
            return {
              id: b.id,
              name: b.name,
              online: health.online,
              lastChecked: cached?.lastChecked,
              error: health.error,
            };
          })
        );
        
        llmStatus.backends = healthResults;
        llmStatus.online = healthResults.filter(b => b.online).length;
      } catch {
        // No settings
      }
      
      // Server info
      const serverInfo = {
        port: process.env.PORT || 5000,
        nodeEnv: process.env.NODE_ENV || "development",
        uptime: process.uptime(),
      };
      
      // Confirmation token stability check
      const hasSessionSecret = !!process.env.SESSION_SECRET;
      const confirmationTokenStatus = hasSessionSecret 
        ? "stable" 
        : "unstable (SESSION_SECRET not set - tokens invalid after restart)";
      
      res.json({
        env: effectiveEnv,
        envDetails: {
          effective: effectiveEnv,
          nodeEnv,
          simpleaideEnv,
        },
        server: serverInfo,
        security: {
          confirmationTokens: confirmationTokenStatus,
          sessionSecretSet: hasSessionSecret,
        },
        runs: {
          active: activeRunCount,
          busy,
          last: latestRun,
        },
        vault: vaultStatus,
        db: dbStatus,
        llm: llmStatus,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Configure auto-lock timeout
  app.put("/api/secrets/autolock", (req: Request, res: Response) => {
    const { minutes } = req.body;
    if (typeof minutes !== "number" || minutes < 1 || minutes > 120) {
      return res.status(400).json({ error: "Minutes must be between 1 and 120" });
    }
    vaultAutoLockMinutes = minutes;
    if (currentVault) {
      resetVaultAutoLock();
    }
    res.json({ success: true, autoLockMinutes: vaultAutoLockMinutes });
  });

  // Create vault
  app.post("/api/secrets/create", (req: Request, res: Response) => {
    try {
      const { masterPassword } = req.body;
      
      if (!masterPassword || masterPassword.length < 8) {
        return res.status(400).json({ error: "Master password must be at least 8 characters" });
      }
      
      if (vaultExists()) {
        return res.status(400).json({ error: "Vault already exists" });
      }
      
      createVault(masterPassword);
      currentVault = unlockVault(masterPassword);
      currentMasterPassword = masterPassword;
      resetVaultAutoLock();
      
      res.json({ success: true, message: "Vault created and unlocked" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Unlock vault
  app.post("/api/secrets/unlock", (req: Request, res: Response) => {
    try {
      const { masterPassword } = req.body;
      
      if (!masterPassword) {
        return res.status(400).json({ error: "Master password is required" });
      }
      
      const vault = unlockVault(masterPassword);
      
      if (!vault) {
        return res.status(401).json({ error: "Invalid master password or vault not found" });
      }
      
      currentVault = vault;
      currentMasterPassword = masterPassword;
      resetVaultAutoLock();
      
      res.json({ success: true, message: "Vault unlocked" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Lock vault
  app.post("/api/secrets/lock", (req: Request, res: Response) => {
    lockVaultNow();
    res.json({ success: true, message: "Vault locked" });
  });

  // Delete/reset vault
  app.delete("/api/secrets/vault", (req: Request, res: Response) => {
    try {
      lockVaultNow();
      const deleted = deleteVault();
      if (deleted) {
        res.json({ success: true, message: "Vault deleted. You can create a new one with your own password." });
      } else {
        res.json({ success: true, message: "No vault exists to delete." });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // List secrets (masked values)
  app.get("/api/secrets", (req: Request, res: Response) => {
    if (!currentVault) {
      return res.status(401).json({ error: "Vault is locked" });
    }
    
    resetVaultAutoLock();
    const keys = listSecretKeys(currentVault);
    const secrets = keys.map(key => ({
      key,
      maskedValue: maskSecret(currentVault.secrets[key]),
    }));
    
    res.json({ secrets });
  });

  // Get single secret (masked)
  app.get("/api/secrets/:key", (req: Request, res: Response) => {
    if (!currentVault) {
      return res.status(401).json({ error: "Vault is locked" });
    }
    
    resetVaultAutoLock();
    const key = req.params.key as string;
    const value = currentVault.secrets[key];
    
    if (!value) {
      return res.status(404).json({ error: "Secret not found" });
    }
    
    res.json({ key, maskedValue: maskSecret(value) });
  });

  // Set secret
  app.put("/api/secrets/:key", (req: Request, res: Response) => {
    if (!currentVault || !currentMasterPassword) {
      return res.status(401).json({ error: "Vault is locked" });
    }
    
    resetVaultAutoLock();
    try {
      const key = req.params.key as string;
      const { value } = req.body;
      
      if (!value) {
        return res.status(400).json({ error: "Value is required" });
      }
      
      setSecret(currentVault, key, value);
      saveVault(currentVault, currentMasterPassword);
      
      res.json({ success: true, key, maskedValue: maskSecret(value) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete secret
  app.delete("/api/secrets/:key", (req: Request, res: Response) => {
    if (!currentVault || !currentMasterPassword) {
      return res.status(401).json({ error: "Vault is locked" });
    }
    
    resetVaultAutoLock();
    try {
      const key = req.params.key as string;
      const deleted = deleteSecret(currentVault, key);
      
      if (!deleted) {
        return res.status(404).json({ error: "Secret not found" });
      }
      
      saveVault(currentVault, currentMasterPassword);
      res.json({ success: true, message: `Secret '${key}' deleted` });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Test integration connection
  app.post("/api/integrations/test/:provider", async (req: Request, res: Response) => {
    const provider = req.params.provider as string;
    
    if (!currentVault) {
      return res.status(401).json({ error: "Vault is locked. Unlock the vault first to test connections." });
    }
    
    try {
      let secretKey: string;
      let testUrl: string;
      let headers: Record<string, string> = {};
      
      switch (provider) {
        case "kaggle":
          secretKey = "KAGGLE_API_KEY";
          // Kaggle uses username:key format
          const kaggleKey = currentVault.secrets[secretKey];
          if (!kaggleKey) {
            return res.status(400).json({ error: "KAGGLE_API_KEY not found in vault. Add it in the Security tab." });
          }
          // Kaggle API expects base64 encoded username:key
          const { username } = req.body;
          if (!username) {
            return res.status(400).json({ error: "Kaggle username is required" });
          }
          const kaggleAuth = Buffer.from(`${username}:${kaggleKey}`).toString("base64");
          testUrl = "https://www.kaggle.com/api/v1/competitions/list";
          headers = { Authorization: `Basic ${kaggleAuth}` };
          break;
          
        case "huggingface":
          secretKey = "HUGGINGFACE_TOKEN";
          const hfToken = currentVault.secrets[secretKey];
          if (!hfToken) {
            return res.status(400).json({ error: "HUGGINGFACE_TOKEN not found in vault. Add it in the Security tab." });
          }
          testUrl = "https://huggingface.co/api/whoami-v2";
          headers = { Authorization: `Bearer ${hfToken}` };
          break;
          
        case "ngc":
          secretKey = "NGC_API_KEY";
          const ngcKey = currentVault.secrets[secretKey];
          if (!ngcKey) {
            return res.status(400).json({ error: "NGC_API_KEY not found in vault. Add it in the Security tab." });
          }
          testUrl = "https://api.ngc.nvidia.com/v2/orgs";
          headers = { Authorization: `Bearer ${ngcKey}` };
          break;
          
        default:
          return res.status(400).json({ error: `Unknown provider: ${provider}` });
      }
      
      // Make test request with manual timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      let response: globalThis.Response;
      try {
        response = await fetch(testUrl, { 
          method: "GET",
          headers,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      
      if (response.ok) {
        const data = await response.json();
        let details = "";
        
        if (provider === "huggingface" && data.name) {
          details = `Logged in as: ${data.name}`;
        } else if (provider === "kaggle") {
          details = "Kaggle API connection successful";
        } else if (provider === "ngc") {
          details = "NGC API connection successful";
        }
        
        res.json({ success: true, message: `${provider} connection successful`, details });
      } else {
        const errorText = await response.text();
        res.status(response.status).json({ 
          error: `${provider} API returned ${response.status}`, 
          details: errorText.substring(0, 200) 
        });
      }
    } catch (error: any) {
      // Handle both AbortError (from AbortController) and TimeoutError
      if (error.name === "AbortError" || error.name === "TimeoutError") {
        res.status(504).json({ error: "Connection timed out" });
      } else if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
        res.status(503).json({ error: "Service unavailable: " + error.message });
      } else {
        res.status(500).json({ error: error.message || "Unknown error" });
      }
    }
  });

  // ============================================
  // AI Agents API
  // ============================================

  // Test backend connection and get available models
  app.post("/api/ai-agents/test-backend", async (req: Request, res: Response) => {
    const { backendId } = req.body;
    
    if (!backendId) {
      return res.status(400).json({ error: "backendId is required" });
    }
    
    try {
      const settings = readSettings();
      const backend = settings.aiAgents?.backends?.find((b: any) => b.id === backendId);
      
      if (!backend) {
        return res.status(404).json({ error: "Backend not found" });
      }
      
      // Build authorization headers
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      
      if (backend.authType !== "none" && currentVault) {
        if (backend.authType === "basic") {
          const username = currentVault.secrets[`BACKEND_${backendId}_USERNAME`];
          const password = currentVault.secrets[`BACKEND_${backendId}_PASSWORD`];
          if (username && password) {
            const auth = Buffer.from(`${username}:${password}`).toString("base64");
            headers["Authorization"] = `Basic ${auth}`;
          }
        } else if (backend.authType === "bearer") {
          const token = currentVault.secrets[`BACKEND_${backendId}_TOKEN`];
          if (token) {
            headers["Authorization"] = `Bearer ${token}`;
          }
        }
      }
      
      // Try to get models from Ollama-compatible API
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      let response: globalThis.Response;
      try {
        response = await fetch(`${backend.baseUrl}/api/tags`, {
          method: "GET",
          headers,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      
      if (response.ok) {
        const data = await response.json();
        const models = data.models?.map((m: any) => m.name || m.model) || [];
        res.json({ success: true, models });
      } else {
        const errorText = await response.text();
        res.status(response.status).json({
          success: false,
          error: `Backend returned ${response.status}: ${errorText.substring(0, 200)}`,
        });
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        res.status(504).json({ success: false, error: "Connection timed out" });
      } else if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
        res.status(503).json({ success: false, error: `Cannot connect to backend: ${error.message}` });
      } else {
        res.status(500).json({ success: false, error: error.message });
      }
    }
  });

  // Refresh health status for all backends (force refresh)
  app.post("/api/ai-agents/health-refresh", async (req: Request, res: Response) => {
    try {
      const settings = readSettings();
      const backends = settings.aiAgents?.backends || [];
      
      const healthResults = await Promise.all(
        backends.map(async (b: any) => {
          const health = await getBackendHealthStatus(b.id, b.baseUrl, true);
          const cached = backendHealthCache.get(b.id);
          return {
            id: b.id,
            name: b.name,
            online: health.online,
            lastChecked: cached?.lastChecked,
            error: health.error,
          };
        })
      );
      
      res.json({
        total: healthResults.length,
        online: healthResults.filter(b => b.online).length,
        backends: healthResults,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Model Catalog API - Dynamic model discovery
  // ============================================
  
  const MODEL_CATALOG_FILE = path.join(SETTINGS_DIR, "model_catalog.json");
  
  // Model type heuristics based on name patterns
  function inferModelType(modelName: string): "code" | "general" | "reasoning" | "vision" | "tool" | "embed" | "unknown" {
    const name = modelName.toLowerCase();
    if (name.includes("embed") || name.includes("embedding")) return "embed";
    if (name.includes("vision") || name.includes("llava") || name.includes("bakllava") || name.includes("moondream")) return "vision";
    if (name.includes("code") || name.includes("coder") || name.includes("starcoder") || name.includes("deepseek-coder") || name.includes("codellama") || name.includes("qwen2.5-coder")) return "code";
    // Reasoning/thinking models - often have "think", "reason", or specific architectures
    if (name.includes("think") || name.includes("reason") || name.includes("o1") || name.includes("deepseek-r1") || name.includes("qwq")) return "reasoning";
    // Tool-capable/agentic models - often have "func", "tool", or "agent" in name
    if (name.includes("func") || name.includes("tool") || name.includes("agent") || name.includes("hermes")) return "tool";
    return "general";
  }
  
  // Size class heuristics based on name patterns
  function inferSizeClass(modelName: string): "small" | "medium" | "large" | "xlarge" | "unknown" {
    const name = modelName.toLowerCase();
    // Look for parameter counts
    if (name.includes("0.5b") || name.includes("1b") || name.includes("1.3b") || name.includes("2b") || name.includes("3b")) return "small";
    if (name.includes("7b") || name.includes("8b") || name.includes("6b")) return "medium";
    if (name.includes("13b") || name.includes("14b") || name.includes("20b") || name.includes("27b") || name.includes("32b") || name.includes("34b")) return "large";
    if (name.includes("70b") || name.includes("72b") || name.includes("100b") || name.includes("180b") || name.includes("405b")) return "xlarge";
    return "unknown";
  }
  
  // Speed/quality inference based on size
  function inferSpeedQuality(sizeClass: string): "fast" | "balanced" | "accurate" {
    if (sizeClass === "small") return "fast";
    if (sizeClass === "medium") return "balanced";
    if (sizeClass === "large" || sizeClass === "xlarge") return "accurate";
    return "balanced";
  }
  
  interface ModelCatalogEntry {
    type?: "code" | "general" | "reasoning" | "vision" | "tool" | "embed";
    preference?: "fast" | "balanced" | "accurate";
    defaultNumCtx?: number;
    notes?: string;
  }
  
  interface ModelCatalog {
    models: Record<string, ModelCatalogEntry>;
    updatedAt?: string;
  }
  
  function readModelCatalog(): ModelCatalog {
    try {
      if (fs.existsSync(MODEL_CATALOG_FILE)) {
        const data = fs.readFileSync(MODEL_CATALOG_FILE, "utf-8");
        return JSON.parse(data);
      }
    } catch (error) {
      console.error("Error reading model catalog:", error);
    }
    return { models: {} };
  }
  
  function writeModelCatalog(catalog: ModelCatalog): void {
    if (!fs.existsSync(SETTINGS_DIR)) {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    }
    catalog.updatedAt = new Date().toISOString();
    fs.writeFileSync(MODEL_CATALOG_FILE, JSON.stringify(catalog, null, 2));
  }
  
  // Get all models from all configured backends with metadata
  app.get("/api/ai/models", async (req: Request, res: Response) => {
    try {
      const settings = readSettings();
      const backends = settings.aiAgents?.backends || [];
      const catalog = readModelCatalog();
      
      const results: Array<{
        backendId: string;
        backendName: string;
        backendUrl: string;
        online: boolean;
        models: Array<{
          name: string;
          size?: number;
          modifiedAt?: string;
          details?: any;
          inferred: {
            type: string;
            sizeClass: string;
            preference: string;
          };
          userTags?: ModelCatalogEntry;
        }>;
        error?: string;
      }> = [];
      
      // Query each backend in parallel
      const promises = backends.map(async (backend: any) => {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        
        // Add auth headers if needed
        if (backend.authType !== "none" && currentVault) {
          if (backend.authType === "basic") {
            const username = currentVault.secrets[`BACKEND_${backend.id}_USERNAME`];
            const password = currentVault.secrets[`BACKEND_${backend.id}_PASSWORD`];
            if (username && password) {
              const auth = Buffer.from(`${username}:${password}`).toString("base64");
              headers["Authorization"] = `Basic ${auth}`;
            }
          } else if (backend.authType === "bearer") {
            const token = currentVault.secrets[`BACKEND_${backend.id}_TOKEN`];
            if (token) {
              headers["Authorization"] = `Bearer ${token}`;
            }
          }
        }
        
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          
          const response = await fetch(`${backend.baseUrl}/api/tags`, {
            method: "GET",
            headers,
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          
          if (response.ok) {
            const data = await response.json();
            const models = (data.models || []).map((m: any) => {
              const modelName = m.name || m.model || "";
              const inferredType = inferModelType(modelName);
              const inferredSize = inferSizeClass(modelName);
              const inferredPreference = inferSpeedQuality(inferredSize);
              
              return {
                name: modelName,
                size: m.size,
                modifiedAt: m.modified_at,
                details: m.details,
                inferred: {
                  type: inferredType,
                  sizeClass: inferredSize,
                  preference: inferredPreference,
                },
                userTags: catalog.models[modelName] || undefined,
              };
            });
            
            return {
              backendId: backend.id,
              backendName: backend.name,
              backendUrl: backend.baseUrl,
              online: true,
              models,
            };
          } else {
            return {
              backendId: backend.id,
              backendName: backend.name,
              backendUrl: backend.baseUrl,
              online: false,
              models: [],
              error: `HTTP ${response.status}`,
            };
          }
        } catch (error: any) {
          return {
            backendId: backend.id,
            backendName: backend.name,
            backendUrl: backend.baseUrl,
            online: false,
            models: [],
            error: error.name === "AbortError" ? "Timeout" : error.message,
          };
        }
      });
      
      const backendResults = await Promise.all(promises);
      res.json({ backends: backendResults, catalog });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Get user model catalog/tags
  app.get("/api/ai/model-catalog", (req: Request, res: Response) => {
    try {
      const catalog = readModelCatalog();
      res.json(catalog);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Update model tags
  app.put("/api/ai/model-catalog", (req: Request, res: Response) => {
    try {
      const { models } = req.body;
      if (!models || typeof models !== "object") {
        return res.status(400).json({ error: "models object is required" });
      }
      
      const catalog: ModelCatalog = { models };
      writeModelCatalog(catalog);
      res.json({ success: true, catalog });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Update single model tags
  app.put("/api/ai/model-catalog/:modelName", (req: Request, res: Response) => {
    try {
      const modelName = decodeURIComponent(req.params.modelName);
      const tags = req.body;
      
      const catalog = readModelCatalog();
      
      if (Object.keys(tags).length === 0) {
        delete catalog.models[modelName];
      } else {
        catalog.models[modelName] = {
          ...catalog.models[modelName],
          ...tags,
        };
      }
      
      writeModelCatalog(catalog);
      res.json({ success: true, model: modelName, tags: catalog.models[modelName] });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get secret value for backend (internal use by orchestrator)
  const getBackendCredentials = (backendId: string, authType: string): Record<string, string> => {
    const headers: Record<string, string> = {};
    
    if (authType !== "none" && currentVault) {
      if (authType === "basic") {
        const username = currentVault.secrets[`BACKEND_${backendId}_USERNAME`];
        const password = currentVault.secrets[`BACKEND_${backendId}_PASSWORD`];
        if (username && password) {
          const auth = Buffer.from(`${username}:${password}`).toString("base64");
          headers["Authorization"] = `Basic ${auth}`;
        }
      } else if (authType === "bearer") {
        const token = currentVault.secrets[`BACKEND_${backendId}_TOKEN`];
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }
      }
    }
    
    return headers;
  };

  // Orchestrator endpoint - makes LLM call with role-based routing
  app.post("/api/ai-agents/chat", async (req: Request, res: Response) => {
    const { role, messages, options } = req.body;
    
    if (!role || !messages) {
      return res.status(400).json({ error: "role and messages are required" });
    }
    
    try {
      const settings = readSettings();
      const aiAgents = settings.aiAgents || { backends: [], roles: {} };
      const backends = aiAgents.backends || [];
      
      if (backends.length === 0) {
        return res.status(400).json({ error: "No backends configured" });
      }
      
      // Get role config or use defaults
      const roleConfig = aiAgents.roles?.[role as keyof typeof aiAgents.roles];
      const defaultBackendId = aiAgents.defaultBackendId || backends[0]?.id;
      
      const backendId = roleConfig?.backendId || defaultBackendId;
      const model = roleConfig?.model || "codellama";
      const temperature = roleConfig?.temperature ?? options?.temperature ?? 0.7;
      const numCtx = roleConfig?.numCtx ?? options?.num_ctx ?? 4096;
      
      // Find backend
      let backend = backends.find((b: any) => b.id === backendId);
      
      // Fallback to default backend if specified backend not found
      if (!backend && defaultBackendId) {
        backend = backends.find((b: any) => b.id === defaultBackendId);
      }
      
      // Fallback to first backend
      if (!backend) {
        backend = backends[0];
      }
      
      if (!backend) {
        return res.status(400).json({ error: "No valid backend found" });
      }
      
      // Build request
      const authHeaders = getBackendCredentials(backend.id, backend.authType);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...authHeaders,
      };
      
      const payload = {
        model,
        messages,
        stream: false,
        options: {
          temperature,
          num_ctx: numCtx,
        },
      };
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 minute timeout
      
      let response: globalThis.Response;
      try {
        response = await fetch(`${backend.baseUrl}/api/chat`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (primaryError: any) {
        // Try fallback to default backend
        if (backend.id !== defaultBackendId && defaultBackendId) {
          const fallbackBackend = backends.find((b: any) => b.id === defaultBackendId);
          if (fallbackBackend) {
            const fallbackHeaders = {
              "Content-Type": "application/json",
              ...getBackendCredentials(fallbackBackend.id, fallbackBackend.authType),
            };
            
            try {
              response = await fetch(`${fallbackBackend.baseUrl}/api/chat`, {
                method: "POST",
                headers: fallbackHeaders,
                body: JSON.stringify(payload),
                signal: controller.signal,
              });
            } catch (fallbackError) {
              clearTimeout(timeoutId);
              throw primaryError;
            }
          } else {
            clearTimeout(timeoutId);
            throw primaryError;
          }
        } else {
          clearTimeout(timeoutId);
          throw primaryError;
        }
      } finally {
        clearTimeout(timeoutId);
      }
      
      if (response!.ok) {
        const data = await response!.json();
        res.json({
          success: true,
          message: data.message,
          model: data.model,
          backend: backend.name,
        });
      } else {
        const errorText = await response!.text();
        res.status(response!.status).json({
          success: false,
          error: `LLM call failed: ${errorText.substring(0, 500)}`,
        });
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        res.status(504).json({ success: false, error: "Request timed out" });
      } else if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
        res.status(503).json({ success: false, error: `Cannot connect to backend: ${error.message}` });
      } else {
        res.status(500).json({ success: false, error: error.message });
      }
    }
  });

  // ============================================
  // Workflow Runs API (Phase D1)
  // ============================================

  // Create a new run
  app.post("/api/runs", async (req: Request, res: Response) => {
    try {
      const parsed = createRunSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }

      const run = await runsStorage.createRun(parsed.data);
      res.json(run);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // List all runs
  app.get("/api/runs", async (req: Request, res: Response) => {
    try {
      const runs = await runsStorage.listRuns();
      res.json({ runs });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get a specific run with all steps
  app.get("/api/runs/:id", async (req: Request, res: Response) => {
    try {
      const run = await runsStorage.getRun(req.params.id);
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }
      res.json(run);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Execute a step in a run
  app.post("/api/runs/:id/step", async (req: Request, res: Response) => {
    try {
      const runId = req.params.id;
      const run = await runsStorage.getRun(runId);
      
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      const parsed = executeStepSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }

      const { stepType, input } = parsed.data;

      // Update run status to running if pending
      if (run.metadata.status === "pending") {
        await runsStorage.updateRunStatus(runId, "running");
      }

      // Create the step
      const step = await runsStorage.createStep(runId, stepType, input || {
        filesReferenced: [],
      });

      // Update step to running
      await runsStorage.updateStepStatus(runId, step.stepNumber, stepType, "running");

      // Execute the step (placeholder - actual execution will be added in D2)
      const startTime = Date.now();
      
      try {
        // Simulate step execution - will be replaced with actual AI calls
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // For now, save a placeholder artifact based on step type
        let artifactName = "";
        let artifactContent = "";
        
        switch (stepType) {
          case "plan":
            artifactName = "plan.json";
            artifactContent = JSON.stringify({
              goal: run.metadata.goal,
              steps: ["Step 1: Analyze requirements", "Step 2: Implement changes", "Step 3: Test"],
              generatedAt: new Date().toISOString(),
            }, null, 2);
            break;
          case "implement":
            artifactName = "patch.diff";
            artifactContent = `--- a/placeholder.txt\n+++ b/placeholder.txt\n@@ -1 +1 @@\n-old content\n+new content for: ${run.metadata.goal}`;
            break;
          case "review":
            artifactName = "review.md";
            artifactContent = `# Code Review\n\n## Summary\nReview for: ${run.metadata.goal}\n\n## Findings\n- No issues found\n\n## Recommendations\n- All looks good`;
            break;
          case "test":
            artifactName = "test.log";
            artifactContent = `[TEST] Running tests for: ${run.metadata.goal}\n[PASS] All tests passed`;
            break;
          case "fix":
            artifactName = "fix.diff";
            artifactContent = `--- a/placeholder.txt\n+++ b/placeholder.txt\n@@ -1 +1 @@\n-buggy content\n+fixed content`;
            break;
        }

        if (artifactName) {
          await runsStorage.saveStepArtifact(runId, step.stepNumber, stepType, artifactName, artifactContent);
        }

        const durationMs = Date.now() - startTime;
        await runsStorage.updateStepStatus(runId, step.stepNumber, stepType, "passed", durationMs);

        // Return updated step
        const updatedRun = await runsStorage.getRun(runId);
        const updatedStep = updatedRun?.steps.find(s => s.stepNumber === step.stepNumber);
        
        res.json({ 
          success: true, 
          step: updatedStep,
          artifactName,
        });
      } catch (stepError: any) {
        const durationMs = Date.now() - startTime;
        await runsStorage.updateStepStatus(runId, step.stepNumber, stepType, "failed", durationMs, stepError.message);
        await runsStorage.updateRunStatus(runId, "failed", stepError.message);
        
        res.status(500).json({ 
          success: false, 
          error: stepError.message,
          step,
        });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get step artifact
  app.get("/api/runs/:id/steps/:stepNum/artifact/:name", async (req: Request, res: Response) => {
    try {
      const { id: runId, stepNum, name } = req.params;
      const stepNumber = parseInt(stepNum, 10);
      
      const run = await runsStorage.getRun(runId);
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      const step = run.steps.find(s => s.stepNumber === stepNumber);
      if (!step) {
        return res.status(404).json({ error: "Step not found" });
      }

      const content = await runsStorage.getStepArtifact(runId, stepNumber, step.stepType, name);
      if (!content) {
        return res.status(404).json({ error: "Artifact not found" });
      }

      res.json({ name, content });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Rerun from a specific step
  app.post("/api/runs/:id/rerun", async (req: Request, res: Response) => {
    try {
      const runId = req.params.id;
      const run = await runsStorage.getRun(runId);
      
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      const parsed = rerunSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }

      const { fromStep } = parsed.data;

      if (fromStep > run.metadata.stepCount) {
        return res.status(400).json({ error: `Step ${fromStep} does not exist. Run has ${run.metadata.stepCount} steps.` });
      }

      // Delete steps from fromStep onwards
      await runsStorage.deleteStepsFrom(runId, fromStep);

      // Get updated run state
      const updatedRun = await runsStorage.getRun(runId);

      res.json({ 
        success: true, 
        message: `Ready to rerun from step ${fromStep}`,
        run: updatedRun,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Complete a run
  app.post("/api/runs/:id/complete", async (req: Request, res: Response) => {
    try {
      const runId = req.params.id;
      const run = await runsStorage.getRun(runId);
      
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      const { status = "completed", errorMessage } = req.body;

      if (!["completed", "failed", "cancelled"].includes(status)) {
        return res.status(400).json({ error: "Invalid status. Must be completed, failed, or cancelled." });
      }

      await runsStorage.updateRunStatus(runId, status, errorMessage);

      const updatedRun = await runsStorage.getRun(runId);
      res.json({ success: true, run: updatedRun });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== Phase D2: Auto Workflow API ====================

  // Start autonomous workflow (Plan→Code→Apply→Test→Fix chain)
  app.post("/api/runs/:id/auto", async (req: Request, res: Response) => {
    try {
      const runId = req.params.id;
      
      if (isWorkflowRunning(runId)) {
        return res.status(409).json({ error: "Workflow is already running" });
      }
      
      const run = await runsStorage.getRun(runId);
      
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      if (run.metadata.status === "running") {
        return res.status(409).json({ error: "Run is already in progress" });
      }

      const { skipTests = false } = req.body;

      runAutoWorkflow({
        runId,
        goal: run.metadata.goal,
        repoPath: run.metadata.repoPath,
        skipTests,
      }).catch(console.error);

      res.json({ 
        success: true, 
        message: "Auto workflow started",
        runId,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Apply a diff from a step with backup
  app.post("/api/runs/:id/steps/:stepNum/apply", async (req: Request, res: Response) => {
    try {
      const runId = req.params.id;
      const stepNum = parseInt(req.params.stepNum, 10);
      
      if (isWorkflowRunning(runId)) {
        return res.status(409).json({ error: "Cannot apply diff while workflow is running" });
      }
      
      const run = await runsStorage.getRun(runId);
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }

      const step = run.steps.find(s => s.stepNumber === stepNum);
      if (!step) {
        return res.status(404).json({ error: "Step not found" });
      }

      if (step.stepType !== "implement" && step.stepType !== "fix") {
        return res.status(400).json({ error: "Only implement and fix steps can be applied" });
      }

      const result = await applyDiffWithBackup(runId, stepNum, step.stepType);
      
      if (result.success) {
        res.json({ 
          success: true, 
          message: "Diff applied successfully",
          backupId: result.backupId,
        });
      } else {
        res.status(400).json({ 
          success: false, 
          error: result.error,
        });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Revert changes using a backup
  app.post("/api/runs/revert", async (req: Request, res: Response) => {
    try {
      const { backupId } = req.body;
      
      if (!backupId) {
        return res.status(400).json({ error: "backupId is required" });
      }

      const result = await revertDiff(backupId);
      
      if (result.success) {
        res.json({ success: true, message: "Changes reverted successfully" });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== DATABASE ROUTES ====================

  // List all databases
  app.get("/api/db/list", (req: Request, res: Response) => {
    try {
      const databases = db.listDatabases();
      res.json(databases);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create a new SQLite database
  app.post("/api/db/create", (req: Request, res: Response) => {
    try {
      // PROD read-only enforcement
      if (isProdEnv()) {
        return res.status(403).json({ 
          error: "Database creation is disabled in production mode",
          code: "PROD_READ_ONLY"
        });
      }
      
      const { name } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Database name is required" });
      }
      const database = db.createSqliteDatabase(name);
      res.json(database);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get tables for a database
  app.get("/api/db/:env/tables", (req: Request, res: Response) => {
    try {
      const dbPath = req.query.path as string;
      if (!dbPath) {
        return res.status(400).json({ error: "Database path is required" });
      }
      const tables = db.getTables(dbPath);
      res.json(tables);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get table schema
  app.get("/api/db/:env/schema/:table", (req: Request, res: Response) => {
    try {
      const dbPath = req.query.path as string;
      const tableName = req.params.table;
      if (!dbPath) {
        return res.status(400).json({ error: "Database path is required" });
      }
      const schema = db.getTableSchema(dbPath, tableName);
      res.json(schema);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get rows from a table
  app.get("/api/db/:env/rows/:table", (req: Request, res: Response) => {
    try {
      const dbPath = req.query.path as string;
      const tableName = req.params.table;
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;
      const orderBy = req.query.orderBy as string | undefined;
      const orderDir = (req.query.orderDir as "asc" | "desc") || "asc";
      
      if (!dbPath) {
        return res.status(400).json({ error: "Database path is required" });
      }
      
      const result = db.getRows(dbPath, tableName, { limit, offset, orderBy, orderDir });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Insert a row
  app.post("/api/db/:env/rows/:table", (req: Request, res: Response) => {
    try {
      // PROD read-only enforcement (check both URL param and server env)
      if (req.params.env === "prod" || isProdEnv()) {
        return res.status(403).json({ 
          error: "Database writes are disabled in production mode",
          code: "PROD_READ_ONLY"
        });
      }
      
      const dbPath = req.query.path as string;
      const tableName = req.params.table;
      const data = req.body;
      
      if (!dbPath) {
        return res.status(400).json({ error: "Database path is required" });
      }
      
      const result = db.insertRow(dbPath, tableName, data);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update a row
  app.put("/api/db/:env/rows/:table/:pk", (req: Request, res: Response) => {
    try {
      // PROD read-only enforcement (check both URL param and server env)
      if (req.params.env === "prod" || isProdEnv()) {
        return res.status(403).json({ 
          error: "Database writes are disabled in production mode",
          code: "PROD_READ_ONLY"
        });
      }
      
      const dbPath = req.query.path as string;
      const tableName = req.params.table;
      const pkValue = req.params.pk;
      const pkColumn = req.query.pkColumn as string;
      const data = req.body;
      
      if (!dbPath || !pkColumn) {
        return res.status(400).json({ error: "Database path and pkColumn are required" });
      }
      
      const result = db.updateRow(dbPath, tableName, pkColumn, pkValue, data);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete a row
  app.delete("/api/db/:env/rows/:table/:pk", (req: Request, res: Response) => {
    try {
      // PROD read-only enforcement (check both URL param and server env)
      if (req.params.env === "prod" || isProdEnv()) {
        return res.status(403).json({ 
          error: "Database writes are disabled in production mode",
          code: "PROD_READ_ONLY"
        });
      }
      
      const dbPath = req.query.path as string;
      const tableName = req.params.table;
      const pkValue = req.params.pk;
      const pkColumn = req.query.pkColumn as string;
      
      if (!dbPath || !pkColumn) {
        return res.status(400).json({ error: "Database path and pkColumn are required" });
      }
      
      const result = db.deleteRow(dbPath, tableName, pkColumn, pkValue);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Execute raw SQL query
  app.post("/api/db/:env/query", (req: Request, res: Response) => {
    try {
      const dbPath = req.query.path as string;
      const { sql } = req.body;
      
      if (!dbPath) {
        return res.status(400).json({ error: "Database path is required" });
      }
      
      if (!sql) {
        return res.status(400).json({ error: "SQL query is required" });
      }
      
      // PROD read-only enforcement: only allow SELECT/PRAGMA/EXPLAIN
      if (req.params.env === "prod" || isProdEnv()) {
        const trimmedSql = sql.trim().toLowerCase();
        // Block INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, TRUNCATE, etc.
        const writeKeywords = ["insert", "update", "delete", "drop", "create", "alter", "truncate", "replace", "merge"];
        const isWriteQuery = writeKeywords.some(kw => trimmedSql.startsWith(kw));
        const isAllowed = trimmedSql.startsWith("select") || trimmedSql.startsWith("pragma") || trimmedSql.startsWith("explain");
        
        if (isWriteQuery || !isAllowed) {
          return res.status(403).json({ 
            error: "Only SELECT, PRAGMA, and EXPLAIN queries are allowed in production mode",
            code: "PROD_READ_ONLY"
          });
        }
      }
      
      const result = db.executeQuery(dbPath, sql);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============ AI AGENT VISIBILITY ENDPOINTS ============

  // Get all agent profiles
  app.get("/api/ai/agent-profiles", (_req: Request, res: Response) => {
    try {
      const profiles = aiDb.getAgentProfiles();
      res.json(profiles);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get single agent profile
  app.get("/api/ai/agent-profiles/:id", (req: Request, res: Response) => {
    try {
      const profile = aiDb.getAgentProfile(req.params.id);
      if (!profile) {
        return res.status(404).json({ error: "Agent profile not found" });
      }
      res.json(profile);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Main SSE stream for all AI events (used by frontend)
  app.get("/api/ai/stream", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    
    // Send initial state
    const agents = aiDb.getAgentProfiles();
    const runs = aiDb.getRecentRuns(20);
    const events = runs.length > 0 
      ? runs.flatMap(r => aiDb.getRunEvents(r.id, 50))
      : [];
    
    const initData = {
      agents,
      runs,
      events: events.slice(-100)
    };
    res.write(`event: init\ndata: ${JSON.stringify(initData)}\n\n`);
    
    // Subscribe to all events
    const unsubscribe = subscribeToAllRuns((event) => {
      res.write(`event: run_event\ndata: ${JSON.stringify(event)}\n\n`);
    });
    
    // Heartbeat every 30s
    const heartbeat = setInterval(() => {
      res.write(`:heartbeat\n\n`);
    }, 30000);
    
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // Update agent profile
  app.put("/api/ai/agent-profiles/:id", (req: Request, res: Response) => {
    try {
      const profile = aiDb.updateAgentProfile(req.params.id, req.body);
      if (!profile) {
        return res.status(404).json({ error: "Agent profile not found" });
      }
      res.json(profile);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Create a new AI run
  app.post("/api/ai/runs", (req: Request, res: Response) => {
    try {
      const { mode, goal, agents, fast_mode, run_key } = req.body;
      
      if (!mode) {
        return res.status(400).json({ error: "Mode is required" });
      }
      
      const id = `run_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      
      const run = aiDb.createRun({
        id,
        run_key: run_key || null,
        mode,
        status: "queued",
        goal: goal || null,
        agents: agents || [],
        fast_mode: fast_mode || false,
        created_by_user_id: null
      });
      
      res.status(201).json(run);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get AI run by ID
  app.get("/api/ai/runs/:id", (req: Request, res: Response) => {
    try {
      const run = aiDb.getRun(req.params.id);
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }
      res.json(run);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get recent runs
  app.get("/api/ai/runs", (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const runs = aiDb.getRecentRuns(limit);
      res.json(runs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get run events (polling fallback)
  app.get("/api/ai/runs/:id/events", (req: Request, res: Response) => {
    try {
      const cursor = req.query.cursor ? parseInt(req.query.cursor as string) : undefined;
      const limit = parseInt(req.query.limit as string) || 100;
      
      const events = aiDb.getRunEvents(req.params.id, { cursor, limit });
      res.json({
        events,
        cursor: events.length > 0 ? events[events.length - 1].id : cursor
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // SSE stream for run events
  app.get("/api/ai/runs/:id/stream", (req: Request, res: Response) => {
    const runId = req.params.id;
    
    const run = aiDb.getRun(runId);
    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }
    
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    
    // Send initial state
    const agentStatuses = aiDb.getLatestAgentStatuses(runId);
    const initialData = {
      type: "init",
      run,
      agentStatuses: Object.fromEntries(agentStatuses)
    };
    res.write(`event: init\ndata: ${JSON.stringify(initialData)}\n\n`);
    
    // Subscribe to events
    const unsubscribe = subscribeToRun(runId, (event) => {
      res.write(`event: event\ndata: ${JSON.stringify(event)}\n\n`);
    });
    
    // Heartbeat every 30s
    const heartbeat = setInterval(() => {
      res.write(`:heartbeat\n\n`);
    }, 30000);
    
    // Cleanup on close
    req.on("close", () => {
      unsubscribe();
      clearInterval(heartbeat);
    });
  });

  // Update run status (internal use)
  app.post("/api/ai/runs/:id/status", (req: Request, res: Response) => {
    try {
      const { status, message } = req.body;
      
      if (!status) {
        return res.status(400).json({ error: "Status is required" });
      }
      
      const event = emitRunStatus(req.params.id, status, message);
      res.json({ success: true, event });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Emit event for a run (internal use)
  app.post("/api/ai/runs/:id/events", (req: Request, res: Response) => {
    try {
      const { agent_id, type, message, data } = req.body;
      
      if (!type || !message) {
        return res.status(400).json({ error: "Type and message are required" });
      }
      
      const event = aiDb.addRunEvent({
        run_id: req.params.id,
        agent_id: agent_id || null,
        type,
        message,
        data: data || {}
      });
      
      res.status(201).json(event);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get agent roster (current status of all agents for a run)
  app.get("/api/ai/runs/:id/roster", (req: Request, res: Response) => {
    try {
      const runId = req.params.id;
      const run = aiDb.getRun(runId);
      
      if (!run) {
        return res.status(404).json({ error: "Run not found" });
      }
      
      const profiles = aiDb.getAgentProfiles();
      const agentStatuses = aiDb.getLatestAgentStatuses(runId);
      const latestEvents = aiDb.getLatestEventPerAgent(runId);
      
      const roster = profiles
        .filter(p => p.enabled && run.agents.includes(p.id))
        .map(profile => {
          const statusInfo = agentStatuses.get(profile.id);
          const latestEvent = latestEvents.get(profile.id);
          
          return {
            id: profile.id,
            display_name: profile.display_name,
            model: profile.model,
            status: statusInfo?.status || "idle",
            current_action: latestEvent?.message || null,
            last_updated: latestEvent?.created_at || null
          };
        });
      
      res.json(roster);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // Run Capsules API (SimpleAide)
  // ============================================

  function getProjectPath(projectId: string): string {
    const projectPath = path.join(PROJECTS_DIR, projectId);
    const resolved = path.resolve(projectPath);
    if (!resolved.startsWith(path.resolve(PROJECTS_DIR))) {
      throw new Error("Invalid project path");
    }
    return resolved;
  }

  function validateRunOwnership(runId: string, projectId: string): boolean {
    const run = getAgentRun(runId);
    return run !== null && run.project_id === projectId;
  }

  app.post("/api/projects/:projectId/runs", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const projectPath = getProjectPath(projectId);
      
      if (!fs.existsSync(projectPath)) {
        return res.status(404).json({ error: "Project not found" });
      }

      await initDefaultConfigs(projectPath);
      const config = loadProjectConfig(projectPath);
      
      const runId = randomUUID();
      const capsule = capsuleProvider.createCapsule(runId, projectPath, config.immutablePaths || []);
      
      const checkpointRef = await createStashCheckpoint(projectPath, `run-${runId}-start`);
      
      createAgentRun({
        id: runId,
        project_id: projectId,
        status: "running",
        model_used: req.body.model || "default",
        git_checkpoint_before: checkpointRef || null
      });

      res.json({ 
        runId, 
        status: "running",
        checkpoint: checkpointRef || null
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/projects/:projectId/runs", (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const runs = listAgentRuns(projectId, limit);
      res.json(runs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/projects/:projectId/runs/:runId", (req: Request, res: Response) => {
    try {
      const { projectId, runId } = req.params;
      
      if (!validateRunOwnership(runId, projectId)) {
        return res.status(404).json({ error: "Run not found" });
      }
      
      const run = getAgentRun(runId);
      res.json(run);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/projects/:projectId/runs/:runId/stop", (req: Request, res: Response) => {
    try {
      const { projectId, runId } = req.params;
      
      if (!validateRunOwnership(runId, projectId)) {
        return res.status(404).json({ error: "Run not found" });
      }
      
      capsuleProvider.destroyCapsule(runId);
      updateAgentRun(runId, { status: "stopped" });
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/projects/:projectId/runs/:runId/patch", (req: Request, res: Response) => {
    try {
      const { projectId, runId } = req.params;
      
      if (!validateRunOwnership(runId, projectId)) {
        return res.status(404).json({ error: "Run not found" });
      }
      
      const capsule = capsuleProvider.getCapsule(runId);
      if (!capsule) {
        return res.status(404).json({ error: "Capsule not found" });
      }
      
      const patch = capsule.exportPatch();
      res.json({ patch });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/projects/:projectId/runs/:runId/apply/token", (req: Request, res: Response) => {
    try {
      const { projectId, runId } = req.params;
      
      if (!validateRunOwnership(runId, projectId)) {
        return res.status(404).json({ error: "Run not found" });
      }
      
      const projectPath = getProjectPath(projectId);
      const capsule = capsuleProvider.getCapsule(runId);
      
      if (!capsule) {
        return res.status(404).json({ error: "Capsule not found" });
      }
      
      const patch = capsule.exportPatch();
      const token = createApprovalToken(runId, projectPath);
      
      res.json({ 
        token, 
        expiresIn: 300,
        hasChanges: patch.trim().length > 0,
        changedFiles: capsule.listModified(),
        deletedFiles: capsule.listDeleted()
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/projects/:projectId/runs/:runId/apply", async (req: Request, res: Response) => {
    try {
      const { projectId, runId } = req.params;
      const { approvalToken } = req.body;
      
      if (!validateRunOwnership(runId, projectId)) {
        return res.status(404).json({ error: "Run not found" });
      }
      
      if (!approvalToken) {
        return res.status(400).json({ error: "Approval token required. Get one from GET /apply/token first." });
      }
      
      if (!validateApprovalToken(runId, approvalToken)) {
        return res.status(403).json({ error: "Invalid or expired approval token" });
      }
      
      const projectPath = getProjectPath(projectId);
      const capsule = capsuleProvider.getCapsule(runId);
      
      if (!capsule) {
        return res.status(404).json({ error: "Capsule not found" });
      }
      
      const modifiedFiles = capsule.listModified();
      const deletedFiles = capsule.listDeleted();
      
      for (const filePath of modifiedFiles) {
        const content = capsule.read(filePath);
        if (content !== null) {
          const fullPath = path.join(projectPath, filePath);
          const dir = path.dirname(fullPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          fs.writeFileSync(fullPath, content, "utf-8");
        }
      }
      
      for (const filePath of deletedFiles) {
        const fullPath = path.join(projectPath, filePath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      }
      
      const patch = capsule.exportPatch();
      updateAgentRun(runId, { 
        status: "applied",
        patch_applied: patch 
      });
      capsuleProvider.destroyCapsule(runId);
      clearApprovalToken(runId);
      
      res.json({ 
        success: true,
        appliedFiles: modifiedFiles.length,
        deletedFiles: deletedFiles.length
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/projects/:projectId/runs/:runId/rollback/token", (req: Request, res: Response) => {
    try {
      const { projectId, runId } = req.params;
      
      if (!validateRunOwnership(runId, projectId)) {
        return res.status(404).json({ error: "Run not found" });
      }
      
      const projectPath = getProjectPath(projectId);
      const run = getAgentRun(runId);
      
      if (!run?.git_checkpoint_before) {
        return res.status(400).json({ error: "No checkpoint available for rollback" });
      }
      
      const token = createApprovalToken(runId, projectPath);
      
      res.json({ 
        token, 
        expiresIn: 300,
        checkpoint: run.git_checkpoint_before
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/projects/:projectId/runs/:runId/rollback", async (req: Request, res: Response) => {
    try {
      const { projectId, runId } = req.params;
      const { approvalToken } = req.body;
      
      if (!validateRunOwnership(runId, projectId)) {
        return res.status(404).json({ error: "Run not found" });
      }
      
      if (!approvalToken) {
        return res.status(400).json({ error: "Approval token required. Get one from GET /rollback/token first." });
      }
      
      if (!validateApprovalToken(runId, approvalToken)) {
        return res.status(403).json({ error: "Invalid or expired approval token" });
      }
      
      const projectPath = getProjectPath(projectId);
      const run = getAgentRun(runId);
      
      if (!run?.git_checkpoint_before) {
        return res.status(400).json({ error: "No checkpoint available for rollback" });
      }
      
      const result = await rollbackToCheckpoint(projectPath, run.git_checkpoint_before);
      
      if (!result.success) {
        return res.status(400).json({ error: "Failed to rollback", details: result.error });
      }
      
      updateAgentRun(runId, { status: "rolled_back" });
      capsuleProvider.destroyCapsule(runId);
      clearApprovalToken(runId);
      
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/projects/:projectId/runs/:runId/pending", (req: Request, res: Response) => {
    try {
      const { projectId, runId } = req.params;
      
      if (!validateRunOwnership(runId, projectId)) {
        return res.status(404).json({ error: "Run not found" });
      }
      
      const capsule = capsuleProvider.getCapsule(runId);
      if (!capsule) {
        return res.json({ pending: [] });
      }
      
      const pendingWrites = capsule.getPendingWrites();
      const pending: Array<{ key: string; filePath: string; reason: string }> = [];
      pendingWrites.forEach((value, key) => {
        pending.push({ key, filePath: value.filePath, reason: value.reason });
      });
      
      res.json({ pending });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/projects/:projectId/runs/:runId/confirm/:confirmKey", (req: Request, res: Response) => {
    try {
      const { projectId, runId, confirmKey } = req.params;
      const { approve } = req.body;
      
      if (!validateRunOwnership(runId, projectId)) {
        return res.status(404).json({ error: "Run not found" });
      }
      
      const capsule = capsuleProvider.getCapsule(runId);
      if (!capsule) {
        return res.status(404).json({ error: "Capsule not found" });
      }
      
      const resolved = capsule.resolvePending(confirmKey, approve === true);
      if (!resolved) {
        return res.status(404).json({ error: "Pending confirmation not found" });
      }
      
      const remainingPending = capsule.getPendingWrites();
      if (remainingPending.size === 0) {
        const run = getAgentRun(runId);
        if (run?.status === "needs_approval") {
          updateAgentRun(runId, { status: "running" });
        }
      }
      
      res.json({ success: true, approved: approve, remainingPending: remainingPending.size });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/projects/:projectId/runs/:runId/audit", (req: Request, res: Response) => {
    try {
      const { projectId, runId } = req.params;
      
      if (!validateRunOwnership(runId, projectId)) {
        return res.status(404).json({ error: "Run not found" });
      }
      
      const limit = parseInt(req.query.limit as string) || 100;
      const logs = listToolAuditLog(runId, limit);
      res.json(logs);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/projects/:projectId/index/build", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const projectPath = getProjectPath(projectId);
      
      if (!fs.existsSync(projectPath)) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      const stats = await buildIndex(projectPath, projectId);
      res.json({ success: true, ...stats });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/projects/:projectId/index/search", (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const query = req.query.q as string;
      const limit = parseInt(req.query.limit as string) || 20;
      
      if (!query) {
        return res.status(400).json({ error: "Query parameter 'q' is required" });
      }
      
      const results = searchChunks(projectId, query, limit);
      res.json(results);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/projects/:projectId/index/meta", (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const meta = getIndexMeta(projectId);
      res.json(meta || { indexed: false });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== Template Catalog v1 Routes ====================

  app.get("/api/v1/templates", (_req: Request, res: Response) => {
    try {
      const templates = listTemplates();
      res.json({ templates });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/v1/templates/:templateId", (req: Request, res: Response) => {
    try {
      const { templateId } = req.params;
      const template = loadTemplate(templateId);
      
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }
      
      const validation = validateTemplate(template);
      res.json({ template, validation });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/v1/projects/:projectId/templates/apply", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const { templateId, variables = {}, approvalToken } = req.body;
      
      if (!templateId) {
        return res.status(400).json({ error: "templateId is required" });
      }
      
      const projectPath = getProjectPath(projectId);
      if (!fs.existsSync(projectPath)) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      const result = await applyTemplateInCapsule({
        projectId,
        projectPath,
        templateId,
        variables,
        approvalToken
      });
      
      if (result.needsApproval) {
        return res.status(202).json({
          status: "needs_approval",
          runId: result.runId,
          approvalReasons: result.approvalReasons,
          createdFiles: result.createdFiles,
          requiresSecrets: result.requiresSecrets,
          message: "Some files require approval before writing"
        });
      }
      
      res.json({
        status: "staged",
        runId: result.runId,
        createdFiles: result.createdFiles,
        patchSummary: result.patchSummary,
        capabilitiesUpdated: result.capabilitiesUpdated,
        requiresSecrets: result.requiresSecrets,
        postInstallSteps: result.postInstallSteps,
        message: "Template staged in capsule. Call POST /api/projects/:projectId/runs/:runId/apply to commit changes to project."
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/v1/projects/:projectId/capabilities", (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const projectPath = getProjectPath(projectId);
      
      if (!fs.existsSync(projectPath)) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      const capabilities = readCapabilities(projectPath);
      res.json(capabilities);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/v1/tools/templates", (_req: Request, res: Response) => {
    try {
      res.json({ tools: templateToolDefinitions });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/v1/projects/:projectId/runs/:runId/tools/exec", async (req: Request, res: Response) => {
    try {
      const { projectId, runId } = req.params;
      const { toolName, input = {}, approvalToken } = req.body;
      
      if (!toolName) {
        return res.status(400).json({ error: "toolName is required" });
      }
      
      if (!toolName.startsWith("templates.") && !toolName.startsWith("capabilities.")) {
        return res.status(400).json({ error: "Unknown tool namespace" });
      }
      
      const projectPath = getProjectPath(projectId);
      if (!fs.existsSync(projectPath)) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      const result = await dispatchTemplateTool(toolName, input, {
        runId,
        projectId,
        projectPath,
        approvalToken
      });
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/v1/projects/import/git", async (req: Request, res: Response) => {
    try {
      const { name, git, auth, options = {}, bootstrap: bootstrapOpts = {} } = req.body;
      
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return res.status(400).json({ error: "name is required" });
      }
      if (!git?.url) {
        return res.status(400).json({ error: "git.url is required" });
      }
      
      try {
        validateRemoteUrl(git.url);
      } catch (error: any) {
        return res.status(400).json({ error: error.message });
      }
      
      const projectId = `${name.toLowerCase().replace(/[^a-z0-9-]/g, "-")}-${nanoid(8)}`;
      
      let pat: string | undefined;
      if (auth?.type === "pat" && auth.secretKey) {
        const secrets = getSecrets();
        pat = secrets[auth.secretKey];
        if (!pat) {
          return res.status(400).json({ error: `Secret ${auth.secretKey} not found` });
        }
      }
      
      res.status(202).json({
        ok: true,
        data: {
          projectId,
          status: "queued",
          message: "Clone operation started. Poll /api/v1/projects/:projectId/git/ops for status."
        }
      });
      
      (async () => {
        try {
          const cloneResult = await cloneRepository({
            projectId,
            projectName: name,
            url: git.url,
            branch: git.branch,
            authRef: auth?.secretKey,
            pat,
            depth: options.depth ?? 1,
            recurseSubmodules: options.recurseSubmodules ?? true,
          });
          
          if (cloneResult.success && cloneResult.projectPath) {
            const stack = bootstrapProject(cloneResult.projectPath);
            
            try {
              await buildIndex(projectId, cloneResult.projectPath);
            } catch (e) {
              console.error(`[git-import] Index build failed for ${projectId}:`, e);
            }
            
            const projectsFile = path.join(PROJECTS_DIR, "projects.json");
            let projectsData: any = { projects: [], activeProjectId: null };
            if (fs.existsSync(projectsFile)) {
              projectsData = JSON.parse(fs.readFileSync(projectsFile, "utf-8"));
            }
            
            projectsData.projects.push({
              id: projectId,
              name: name,
              path: cloneResult.projectPath,
              createdAt: new Date().toISOString(),
              lastOpenedAt: new Date().toISOString(),
              remote: git.url,
            });
            projectsData.activeProjectId = projectId;
            
            fs.writeFileSync(projectsFile, JSON.stringify(projectsData, null, 2));
            
            console.log(`[git-import] Project ${projectId} created successfully. Stack: ${stack.language}/${stack.framework || "unknown"}`);
          } else {
            console.error(`[git-import] Clone failed for ${projectId}:`, cloneResult.error);
          }
        } catch (error) {
          console.error(`[git-import] Error during import for ${projectId}:`, error);
        }
      })();
      
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/v1/projects/:projectId/git/ops", (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const limit = parseInt(req.query.limit as string) || 20;
      
      const ops = listGitOps(projectId, limit);
      res.json({ ops });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/v1/projects/:projectId/git/ops/:opId", (req: Request, res: Response) => {
    try {
      const { projectId, opId } = req.params;
      const tailLines = parseInt(req.query.tailLines as string) || 50;
      
      const op = getGitOp(opId);
      if (!op || op.project_id !== projectId) {
        return res.status(404).json({ error: "Git operation not found" });
      }
      
      let logTail = "";
      if (op.log_path) {
        logTail = getGitOpLogTail(op.log_path, tailLines);
      }
      
      res.json({
        ...op,
        logTail,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/v1/projects/:projectId/git/remote", (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      const remote = getProjectRemote(projectId);
      
      if (!remote) {
        return res.status(404).json({ error: "No remote configured for this project" });
      }
      
      res.json({
        provider: remote.provider,
        remoteUrl: remote.remote_url,
        defaultBranch: remote.default_branch,
        lastFetchedAt: remote.last_fetched_at,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/v1/projects/:projectId/git/pull", async (req: Request, res: Response) => {
    try {
      const { projectId } = req.params;
      
      const projectPath = getProjectPath(projectId);
      if (!fs.existsSync(projectPath)) {
        return res.status(404).json({ error: "Project not found" });
      }
      
      const remote = getProjectRemote(projectId);
      let pat: string | undefined;
      
      if (remote?.auth_ref) {
        const secrets = getSecrets();
        pat = secrets[remote.auth_ref];
      }
      
      const result = await pullRepository({
        projectId,
        projectPath,
        pat,
      });
      
      if (result.success) {
        try {
          await incrementalUpdate(projectId, projectPath);
        } catch (e) {
          console.error(`[git-pull] Index update failed for ${projectId}:`, e);
        }
        
        res.json({
          ok: true,
          gitOpId: result.gitOpId,
          message: "Pull completed successfully",
        });
      } else {
        res.status(400).json({
          ok: false,
          gitOpId: result.gitOpId,
          error: result.error,
        });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/v1/projects/:projectId/git/validate-url", (req: Request, res: Response) => {
    try {
      const { url } = req.body;
      
      if (!url) {
        return res.status(400).json({ error: "url is required" });
      }
      
      try {
        const validated = validateRemoteUrl(url);
        res.json({
          valid: true,
          sanitizedUrl: validated.sanitizedUrl,
          provider: validated.provider,
          owner: validated.owner,
          repo: validated.repo,
        });
      } catch (error: any) {
        res.json({
          valid: false,
          error: error.message,
        });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
