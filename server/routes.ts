import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { runTask, applyTaskDiff } from "./taskRunner";
import { createTaskSchema, settingsSchema, defaultSettings, type Settings } from "@shared/schema";
import * as fs from "fs";
import * as path from "path";
import { vaultExists, createVault, unlockVault, saveVault, setSecret, deleteSecret, listSecretKeys, maskSecret } from "./secrets";

const PROJECT_ROOT = path.resolve(process.cwd());
const SETTINGS_DIR = path.join(PROJECT_ROOT, ".simpleide");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

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
  // File system routes
  app.get("/api/files", (req: Request, res: Response) => {
    const rootDir = process.cwd();
    const tree = getFileTree(rootDir);
    res.json(tree);
  });

  app.get("/api/files/content", (req: Request, res: Response) => {
    const filePath = req.query.path as string;
    if (!filePath) {
      return res.status(400).json({ error: "Path is required" });
    }
    
    const rootDir = path.resolve(process.cwd());
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
    const { diffName } = req.body;
    
    if (!diffName) {
      return res.status(400).json({ error: "diffName is required" });
    }
    
    const result = await applyTaskDiff(taskId, diffName);
    
    if (result.success) {
      res.json({ success: true, message: "Diff applied successfully" });
    } else {
      res.status(400).json({ success: false, error: result.error });
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
    
    const rootDir = path.resolve(process.cwd());
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
    
    const rootDir = path.resolve(process.cwd());
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
    
    const rootDir = path.resolve(process.cwd());
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
    
    const rootDir = path.resolve(process.cwd());
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
    
    const rootDir = path.resolve(process.cwd());
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
    
    const rootDir = path.resolve(process.cwd());
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

  // Helper to read settings
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
  
  // In-memory storage for the unlocked vault session
  let currentVault: any = null;
  let currentMasterPassword: string | null = null;

  // Check if vault exists
  app.get("/api/secrets/status", (req: Request, res: Response) => {
    res.json({
      exists: vaultExists(),
      unlocked: currentVault !== null,
    });
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
      
      res.json({ success: true, message: "Vault unlocked" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Lock vault
  app.post("/api/secrets/lock", (req: Request, res: Response) => {
    currentVault = null;
    currentMasterPassword = null;
    res.json({ success: true, message: "Vault locked" });
  });

  // List secrets (masked values)
  app.get("/api/secrets", (req: Request, res: Response) => {
    if (!currentVault) {
      return res.status(401).json({ error: "Vault is locked" });
    }
    
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

  return httpServer;
}
