import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execGit, getDefaultBranch, ExecGitResult } from "./execGit";
import { validateRemoteUrl, sanitizeRemoteUrl, ValidatedUrl } from "./gitUrl";
import {
  createGitOp,
  updateGitOp,
  getGitOp,
  createProjectRemote,
  updateProjectRemoteLastFetched,
  ProjectGitOp,
  GitOpType,
} from "../db";

const PROJECTS_ROOT = path.join(process.cwd(), "projects");
const STAGING_ROOT = path.join(PROJECTS_ROOT, ".staging");

export interface CloneOptions {
  projectId: string;
  projectName: string;
  url: string;
  branch?: string;
  authRef?: string;
  pat?: string;
  depth?: number;
  recurseSubmodules?: boolean;
  opId?: string;
}

export interface CloneResult {
  success: boolean;
  gitOpId: string;
  projectPath?: string;
  error?: string;
  logPath?: string;
}

export interface PullOptions {
  projectId: string;
  projectPath: string;
  pat?: string;
}

export interface PullResult {
  success: boolean;
  gitOpId: string;
  error?: string;
  logPath?: string;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function generateOpId(): string {
  return `gitop_${crypto.randomBytes(8).toString("hex")}`;
}

function getLogPath(projectId: string, opId: string): string {
  const projectGitLogsDir = path.join(PROJECTS_ROOT, projectId, ".simpleaide", "git");
  ensureDir(projectGitLogsDir);
  return path.join(projectGitLogsDir, `${opId}.log`);
}

function getLegacyLogPath(opId: string): string {
  const legacyDir = path.join(process.cwd(), ".simpleaide", "git-logs");
  ensureDir(legacyDir);
  return path.join(legacyDir, `${opId}.log`);
}

function appendLog(logPath: string, message: string): void {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
}

export async function cloneRepository(options: CloneOptions): Promise<CloneResult> {
  const { projectId, projectName, url, branch, authRef, pat, depth = 1, recurseSubmodules = true, opId: providedOpId } = options;
  
  if (pat && !/^https:\/\//i.test(url.trim())) {
    return { success: false, gitOpId: "", error: "VALIDATION_FAILED: PAT authentication requires https:// URLs" };
  }
  
  let validated: ValidatedUrl;
  try {
    validated = validateRemoteUrl(url);
  } catch (error: any) {
    return { success: false, gitOpId: "", error: error.message };
  }
  
  const opId = providedOpId || generateOpId();
  const logPath = getLegacyLogPath(opId);
  
  if (!providedOpId) {
    createGitOp({ id: opId, project_id: projectId, op: "clone" });
  }
  appendLog(logPath, `Starting clone for project: ${projectId}`);
  appendLog(logPath, `URL: ${validated.sanitizedUrl}`);
  appendLog(logPath, `Provider: ${validated.provider}`);
  
  updateGitOp(opId, { status: "running", stage: "validate_url", started_at: new Date().toISOString(), log_path: logPath });
  
  ensureDir(STAGING_ROOT);
  const stagingDir = path.join(STAGING_ROOT, `${projectId}_${Date.now()}`);
  const repoDir = path.join(stagingDir, "repo");
  ensureDir(stagingDir);
  
  appendLog(logPath, `Staging directory: ${stagingDir}`);
  
  let movedSuccessfully = false;
  let finalPath = "";
  
  try {
    let targetBranch = branch;
    if (!targetBranch) {
      try {
        appendLog(logPath, "Detecting default branch...");
        targetBranch = await getDefaultBranch(validated.sanitizedUrl, pat);
        appendLog(logPath, `Default branch: ${targetBranch}`);
      } catch (error: any) {
        appendLog(logPath, `Failed to detect branch, defaulting to 'main': ${error.message}`);
        targetBranch = "main";
      }
    }
    
    const cloneArgs: string[] = ["clone"];
    if (depth > 0) {
      cloneArgs.push(`--depth=${depth}`);
    }
    cloneArgs.push("--branch", targetBranch);
    if (recurseSubmodules) {
      cloneArgs.push("--recurse-submodules");
    }
    cloneArgs.push(validated.sanitizedUrl, repoDir);
    
    appendLog(logPath, `Clone command: git ${cloneArgs.join(" ")}`);
    updateGitOp(opId, { stage: "clone_start" });
    
    let result: ExecGitResult;
    try {
      result = await execGit(cloneArgs, { pat, timeoutMs: 10 * 60 * 1000 });
    } catch (error: any) {
      appendLog(logPath, `Clone error: ${error.message}`);
      updateGitOp(opId, { status: "failed", ended_at: new Date().toISOString(), error: error.message });
      return { success: false, gitOpId: opId, error: error.message, logPath };
    }
    
    appendLog(logPath, `Exit code: ${result.exitCode}`);
    if (result.stdout) appendLog(logPath, `stdout: ${result.stdout}`);
    if (result.stderr) appendLog(logPath, `stderr: ${result.stderr}`);
    if (result.timedOut) appendLog(logPath, "Operation timed out");
    if (result.truncated) appendLog(logPath, "Output was truncated");
    
    if (result.exitCode !== 0) {
      const errorMsg = result.timedOut ? "Clone timed out" : (result.stderr || "Clone failed");
      updateGitOp(opId, { status: "failed", ended_at: new Date().toISOString(), error: errorMsg });
      return { success: false, gitOpId: opId, error: errorMsg, logPath };
    }
    
    const gitDir = path.join(repoDir, ".git");
    if (!fs.existsSync(gitDir)) {
      const errorMsg = "Clone completed but .git directory not found";
      appendLog(logPath, errorMsg);
      updateGitOp(opId, { status: "failed", ended_at: new Date().toISOString(), error: errorMsg });
      return { success: false, gitOpId: opId, error: errorMsg, logPath };
    }
    
    const verifyResult = await execGit(["rev-parse", "HEAD"], { cwd: repoDir });
    if (verifyResult.exitCode !== 0) {
      const errorMsg = "Clone verification failed: could not read HEAD";
      appendLog(logPath, errorMsg);
      updateGitOp(opId, { status: "failed", ended_at: new Date().toISOString(), error: errorMsg });
      return { success: false, gitOpId: opId, error: errorMsg, logPath };
    }
    appendLog(logPath, `HEAD: ${verifyResult.stdout.trim()}`);
    updateGitOp(opId, { stage: "clone_done" });
    
    ensureDir(PROJECTS_ROOT);
    finalPath = path.join(PROJECTS_ROOT, projectId);
    
    if (fs.existsSync(finalPath)) {
      const errorMsg = "Project directory already exists";
      appendLog(logPath, errorMsg);
      updateGitOp(opId, { status: "failed", ended_at: new Date().toISOString(), error: errorMsg });
      return { success: false, gitOpId: opId, error: errorMsg, logPath };
    }
    
    try {
      fs.renameSync(repoDir, finalPath);
      movedSuccessfully = true;
      appendLog(logPath, `Moved to final path: ${finalPath}`);
    } catch (error: any) {
      appendLog(logPath, `Move failed: ${error.message}`);
      updateGitOp(opId, { status: "failed", ended_at: new Date().toISOString(), error: error.message });
      return { success: false, gitOpId: opId, error: error.message, logPath };
    }
    
    createProjectRemote({
      project_id: projectId,
      provider: validated.provider,
      remote_url: validated.sanitizedUrl,
      default_branch: targetBranch,
      auth_ref: authRef || null,
      last_fetched_at: new Date().toISOString(),
    });
    
    updateGitOp(opId, { status: "succeeded", ended_at: new Date().toISOString() });
    appendLog(logPath, "Clone completed successfully");
    
    return { success: true, gitOpId: opId, projectPath: finalPath, logPath };
  } finally {
    cleanupStaging(stagingDir);
  }
}

export async function pullRepository(options: PullOptions): Promise<PullResult> {
  const { projectId, projectPath, pat } = options;
  
  const opId = generateOpId();
  const logPath = getLogPath(projectId, opId);
  
  createGitOp({ id: opId, project_id: projectId, op: "pull" });
  appendLog(logPath, `Starting pull for project: ${projectId}`);
  appendLog(logPath, `Path: ${projectPath}`);
  
  updateGitOp(opId, { status: "running", stage: "fetch_start", started_at: new Date().toISOString(), log_path: logPath });
  
  const fetchResult = await execGit(["fetch", "--prune"], { cwd: projectPath, pat, timeoutMs: 2 * 60 * 1000 });
  appendLog(logPath, `Fetch exit code: ${fetchResult.exitCode}`);
  if (fetchResult.stderr) appendLog(logPath, `Fetch stderr: ${fetchResult.stderr}`);
  
  if (fetchResult.exitCode !== 0) {
    const errorMsg = fetchResult.stderr || "Fetch failed";
    updateGitOp(opId, { status: "failed", ended_at: new Date().toISOString(), error: errorMsg });
    return { success: false, gitOpId: opId, error: errorMsg, logPath };
  }
  
  updateGitOp(opId, { stage: "pull_start" });
  const pullResult = await execGit(["pull", "--ff-only"], { cwd: projectPath, pat, timeoutMs: 2 * 60 * 1000 });
  appendLog(logPath, `Pull exit code: ${pullResult.exitCode}`);
  if (pullResult.stdout) appendLog(logPath, `Pull stdout: ${pullResult.stdout}`);
  if (pullResult.stderr) appendLog(logPath, `Pull stderr: ${pullResult.stderr}`);
  
  if (pullResult.exitCode !== 0) {
    let errorMsg = pullResult.stderr || "Pull failed";
    if (errorMsg.includes("fatal: Not possible to fast-forward")) {
      errorMsg = "Non-fast-forward update detected. Manual merge or reset required.";
    }
    updateGitOp(opId, { status: "failed", ended_at: new Date().toISOString(), error: errorMsg });
    return { success: false, gitOpId: opId, error: errorMsg, logPath };
  }
  
  updateProjectRemoteLastFetched(projectId);
  updateGitOp(opId, { status: "succeeded", stage: "pull_done", ended_at: new Date().toISOString() });
  appendLog(logPath, "Pull completed successfully");
  
  return { success: true, gitOpId: opId, logPath };
}

function cleanupStaging(stagingDir: string): void {
  try {
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
  } catch {}
}

export function getGitOpStatus(opId: string): ProjectGitOp | null {
  return getGitOp(opId);
}

export function getGitOpLogTail(logPath: string, lines = 50): string {
  if (!fs.existsSync(logPath)) {
    return "";
  }
  
  const content = fs.readFileSync(logPath, "utf-8");
  const allLines = content.split("\n");
  return allLines.slice(-lines).join("\n");
}
