import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { runTask, applyTaskDiff } from "./taskRunner";
import { createTaskSchema, settingsSchema, defaultSettings, type Settings, createRunSchema, executeStepSchema, rerunSchema } from "@shared/schema";
import * as fs from "fs";
import * as path from "path";
import { vaultExists, createVault, unlockVault, saveVault, setSecret, deleteSecret, listSecretKeys, maskSecret, deleteVault } from "./secrets";
import { runsStorage } from "./runs";
import { runAutoWorkflow, applyDiffWithBackup, revertDiff, isWorkflowRunning } from "./autoRunner";
import * as db from "./database";

const PROJECT_ROOT = path.resolve(process.cwd());
const SETTINGS_DIR = path.join(PROJECT_ROOT, ".simpleaide");
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

  // ==================== GLOBAL STATUS ENDPOINT ====================
  app.get("/api/status", async (req: Request, res: Response) => {
    try {
      // Environment (DEV for now, PROD support coming)
      const env = process.env.SIMPLEAIDE_ENV === "prod" ? "PROD" : "DEV";
      
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
      
      // LLM backends status
      let llmStatus: { online: number; total: number; backends: Array<{ id: string; name: string; online: boolean }> } = {
        online: 0,
        total: 0,
        backends: [],
      };
      try {
        const settings = loadSettings();
        const backends = settings.aiAgents?.backends || [];
        llmStatus.total = backends.length;
        llmStatus.backends = backends.map((b: any) => ({
          id: b.id,
          name: b.name,
          online: true, // We don't have real health checks yet, assume online if configured
        }));
        llmStatus.online = backends.length; // Assume all online for now
      } catch {
        // No settings
      }
      
      // Server info
      const serverInfo = {
        port: process.env.PORT || 5000,
        nodeEnv: process.env.NODE_ENV || "development",
        uptime: process.uptime(),
      };
      
      res.json({
        env,
        server: serverInfo,
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
      const env = req.params.env;
      if (env === "prod") {
        return res.status(403).json({ error: "Production database is read-only" });
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
      const env = req.params.env;
      if (env === "prod") {
        return res.status(403).json({ error: "Production database is read-only" });
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
      const env = req.params.env;
      if (env === "prod") {
        return res.status(403).json({ error: "Production database is read-only" });
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
      const env = req.params.env;
      const dbPath = req.query.path as string;
      const { sql } = req.body;
      
      if (!dbPath) {
        return res.status(400).json({ error: "Database path is required" });
      }
      
      if (!sql) {
        return res.status(400).json({ error: "SQL query is required" });
      }
      
      // In production, only allow SELECT queries
      if (env === "prod") {
        const trimmedSql = sql.trim().toLowerCase();
        if (!trimmedSql.startsWith("select") && !trimmedSql.startsWith("pragma") && !trimmedSql.startsWith("explain")) {
          return res.status(403).json({ error: "Only SELECT queries allowed in production" });
        }
      }
      
      const result = db.executeQuery(dbPath, sql);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
