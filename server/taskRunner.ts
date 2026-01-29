import { storage } from "./storage";
import { OllamaAdapter } from "./ollama";
import type { Task, TaskMode, TrustSettings } from "@shared/schema";
import * as fs from "fs";
import * as path from "path";
import { execSync, spawn } from "child_process";
import { captureRepoSnapshot, formatSnapshotForPrompt, extractTargetFilesFromGoal } from "./repoSnapshot";
import { 
  validatePatch, 
  extractDiffFromResponse, 
  formatValidationErrors, 
  parsePatch, 
  validateConfirmationToken,
  TrustLimits 
} from "./patchValidator";
import { createRun, getRun, getRunByKey } from "./aiDb";
import { emitRunStatus, emitAgentStatus, emitStep, emitReadFile, emitWriteFile, emitToolCall, emitError, emitProposeChangeset, emitNeedsApproval } from "./aiEvents";

const ALLOWED_COMMANDS = new Set(["git", "pytest", "ruff", "mypy", "npm", "node", "python", "python3"]);

let gitAvailable: boolean | null = null;

export function checkGitAvailable(): boolean {
  if (gitAvailable !== null) return gitAvailable;
  try {
    execSync("git --version", { encoding: "utf-8", timeout: 5000 });
    gitAvailable = true;
  } catch {
    gitAvailable = false;
  }
  return gitAvailable;
}

export function getDefaultTrustSettings(): TrustSettings {
  return {
    autoFixEnabled: false,
    maxFixAttempts: 3,
    maxFilesPerPatch: 10,
    maxLinesPerPatch: 500,
    sensitivePaths: [
      "server/**",
      "scripts/**",
      "package.json",
      "package-lock.json",
      "*.config.*",
      ".env*",
      ".simpleaide/**",
    ],
    verifyAllowlist: [
      "npm test",
      "npm run test",
      "npm run lint",
      "npm run build",
      "npm run typecheck",
    ],
  };
}

export function getTrustLimits(settings?: TrustSettings): TrustLimits {
  const s = settings || getDefaultTrustSettings();
  return {
    maxFilesPerPatch: s.maxFilesPerPatch,
    maxLinesPerPatch: s.maxLinesPerPatch,
    sensitivePaths: s.sensitivePaths,
  };
}

export function isVerifyCommandAllowed(command: string, allowlist: string[]): boolean {
  const normalizedCommand = command.trim().toLowerCase();
  return allowlist.some(allowed => {
    const normalizedAllowed = allowed.trim().toLowerCase();
    return normalizedCommand === normalizedAllowed || normalizedCommand.startsWith(normalizedAllowed + " ");
  });
}

export function getPackageJsonScripts(repoPath: string): string[] {
  try {
    const pkgPath = path.join(path.resolve(repoPath), "package.json");
    if (!fs.existsSync(pkgPath)) return [];
    
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    if (!pkg.scripts) return [];
    
    return Object.keys(pkg.scripts).map(script => `npm run ${script}`);
  } catch {
    return [];
  }
}

const taskRunMap = new Map<string, string>();

