import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { runsStorage } from "./runs";
import { getDefaultLLMAdapter } from "./llm/factory";
import { validatePatch, formatValidationErrors, type TrustLimits } from "./patchValidator";
import type { StepType, StepInput, TaskRun } from "@shared/schema";
import { createRun, getRun, getRunByKey } from "./aiDb";
import { emitRunStatus, emitAgentStatus, emitStep, emitWriteFile, emitError, emitProposeChangeset } from "./aiEvents";
import { PROJECT_ROOT, DATA_DIR } from "./config/paths";

const MAX_FIX_ATTEMPTS = 3;
const BACKUP_DIR = path.join(DATA_DIR, "backups");

const runningWorkflows = new Set<string>();

function isPathSafe(targetPath: string, baseDir: string = PROJECT_ROOT): boolean {
  const resolved = path.resolve(baseDir, targetPath);
  const relative = path.relative(baseDir, resolved);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function sanitizePath(filePath: string): string | null {
  const normalized = path.normalize(filePath).replace(/^[/\\]+/, "");
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return null;
  }
  return normalized;
}

interface AutoRunOptions {
  runId: string;
  goal: string;
  repoPath?: string;
  skipTests?: boolean;
}

interface StepResult {
  success: boolean;
  artifactContent?: string;
  error?: string;
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

function createBackupId(): string {
  return `backup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getBackupDir(backupId: string): string {
  return path.join(BACKUP_DIR, backupId);
}

async function createFileBackup(files: string[], backupId: string): Promise<void> {
  const backupPath = getBackupDir(backupId);
  ensureDir(backupPath);

  const safeFiles: string[] = [];
  for (const file of files) {
    const safePath = sanitizePath(file);
    if (!safePath) {
      console.warn(`Skipping unsafe path in backup: ${file}`);
      continue;
    }
    
    const fullPath = path.join(PROJECT_ROOT, safePath);
    if (!isPathSafe(fullPath)) {
      console.warn(`Skipping path outside project: ${file}`);
      continue;
    }
    
    if (fs.existsSync(fullPath)) {
      const backupFilePath = path.join(backupPath, safePath);
      ensureDir(path.dirname(backupFilePath));
      fs.copyFileSync(fullPath, backupFilePath);
      safeFiles.push(safePath);
    }
  }
  
  const manifestPath = path.join(backupPath, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({ files: safeFiles, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
}

async function restoreFromBackup(backupId: string): Promise<boolean> {
  const backupPath = getBackupDir(backupId);
  const manifestPath = path.join(backupPath, "manifest.json");
  
  if (!fs.existsSync(manifestPath)) {
    return false;
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    for (const file of manifest.files) {
      const safePath = sanitizePath(file);
      if (!safePath) {
        console.warn(`Skipping unsafe path in restore: ${file}`);
        continue;
      }
      
      const backupFilePath = path.join(backupPath, safePath);
      const originalPath = path.join(PROJECT_ROOT, safePath);
      
      if (!isPathSafe(originalPath)) {
        console.warn(`Skipping restore outside project: ${file}`);
        continue;
      }
      
      if (fs.existsSync(backupFilePath)) {
        ensureDir(path.dirname(originalPath));
        fs.copyFileSync(backupFilePath, originalPath);
      }
    }
    return true;
  } catch (error) {
    console.error("Error restoring from backup:", error);
    return false;
  }
}

async function cleanupBackup(backupId: string): Promise<void> {
  const backupPath = getBackupDir(backupId);
  if (fs.existsSync(backupPath)) {
    fs.rmSync(backupPath, { recursive: true, force: true });
  }
}

interface ParseDiffResult {
  files: string[];
  hasUnsafePaths: boolean;
  unsafePaths: string[];
}

function parseFilesFromDiff(diff: string): ParseDiffResult {
  const files: string[] = [];
  const unsafePaths: string[] = [];
  const lines = diff.split("\n");
  
  for (const line of lines) {
    const match = line.match(/^(?:\+\+\+|---)\s+(?:a\/|b\/)?(.+)$/);
    if (match && match[1] !== "/dev/null") {
      const rawPath = match[1];
      const safePath = sanitizePath(rawPath);
      
      if (!safePath) {
        unsafePaths.push(rawPath);
      } else if (!files.includes(safePath)) {
        files.push(safePath);
      }
    }
  }
  
  return {
    files,
    hasUnsafePaths: unsafePaths.length > 0,
    unsafePaths,
  };
}

function checkGitAvailable(): boolean {
  try {
    execSync("git --version", { encoding: "utf-8", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function applyDiff(diff: string, repoPath: string, _runId?: string): Promise<{ success: boolean; error?: string; modifiedFiles?: string[] }> {
  if (!isPathSafe(repoPath)) {
    return { success: false, error: "Invalid repository path" };
  }
  
  const fullRepoPath = path.resolve(PROJECT_ROOT, repoPath);
  if (!fullRepoPath.startsWith(PROJECT_ROOT)) {
    return { success: false, error: "Repository path outside project" };
  }
  
  const parseResult = parseFilesFromDiff(diff);
  if (parseResult.hasUnsafePaths) {
    return { 
      success: false, 
      error: `Diff contains unsafe paths: ${parseResult.unsafePaths.join(", ")}` 
    };
  }
  
  const validation = validatePatch(diff, fullRepoPath);
  if (!validation.valid) {
    return {
      success: false,
      error: `Patch validation failed: ${formatValidationErrors(validation)}`
    };
  }
  
  if (!checkGitAvailable()) {
    return { 
      success: false, 
      error: "Git is required for applying patches. Please install git." 
    };
  }
  
  const tempFile = path.join(fullRepoPath, ".simpleaide-temp.patch");
  
  try {
    ensureDir(path.dirname(tempFile));
    fs.writeFileSync(tempFile, diff);
    
    try {
      execSync(`git apply --check --whitespace=nowarn "${tempFile}"`, {
        cwd: fullRepoPath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (checkError: any) {
      fs.unlinkSync(tempFile);
      return { 
        success: false, 
        error: checkError.stderr || checkError.message || "Patch check failed" 
      };
    }
    
    try {
      execSync(`git apply --whitespace=nowarn "${tempFile}"`, {
        cwd: fullRepoPath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (applyError: any) {
      fs.unlinkSync(tempFile);
      return { 
        success: false, 
        error: applyError.stderr || applyError.message || "Patch apply failed" 
      };
    }
    
    fs.unlinkSync(tempFile);
    
    const filesModified = validation.hunks
      .map(h => h.newPath || h.oldPath)
      .filter((p): p is string => !!p)
      .map(p => sanitizePath(p))
      .filter((p): p is string => !!p);
    
    return { success: true, modifiedFiles: Array.from(new Set(filesModified)) };
  } catch (error: any) {
    try { fs.unlinkSync(tempFile); } catch {}
    return { success: false, error: error.message };
  }
}

async function runTests(repoPath: string): Promise<{ success: boolean; output: string }> {
  if (!isPathSafe(repoPath)) {
    return { success: false, output: "Invalid repository path" };
  }
  
  const fullRepoPath = path.resolve(PROJECT_ROOT, repoPath);
  if (!fullRepoPath.startsWith(PROJECT_ROOT)) {
    return { success: false, output: "Repository path outside project" };
  }
  
  const packageJsonPath = path.join(fullRepoPath, "package.json");
  
  try {
    if (fs.existsSync(packageJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
      if (pkg.scripts?.test) {
        const output = execSync("npm test", {
          cwd: fullRepoPath,
          encoding: "utf-8",
          timeout: 120000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        return { success: true, output };
      }
    }
    return { success: true, output: "No test script found - skipping tests" };
  } catch (error: any) {
    return { 
      success: false, 
      output: error.stdout || error.stderr || error.message || "Test execution failed" 
    };
  }
}

async function executeStep(
  runId: string,
  stepType: StepType,
  goal: string,
  previousArtifacts: Map<string, string>,
  repoPath: string
): Promise<StepResult> {
  const input: StepInput = {
    filesReferenced: [],
    prompt: goal,
  };

  const step = await runsStorage.createStep(runId, stepType, input);
  await runsStorage.updateStepStatus(runId, step.stepNumber, stepType, "running");
  await runsStorage.updateRunStatus(runId, "running");

  const startTime = Date.now();
  
  try {
    let systemPrompt: string;
    let userPrompt: string;

    switch (stepType) {
      case "plan":
        systemPrompt = `You are a planning agent. Create a detailed implementation plan for the given goal.
Output a structured plan with steps, files to modify, and approach.`;
        userPrompt = `Create an implementation plan for: ${goal}\n\nRepository: ${repoPath}`;
        break;

      case "implement":
        const plan = previousArtifacts.get("plan") || "";
        systemPrompt = `You are a code implementation agent. Generate code changes as a unified diff.
Output ONLY valid unified diff format (with --- and +++ headers).`;
        userPrompt = `Implement the following plan:\n\n${plan}\n\nGoal: ${goal}`;
        break;

      case "test":
        systemPrompt = `You are a testing agent. Analyze test results and provide a summary.`;
        userPrompt = `Analyze these test results for the goal "${goal}":\n\n${previousArtifacts.get("test_output") || "No test output available"}`;
        break;

      case "fix":
        const testOutput = previousArtifacts.get("test_output") || "";
        const currentDiff = previousArtifacts.get("implement") || "";
        systemPrompt = `You are a fix agent. Analyze failing tests and generate a fix as unified diff.
Output ONLY valid unified diff format.`;
        userPrompt = `Fix the failing tests based on this output:\n\n${testOutput}\n\nCurrent implementation:\n${currentDiff}\n\nGoal: ${goal}`;
        break;

      case "review":
        const implementDiff = previousArtifacts.get("implement") || previousArtifacts.get("fix") || "";
        systemPrompt = `You are a code review agent. Review the changes and provide feedback.`;
        userPrompt = `Review these changes:\n\n${implementDiff}\n\nGoal: ${goal}`;
        break;

      default:
        throw new Error(`Unknown step type: ${stepType}`);
    }

    const llm = getDefaultLLMAdapter();
    const response = await llm.chat([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    const durationMs = Date.now() - startTime;
    
    const artifactName = getArtifactName(stepType);
    await runsStorage.saveStepArtifact(runId, step.stepNumber, stepType, artifactName, response);
    await runsStorage.updateStepStatus(runId, step.stepNumber, stepType, "passed", durationMs);

    return { success: true, artifactContent: response };
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    await runsStorage.updateStepStatus(runId, step.stepNumber, stepType, "failed", durationMs, error.message);
    return { success: false, error: error.message };
  }
}

function getArtifactName(stepType: StepType): string {
  switch (stepType) {
    case "plan": return "plan.json";
    case "implement": return "patch.diff";
    case "fix": return "fix.diff";
    case "review": return "review.md";
    case "test": return "test_report.txt";
    default: return "output.txt";
  }
}

export async function runAutoWorkflow(options: AutoRunOptions): Promise<TaskRun> {
  const { runId, goal, repoPath = ".", skipTests = false } = options;
  
  if (runningWorkflows.has(runId)) {
    throw new Error("Workflow is already running");
  }
  
  if (!isPathSafe(repoPath)) {
    throw new Error("Invalid repository path");
  }
  
  runningWorkflows.add(runId);
  
  const aiRun = createRun({
    id: `ai_${runId}`,
    run_key: runId,
    mode: "autonomous",
    status: "running",
    goal,
    agents: ["planner", "coder", "testfixer", "reviewer"],
    fast_mode: false,
    created_by_user_id: null
  });
  const aiRunId = aiRun.id;
  
  emitRunStatus(aiRunId, "running", "Starting autonomous workflow");
  
  const artifacts = new Map<string, string>();
  let backupId: string | null = null;
  let fixAttempts = 0;
  let testsPass = false;

  try {
    await runsStorage.updateRunStatus(runId, "running");
    emitStep(aiRunId, "planner", "Starting autonomous Plan → Code → Test → Review workflow");

    const planResult = await executeStep(runId, "plan", goal, artifacts, repoPath);
    if (!planResult.success) {
      await runsStorage.updateRunStatus(runId, "failed", `Planning failed: ${planResult.error}`);
      return (await runsStorage.getRun(runId))!;
    }
    artifacts.set("plan", planResult.artifactContent || "");

    const implementResult = await executeStep(runId, "implement", goal, artifacts, repoPath);
    if (!implementResult.success) {
      await runsStorage.updateRunStatus(runId, "failed", `Implementation failed: ${implementResult.error}`);
      return (await runsStorage.getRun(runId))!;
    }
    artifacts.set("implement", implementResult.artifactContent || "");

    const diff = implementResult.artifactContent || "";
    const parseResult = parseFilesFromDiff(diff);
    
    if (parseResult.hasUnsafePaths) {
      await runsStorage.updateRunStatus(runId, "failed", `Diff contains unsafe paths: ${parseResult.unsafePaths.join(", ")}`);
      runningWorkflows.delete(runId);
      return (await runsStorage.getRun(runId))!;
    }
    
    const filesToModify = parseResult.files;
    
    backupId = createBackupId();
    await createFileBackup(filesToModify, backupId);

    const applyResult = await applyDiff(diff, repoPath, runId);
    if (!applyResult.success) {
      await runsStorage.updateRunStatus(runId, "failed", `Failed to apply diff: ${applyResult.error}`);
      runningWorkflows.delete(runId);
      return (await runsStorage.getRun(runId))!;
    }

    if (!skipTests) {
      while (fixAttempts < MAX_FIX_ATTEMPTS && !testsPass) {
        const testResult = await runTests(repoPath);
        artifacts.set("test_output", testResult.output);

        const testStep = await runsStorage.createStep(runId, "test", { filesReferenced: [], prompt: "Run tests" });
        await runsStorage.updateStepStatus(runId, testStep.stepNumber, "test", "running");
        await runsStorage.saveStepArtifact(runId, testStep.stepNumber, "test", "test_output.txt", testResult.output);
        await runsStorage.updateStepStatus(runId, testStep.stepNumber, "test", testResult.success ? "passed" : "failed");

        if (testResult.success) {
          testsPass = true;
          break;
        }

        fixAttempts++;
        if (fixAttempts >= MAX_FIX_ATTEMPTS) {
          break;
        }

        await restoreFromBackup(backupId);

        const fixResult = await executeStep(runId, "fix", goal, artifacts, repoPath);
        if (!fixResult.success) {
          break;
        }
        artifacts.set("fix", fixResult.artifactContent || "");

        const fixDiff = fixResult.artifactContent || "";
        const fixParseResult = parseFilesFromDiff(fixDiff);
        
        if (fixParseResult.hasUnsafePaths) {
          continue;
        }
        
        const fixFilesToModify = fixParseResult.files;
        
        if (fixFilesToModify.length > 0) {
          const existingManifest = JSON.parse(fs.readFileSync(path.join(getBackupDir(backupId), "manifest.json"), "utf-8"));
          const fileSet = new Set([...existingManifest.files, ...fixFilesToModify]);
          const allFiles = Array.from(fileSet);
          await createFileBackup(allFiles, backupId);
        }

        const fixApplyResult = await applyDiff(fixDiff, repoPath, runId);
        if (!fixApplyResult.success) {
          continue;
        }
      }

      if (!testsPass) {
        await restoreFromBackup(backupId);
        await runsStorage.updateRunStatus(runId, "failed", `Tests failed after ${fixAttempts} fix attempts`);
        if (backupId) await cleanupBackup(backupId);
        runningWorkflows.delete(runId);
        return (await runsStorage.getRun(runId))!;
      }
    }

    const reviewResult = await executeStep(runId, "review", goal, artifacts, repoPath);
    
    await runsStorage.updateRunStatus(runId, "completed");
    if (backupId) await cleanupBackup(backupId);
    runningWorkflows.delete(runId);
    return (await runsStorage.getRun(runId))!;

  } catch (error: any) {
    runningWorkflows.delete(runId);
    if (backupId) {
      await restoreFromBackup(backupId);
      await cleanupBackup(backupId);
    }
    await runsStorage.updateRunStatus(runId, "failed", error.message);
    return (await runsStorage.getRun(runId))!;
  }
}

export function isWorkflowRunning(runId: string): boolean {
  return runningWorkflows.has(runId);
}

export async function applyDiffWithBackup(
  runId: string, 
  stepNumber: number, 
  stepType: StepType
): Promise<{ success: boolean; error?: string; backupId?: string }> {
  const artifact = await runsStorage.getStepArtifact(runId, stepNumber, stepType, getArtifactName(stepType));
  if (!artifact) {
    return { success: false, error: "Artifact not found" };
  }

  const run = await runsStorage.getRun(runId);
  if (!run) {
    return { success: false, error: "Run not found" };
  }

  const parseResult = parseFilesFromDiff(artifact);
  if (parseResult.hasUnsafePaths) {
    return { 
      success: false, 
      error: `Diff contains unsafe paths: ${parseResult.unsafePaths.join(", ")}` 
    };
  }
  
  const filesToModify = parseResult.files;
  const backupId = createBackupId();
  
  try {
    await createFileBackup(filesToModify, backupId);
    const result = await applyDiff(artifact, run.metadata.repoPath, runId);
    
    if (!result.success) {
      await restoreFromBackup(backupId);
      await cleanupBackup(backupId);
      return { success: false, error: result.error };
    }

    return { success: true, backupId };
  } catch (error: any) {
    await restoreFromBackup(backupId);
    await cleanupBackup(backupId);
    return { success: false, error: error.message };
  }
}

export async function revertDiff(backupId: string): Promise<{ success: boolean; error?: string }> {
  const result = await restoreFromBackup(backupId);
  if (result) {
    await cleanupBackup(backupId);
    return { success: true };
  }
  return { success: false, error: "Failed to restore from backup" };
}