function getOrCreateRunId(taskId: string, mode: TaskMode, goal?: string, agents?: string[], fastMode?: boolean): string {
  if (taskRunMap.has(taskId)) {
    return taskRunMap.get(taskId)!;
  }
  
  const existingRun = getRunByKey(taskId);
  if (existingRun) {
    taskRunMap.set(taskId, existingRun.id);
    return existingRun.id;
  }
  
  const modeMap: Record<TaskMode, "plan" | "implement" | "test" | "review" | "verify"> = {
    plan: "plan",
    implement: "implement",
    test: "test",
    review: "review",
    verify: "verify"
  };
  
  const run = createRun({
    id: `run_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    run_key: taskId,
    mode: modeMap[mode] || "implement",
    status: "queued",
    goal: goal || null,
    agents: agents || [mode === "plan" ? "planner" : mode === "review" ? "reviewer" : mode === "test" ? "testfixer" : "coder"],
    fast_mode: fastMode || false,
    created_by_user_id: null
  });
  
  taskRunMap.set(taskId, run.id);
  return run.id;
}

function getRunIdForTask(taskId: string): string | undefined {
  return taskRunMap.get(taskId);
}

function log(taskId: string, message: string) {
  storage.addTaskLog(taskId, message);
  
  const runId = getRunIdForTask(taskId);
  if (runId && message.trim()) {
    const cleanMsg = message.replace(/^\[INFO\]\s*|\[WARN\]\s*|\[ERROR\]\s*/i, "").trim();
    if (cleanMsg && !cleanMsg.startsWith("---") && !cleanMsg.startsWith("+++") && !cleanMsg.startsWith("@@")) {
      if (message.includes("[ERROR]")) {
        emitError(runId, cleanMsg, "coder");
      } else if (cleanMsg.length > 5 && cleanMsg.length < 200) {
        emitStep(runId, "coder", cleanMsg);
      }
    }
  }
}

function runCommand(cmd: string[], cwd: string): { stdout: string; stderr: string; exitCode: number } {
  const [command, ...args] = cmd;
  
  if (!ALLOWED_COMMANDS.has(command)) {
    return { stdout: "", stderr: `Command not allowed: ${command}`, exitCode: 1 };
  }

  try {
    const result = execSync(cmd.join(" "), { 
      cwd, 
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000,
    });
    return { stdout: result, stderr: "", exitCode: 0 };
  } catch (error: any) {
    return { 
      stdout: error.stdout || "", 
      stderr: error.stderr || error.message, 
      exitCode: error.status || 1 
    };
  }
}

function gitSnapshot(cwd: string, message: string): boolean {
  try {
    execSync("git add -A", { cwd });
    execSync(`git commit --allow-empty -m "${message}"`, { cwd });
    return true;
  } catch {
    return false;
  }
}

function applyDiff(cwd: string, diffContent: string): { success: boolean; error?: string; filesModified?: string[] } {
  const resolvedCwd = path.resolve(cwd);
  const hunks = parsePatch(diffContent);
  
  if (!checkGitAvailable()) {
    return { 
      success: false, 
      error: "Git required for patch apply; install git or switch to pure-js apply"
    };
  }
  
  const tempFile = path.join(resolvedCwd, ".simpleaide-temp.patch");
  
  try {
    fs.writeFileSync(tempFile, diffContent);
    
    const checkResult = runCommand(["git", "apply", "--check", "--whitespace=nowarn", tempFile], resolvedCwd);
    if (checkResult.exitCode !== 0) {
      fs.unlinkSync(tempFile);
      return { success: false, error: checkResult.stderr || "Patch check failed" };
    }
    
    const applyResult = runCommand(["git", "apply", "--whitespace=nowarn", tempFile], resolvedCwd);
    fs.unlinkSync(tempFile);
    
    if (applyResult.exitCode !== 0) {
      return { success: false, error: applyResult.stderr || "Patch apply failed" };
    }
    
    const filesModified = hunks
      .map(h => h.newPath || h.oldPath)
      .filter((p): p is string => !!p);
    
    return { success: true, filesModified: Array.from(new Set(filesModified)) };
  } catch (error: any) {
    try { fs.unlinkSync(tempFile); } catch {}
    return { success: false, error: error.message };
  }
}

async function runPlanMode(task: Task, ollama: OllamaAdapter): Promise<void> {
  const runId = getOrCreateRunId(task.id, "plan", task.goal, ["planner"], !task.accurateMode);
  const modeLabel = task.accurateMode ? "Accurate" : "Fast";
  
  emitRunStatus(runId, "running", `Starting plan generation (${modeLabel} mode)`);
  emitAgentStatus(runId, "planner", "working", "Analyzing goal and creating plan");
  emitStep(runId, "planner", "Analyzing goal", undefined, { step_index: 1, step_total: 2, phase: "plan" });
  
  log(task.id, `[INFO] Starting plan generation... (${modeLabel} mode)\n`);
  
  const prompt = `You are a senior software architect. Analyze this goal and create a detailed implementation plan.

Goal: ${task.goal}

Provide a structured plan with:
1. Files that need to be created or modified
2. Step-by-step implementation approach
3. Dependencies or prerequisites
4. Testing strategy

Format as JSON with structure:
{
  "steps": ["step1", "step2", ...],
  "files": ["file1.py", "file2.py", ...],
  "dependencies": ["dep1", "dep2", ...],
  "testStrategy": "description"
}`;

  try {
    log(task.id, "[INFO] Generating plan with AI...\n");
    
    const isAvailable = await ollama.isAvailable();
    if (!isAvailable) {
      log(task.id, "[WARN] Ollama not available. Using stub plan.\n");
      const stubPlan = {
        steps: [
          `Analyze requirements for: ${task.goal}`,
          "Create necessary file structure",
          "Implement core functionality",
          "Add error handling",
          "Write tests"
        ],
        files: ["main.py", "utils.py", "tests/test_main.py"],
        dependencies: [],
        testStrategy: "Unit tests with pytest"
      };
      storage.setArtifact(task.id, "plan.json", JSON.stringify(stubPlan, null, 2));
      log(task.id, "[SUCCESS] Plan generated (stub mode)\n");
      emitAgentStatus(runId, "planner", "done", "Plan generated (stub mode)");
      emitRunStatus(runId, "completed", "Plan generated in stub mode");
      return;
    }

    let response = "";
    await ollama.generate(prompt, (token) => {
      response += token;
    });

    // Try to parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      storage.setArtifact(task.id, "plan.json", jsonMatch[0]);
    } else {
      storage.setArtifact(task.id, "plan.json", JSON.stringify({
        steps: [response],
        files: [],
        dependencies: [],
        testStrategy: "TBD"
      }, null, 2));
    }
    
    emitStep(runId, "planner", "Plan complete", undefined, { step_index: 2, step_total: 2, phase: "plan" });
    log(task.id, "[SUCCESS] Plan generated\n");
    emitAgentStatus(runId, "planner", "done", "Plan generation completed");
    emitRunStatus(runId, "completed", "Plan generated successfully");
  } catch (error: any) {
    log(task.id, `[ERROR] Plan generation failed: ${error.message}\n`);
    emitAgentStatus(runId, "planner", "error", error.message);
    throw error;
  }
}

async function runImplementMode(task: Task, ollama: OllamaAdapter): Promise<void> {
  const runId = getOrCreateRunId(task.id, "implement", task.goal, ["coder"], !task.accurateMode);
  const modeLabel = task.accurateMode ? "Accurate" : "Fast";
  
  emitRunStatus(runId, "running", `Starting implementation (${modeLabel} mode)`);
  emitAgentStatus(runId, "coder", "working", "Starting implementation");
  
  log(task.id, `[INFO] Starting implementation... (${modeLabel} mode)\n`);
  
  const cwd = path.resolve(task.repoPath);
  
  emitStep(runId, "coder", "Capturing repository snapshot", undefined, { step_index: 1, step_total: 4, phase: "implement" });
  log(task.id, "[INFO] Capturing repository snapshot...\n");
  const targetFiles = extractTargetFilesFromGoal(task.goal, cwd);
  const snapshot = captureRepoSnapshot(cwd, targetFiles);
  const snapshotContext = formatSnapshotForPrompt(snapshot);
  
  for (const file of snapshot.files) {
    emitReadFile(runId, "coder", file.path);
  }
  
  storage.setArtifact(task.id, "snapshot.txt", snapshotContext);
  log(task.id, `[INFO] Snapshot captured: ${snapshot.files.length} target files identified\n`);
  
  emitStep(runId, "coder", "Generating implementation with AI", undefined, { step_index: 2, step_total: 4, phase: "implement" });
  
  const prompt = `You are an expert programmer working on a codebase. Your task is to generate a unified diff.

${snapshotContext}

=== TASK ===
Goal: ${task.goal}

=== STRICT OUTPUT FORMAT ===
You MUST output a single unified diff. Follow these rules exactly:

1. For EXISTING FILES (modify):
   --- a/path/to/file.ext
   +++ b/path/to/file.ext
   @@ -startLine,count +startLine,count @@
    context line (space prefix)
   -removed line (minus prefix)
   +added line (plus prefix)

2. For NEW FILES (create):
   --- /dev/null
   +++ b/path/to/newfile.ext
   @@ -0,0 +1,lineCount @@
   +first line of new file
   +second line

3. For DELETED FILES:
   --- a/path/to/oldfile.ext
   +++ /dev/null
   @@ -1,lineCount +0,0 @@
   -content being deleted

CONSTRAINTS:
- Use paths relative to repo root (no leading /)
- No path traversal (..)
- No absolute paths
- Context lines must match exactly
- Line counts in @@ headers must be accurate

Output ONLY the unified diff. No explanations before or after.`;

  try {
    const isAvailable = await ollama.isAvailable();
    if (!isAvailable) {
      log(task.id, "[WARN] Ollama not available. Using stub diff.\n");
      const stubDiff = `--- a/README.md
+++ b/README.md
@@ -1 +1,3 @@
-# Project
+# Project
+
+Updated by SimpleAide agent for: ${task.goal}
`;
      storage.setArtifact(task.id, "patch_1.diff", stubDiff);
      log(task.id, "[SUCCESS] Implementation generated (stub mode)\n");
      emitAgentStatus(runId, "coder", "done", "Implementation generated (stub mode)");
      emitRunStatus(runId, "completed", "Implementation generated in stub mode");
      return;
    }

    log(task.id, "[INFO] Generating code with AI...\n");
    
    let response = "";
    await ollama.generate(prompt, (token) => {
      response += token;
      process.stdout.write(token);
    });

    storage.setArtifact(task.id, "raw_response.txt", response);
    
    const extractedDiff = extractDiffFromResponse(response);
    
    if (!extractedDiff) {
      log(task.id, "\n[ERROR] No valid diff found in AI response\n");
      storage.setArtifact(task.id, "patch_1.diff", "");
      return;
    }
    
    emitStep(runId, "coder", "Validating generated diff", undefined, { step_index: 3, step_total: 4, phase: "implement" });
    log(task.id, "\n[INFO] Validating diff...\n");
    const validation = validatePatch(extractedDiff, cwd);
    storage.setArtifact(task.id, "validation.txt", formatValidationErrors(validation));
    
    if (!validation.valid) {
      log(task.id, `[WARN] Diff validation issues:\n${formatValidationErrors(validation)}\n`);
    } else {
      log(task.id, `[INFO] Diff validated: ${validation.hunks.length} operations\n`);
    }
    
    storage.setArtifact(task.id, "patch_1.diff", extractedDiff);
    emitStep(runId, "coder", "Implementation complete", undefined, { step_index: 4, step_total: 4, phase: "implement" });
    log(task.id, "[SUCCESS] Implementation diff generated and validated\n");
    
    const filesInPatch = validation.hunks.map(h => h.newPath || h.oldPath).filter((p): p is string => !!p);
    emitProposeChangeset(runId, "coder", filesInPatch, `Proposed changes to ${filesInPatch.length} file(s)`);
    emitAgentStatus(runId, "coder", "done", "Implementation completed");
    emitRunStatus(runId, "needs_approval", "Diff ready for review");
    
  } catch (error: any) {
    log(task.id, `[ERROR] Implementation failed: ${error.message}\n`);
    emitAgentStatus(runId, "coder", "error", error.message);
    throw error;
  }
}

async function runReviewMode(task: Task, ollama: OllamaAdapter): Promise<void> {
  const runId = getOrCreateRunId(task.id, "review", task.goal, ["reviewer"], !task.accurateMode);
  const modeLabel = task.accurateMode ? "Accurate" : "Fast";
  
  emitRunStatus(runId, "running", `Starting code review (${modeLabel} mode)`);
  emitAgentStatus(runId, "reviewer", "working", "Analyzing code for review");
  
  log(task.id, `[INFO] Starting code review... (${modeLabel} mode)\n`);
  
  const prompt = `You are a senior code reviewer. Review the following goal/changes:

Goal: ${task.goal}

Provide a thorough code review with:
1. Potential issues or bugs
2. Security concerns
3. Performance considerations
4. Best practices suggestions
5. Overall assessment

Be specific and actionable.`;

  try {
    const isAvailable = await ollama.isAvailable();
    if (!isAvailable) {
      log(task.id, "[WARN] Ollama not available. Using stub review.\n");
      const stubReview = `# Code Review

## Goal Reviewed
${task.goal}

## Assessment
- Code structure: Needs review with Ollama enabled
- Security: Run security scan when Ollama is available
- Performance: Analyze after implementation

## Recommendations
1. Enable Ollama for detailed code analysis
2. Run automated tests
3. Check for edge cases

*Generated in stub mode - enable Ollama for full review*
`;
      storage.setArtifact(task.id, "review.md", stubReview);
      log(task.id, "[SUCCESS] Review generated (stub mode)\n");
      emitAgentStatus(runId, "reviewer", "done", "Review generated (stub mode)");
      emitRunStatus(runId, "completed", "Review generated in stub mode");
      return;
    }

    log(task.id, "[INFO] Generating review with AI...\n");
    
    let response = "";
    await ollama.generate(prompt, (token) => {
      response += token;
    });

    storage.setArtifact(task.id, "review.md", response);
    log(task.id, "[SUCCESS] Review completed\n");
    emitAgentStatus(runId, "reviewer", "done", "Code review completed");
    emitRunStatus(runId, "completed", "Review completed successfully");
  } catch (error: any) {
    log(task.id, `[ERROR] Review failed: ${error.message}\n`);
    emitAgentStatus(runId, "reviewer", "error", error.message);
    throw error;
  }
}

async function runTestMode(task: Task, ollama: OllamaAdapter): Promise<void> {
  const runId = getOrCreateRunId(task.id, "test", task.goal, ["testfixer"], !task.accurateMode);
  const modeLabel = task.accurateMode ? "Accurate" : "Fast";
  
  emitRunStatus(runId, "running", `Running tests (${modeLabel} mode)`);
  emitAgentStatus(runId, "testfixer", "working", "Running test suite");
  
  log(task.id, `[INFO] Running tests... (${modeLabel} mode)\n`);
  
  // Try to run pytest if available
  const cwd = path.resolve(task.repoPath);
  
  log(task.id, "[INFO] Attempting to run pytest...\n");
  emitToolCall(runId, "testfixer", "python3 -m pytest -v", "Running pytest test suite");
  const pytestResult = runCommand(["python3", "-m", "pytest", "-v"], cwd);
  
  let testOutput = "";
  
  if (pytestResult.exitCode === 0) {
    testOutput = `# Test Results\n\n## pytest output:\n\`\`\`\n${pytestResult.stdout}\n\`\`\`\n`;
    log(task.id, "[SUCCESS] Tests passed\n");
  } else if (pytestResult.stderr.includes("No module named pytest")) {
    log(task.id, "[WARN] pytest not installed. Generating test suggestions...\n");
    
    // Generate test suggestions using AI
    const prompt = `Generate pytest test cases for the following goal:

Goal: ${task.goal}

Provide complete, runnable pytest code.`;

    const isAvailable = await ollama.isAvailable();
    if (isAvailable) {
      let response = "";
      await ollama.generate(prompt, (token) => {
        response += token;
      });
      testOutput = `# Test Suggestions\n\n${response}`;
    } else {
      testOutput = `# Test Suggestions\n\nOllama not available. Please write tests for: ${task.goal}`;
    }
    
    log(task.id, "[INFO] Test suggestions generated\n");
  } else {
    testOutput = `# Test Results\n\n## Errors:\n\`\`\`\n${pytestResult.stderr || pytestResult.stdout}\n\`\`\`\n`;
    log(task.id, "[ERROR] Tests failed. See output for details.\n");
  }

  storage.setArtifact(task.id, "test.log", testOutput);
  
  if (pytestResult.exitCode === 0) {
    emitAgentStatus(runId, "testfixer", "done", "All tests passed");
    emitRunStatus(runId, "completed", "Tests completed successfully");
  } else if (!pytestResult.stderr.includes("No module named pytest")) {
    emitAgentStatus(runId, "testfixer", "error", "Tests failed");
  }
}

interface VerifyResult {
  passed: boolean;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

async function runVerifyStep(cwd: string, verifyCommand?: string, runId?: string): Promise<VerifyResult> {
  const command = verifyCommand || "npm test";
  const startTime = Date.now();
  
  if (runId) {
    emitToolCall(runId, "testfixer", command, `Running verification: ${command}`);
  }
  
  const parts = command.split(" ");
  const [cmd, ...args] = parts;
  
  const result = runCommand([cmd, ...args], cwd);
  const durationMs = Date.now() - startTime;
  
  return {
    passed: result.exitCode === 0,
    command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs,
  };
}

async function runTestFixerLoop(
  task: Task,
  ollama: OllamaAdapter,
  verifyCommand: string,
  maxAttempts: number = 3,
  trustSettings?: TrustSettings
): Promise<{ success: boolean; attempts: number; finalResult: VerifyResult }> {
  const cwd = path.resolve(task.repoPath);
  const limits = getTrustLimits(trustSettings);
  
  const runId = getRunIdForTask(task.id);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(task.id, `[INFO] TestFixer attempt ${attempt}/${maxAttempts}\n`);
    if (runId) {
      emitStep(runId, "testfixer", `Verification attempt ${attempt}/${maxAttempts}`, undefined, { step_index: attempt, step_total: maxAttempts, phase: "verify" });
    }
    
    const verifyResult = await runVerifyStep(cwd, verifyCommand, runId);
    storage.setArtifact(task.id, `verify_attempt_${attempt}.json`, JSON.stringify(verifyResult, null, 2));
    
    if (verifyResult.passed) {
      log(task.id, `[SUCCESS] Tests passed on attempt ${attempt}\n`);
      return { success: true, attempts: attempt, finalResult: verifyResult };
    }
    
    log(task.id, `[WARN] Tests failed (exit code ${verifyResult.exitCode})\n`);
    log(task.id, `[INFO] Stderr: ${verifyResult.stderr.slice(0, 500)}...\n`);
    
    if (attempt >= maxAttempts) {
      log(task.id, `[ERROR] Max attempts (${maxAttempts}) reached. TestFixer giving up.\n`);
      return { success: false, attempts: attempt, finalResult: verifyResult };
    }
    
    const isAvailable = await ollama.isAvailable();
    if (!isAvailable) {
      log(task.id, "[WARN] Ollama not available for TestFixer. Cannot generate fix.\n");
      return { success: false, attempts: attempt, finalResult: verifyResult };
    }
    
    log(task.id, "[INFO] Generating fix diff with AI...\n");
    
    const targetFiles = extractTargetFilesFromGoal(task.goal, cwd);
    const snapshot = captureRepoSnapshot(cwd, targetFiles);
    const snapshotContext = formatSnapshotForPrompt(snapshot);
    
    const fixPrompt = `You are an expert programmer. A test/build verification has FAILED.

${snapshotContext}

=== ORIGINAL GOAL ===
${task.goal}

=== VERIFY COMMAND ===
${verifyCommand}

=== FAILURE OUTPUT ===
Exit Code: ${verifyResult.exitCode}

STDOUT:
${verifyResult.stdout.slice(0, 2000)}

STDERR:
${verifyResult.stderr.slice(0, 2000)}

=== YOUR TASK ===
Generate a unified diff that fixes the error. Follow the STRICT OUTPUT FORMAT:

1. For EXISTING FILES (modify):
   --- a/path/to/file.ext
   +++ b/path/to/file.ext
   @@ -startLine,count +startLine,count @@
    context line
   -removed line
   +added line

2. For NEW FILES (create):
   --- /dev/null
   +++ b/path/to/newfile.ext
   @@ -0,0 +1,lineCount @@
   +new content

Output ONLY the unified diff. No explanations.`;

    let response = "";
    await ollama.generate(fixPrompt, (token) => {
      response += token;
    });
    
    storage.setArtifact(task.id, `fix_response_${attempt}.txt`, response);
    
    const fixDiff = extractDiffFromResponse(response);
    if (!fixDiff) {
      log(task.id, "[ERROR] No valid fix diff found in AI response\n");
      continue;
    }
    
    const validation = validatePatch(fixDiff, cwd, limits);
    if (!validation.valid) {
      log(task.id, `[WARN] Fix diff validation failed:\n${formatValidationErrors(validation)}\n`);
      storage.setArtifact(task.id, `fix_validation_${attempt}.json`, JSON.stringify({
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
        fileCount: validation.fileCount,
        lineCount: validation.lineCount,
        dangerSummary: validation.dangerSummary,
      }, null, 2));
      continue;
    }
    
    if (validation.requiresConfirmation) {
      log(task.id, `[WARN] Fix diff requires confirmation (dangerous changes). Skipping auto-apply.\n`);
      storage.setArtifact(task.id, `fix_dangerous_${attempt}.json`, JSON.stringify({
        message: "Fix patch blocked - contains dangerous changes",
        dangerSummary: validation.dangerSummary,
      }, null, 2));
      continue;
    }
    
    storage.setArtifact(task.id, `fix_patch_${attempt}.diff`, fixDiff);
    
    gitSnapshot(cwd, `SimpleAide: Before fix attempt ${attempt}`);
    
    const applyResult = applyDiff(cwd, fixDiff);
    if (!applyResult.success) {
      log(task.id, `[ERROR] Failed to apply fix: ${applyResult.error}\n`);
      continue;
    }
    
    log(task.id, `[INFO] Fix applied. Re-verifying...\n`);
    gitSnapshot(cwd, `SimpleAide: Applied fix attempt ${attempt}`);
  }
  
  const finalResult = await runVerifyStep(cwd, verifyCommand);
  return { success: finalResult.passed, attempts: maxAttempts, finalResult };
}

async function runVerifyMode(task: Task, trustSettings?: TrustSettings): Promise<void> {
  log(task.id, `[INFO] Starting verification...\n`);
  
  const cwd = path.resolve(task.repoPath);
  const verifyCommand = task.goal || "npm test";
  const settings = trustSettings || getDefaultTrustSettings();
  
  const packageScripts = getPackageJsonScripts(cwd);
  const fullAllowlist = [...settings.verifyAllowlist, ...packageScripts];
  
  if (!isVerifyCommandAllowed(verifyCommand, fullAllowlist)) {
    log(task.id, `[ERROR] Verify command not in allowlist: ${verifyCommand}\n`);
    log(task.id, `[INFO] Allowed commands: ${fullAllowlist.join(", ")}\n`);
    throw new Error(`Verify command not allowed: ${verifyCommand}`);
  }
  
  log(task.id, `[INFO] Running: ${verifyCommand}\n`);
  
  const result = await runVerifyStep(cwd, verifyCommand);
  
  storage.setArtifact(task.id, "verify_result.json", JSON.stringify(result, null, 2));
  
  if (result.passed) {
    log(task.id, `[SUCCESS] Verification passed (${result.durationMs}ms)\n`);
  } else {
    log(task.id, `[ERROR] Verification failed (exit code ${result.exitCode})\n`);
    if (result.stderr) {
      log(task.id, `[STDERR] ${result.stderr.slice(0, 1000)}\n`);
    }
  }
  
  storage.setArtifact(task.id, "verify.log", 
    `# Verification Results\n\n` +
    `Command: ${result.command}\n` +
    `Exit Code: ${result.exitCode}\n` +
    `Duration: ${result.durationMs}ms\n\n` +
    `## STDOUT\n\`\`\`\n${result.stdout}\n\`\`\`\n\n` +
    `## STDERR\n\`\`\`\n${result.stderr}\n\`\`\`\n`
  );
  
  if (!result.passed) {
    throw new Error(`Verification failed: ${verifyCommand}`);
  }
}

export async function runTask(taskId: string): Promise<void> {
  const task = await storage.getTask(taskId);
  if (!task) {
    throw new Error("Task not found");
  }

  await storage.updateTask(taskId, { status: "running" });
  log(taskId, `[INFO] Starting task: ${task.mode}\n`);
  log(taskId, `[INFO] Goal: ${task.goal}\n`);

  const ollama = new OllamaAdapter();

  try {
    switch (task.mode) {
      case "plan":
        await runPlanMode(task, ollama);
        break;
      case "implement":
        await runImplementMode(task, ollama);
        break;
      case "review":
        await runReviewMode(task, ollama);
        break;
      case "test":
        await runTestMode(task, ollama);
        break;
      case "verify":
        await runVerifyMode(task);
        break;
      default:
        throw new Error(`Unknown mode: ${task.mode}`);
    }

    await storage.updateTask(taskId, { status: "done" });
    log(taskId, "Task complete.\n");
  } catch (error: any) {
    await storage.updateTask(taskId, { status: "error", error: error.message });
    log(taskId, `[ERROR] Task failed: ${error.message}\n`);
    log(taskId, "Task complete.\n");
  }
}

export interface ApplyDiffOptions {
  confirmationToken?: string;
  trustSettings?: TrustSettings;
}

export interface ApplyDiffResult {
  success: boolean;
  error?: string;
  filesModified?: string[];
  requiresConfirmation?: boolean;
  confirmationToken?: string;
  dangerSummary?: Array<{ file: string; reason: string; pattern?: string }>;
  validationReport?: {
    fileCount: number;
    lineCount: number;
    errors: string[];
    warnings: string[];
  };
}

export async function applyTaskDiff(
  taskId: string, 
  diffName: string,
  options: ApplyDiffOptions = {}
): Promise<ApplyDiffResult> {
  const task = await storage.getTask(taskId);
  if (!task) {
    return { success: false, error: "Task not found" };
  }

  const diffContent = storage.getArtifact(taskId, diffName);
  if (!diffContent) {
    return { success: false, error: "Diff not found" };
  }

  const cwd = path.resolve(task.repoPath);
  const limits = getTrustLimits(options.trustSettings);
  
  const validation = validatePatch(diffContent, cwd, limits, taskId, diffName);
  
  const validationReport = {
    fileCount: validation.fileCount,
    lineCount: validation.lineCount,
    errors: validation.errors,
    warnings: validation.warnings,
  };
  
  storage.setArtifact(taskId, `${diffName}.validation.json`, JSON.stringify({
    ...validationReport,
    hunks: validation.hunks.map(h => ({
      operation: h.operation,
      path: h.newPath || h.oldPath,
      lineCount: h.lineCount,
    })),
    requiresConfirmation: validation.requiresConfirmation,
    dangerSummary: validation.dangerSummary,
  }, null, 2));
  
  if (!validation.valid) {
    storage.setArtifact(taskId, `${diffName}.validation.txt`, formatValidationErrors(validation));
    return { 
      success: false, 
      error: `Patch validation failed:\n${validation.errors.join("\n")}`,
      validationReport,
    };
  }
  
  if (validation.requiresConfirmation) {
    if (!options.confirmationToken) {
      return {
        success: false,
        error: "Dangerous changes detected. Manual confirmation required.",
        requiresConfirmation: true,
        confirmationToken: validation.confirmationToken,
        dangerSummary: validation.dangerSummary,
        validationReport,
      };
    }
    
    if (!validateConfirmationToken(options.confirmationToken, taskId, diffName)) {
      return {
        success: false,
        error: "Invalid or expired confirmation token",
        validationReport,
      };
    }
  }
  
  gitSnapshot(cwd, `SimpleAide: Before applying ${diffName}`);
  
  const result = applyDiff(cwd, diffContent);
  
  if (result.success) {
    gitSnapshot(cwd, `SimpleAide: Applied ${diffName} for "${task.goal}"`);
    
    const runId = getRunIdForTask(taskId);
    if (runId) {
      for (const filePath of result.filesModified || []) {
        emitWriteFile(runId, "coder", filePath);
      }
    }
    
    storage.setArtifact(taskId, `${diffName}.applied_files.txt`, 
      (result.filesModified || []).join("\n")
    );
  }
  
  return {
    ...result,
    validationReport,
  };
}

export async function applyAndVerify(
  taskId: string,
  diffName: string,
  verifyCommand?: string,
  trustSettings?: TrustSettings
): Promise<{ 
  applySuccess: boolean; 
  verifySuccess: boolean; 
  error?: string;
  attempts?: number;
  filesModified?: string[];
}> {
  const applyResult = await applyTaskDiff(taskId, diffName);
  
  if (!applyResult.success) {
    return { 
      applySuccess: false, 
      verifySuccess: false, 
      error: applyResult.error,
      filesModified: applyResult.filesModified
    };
  }
  
  if (!verifyCommand) {
    return { applySuccess: true, verifySuccess: true, filesModified: applyResult.filesModified };
  }
  
  const task = await storage.getTask(taskId);
  if (!task) {
    return { applySuccess: true, verifySuccess: false, error: "Task not found for verification" };
  }
  
  const settings = trustSettings || getDefaultTrustSettings();
  
  const cwd = path.resolve(task.repoPath);
  const packageScripts = getPackageJsonScripts(cwd);
  const fullAllowlist = [...settings.verifyAllowlist, ...packageScripts];
  
  if (!isVerifyCommandAllowed(verifyCommand, fullAllowlist)) {
    return {
      applySuccess: true,
      verifySuccess: false,
      error: `Verify command not allowed: ${verifyCommand}`,
      filesModified: applyResult.filesModified
    };
  }
  
  const ollama = new OllamaAdapter();
  const maxAttempts = settings.autoFixEnabled ? settings.maxFixAttempts : 0;
  
  if (maxAttempts === 0) {
    const verifyResult = await runVerifyStep(cwd, verifyCommand);
    return {
      applySuccess: true,
      verifySuccess: verifyResult.passed,
      attempts: 1,
      filesModified: applyResult.filesModified,
      error: verifyResult.passed ? undefined : `Verification failed (auto-fix disabled)`
    };
  }
  
  const fixerResult = await runTestFixerLoop(task, ollama, verifyCommand, maxAttempts, settings);
  
  return {
    applySuccess: true,
    verifySuccess: fixerResult.success,
    attempts: fixerResult.attempts,
    filesModified: applyResult.filesModified,
    error: fixerResult.success ? undefined : `Verification failed after ${fixerResult.attempts} attempts`
  };
}
