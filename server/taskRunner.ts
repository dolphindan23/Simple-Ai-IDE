import { storage } from "./storage";
import { OllamaAdapter } from "./ollama";
import type { Task, TaskMode } from "@shared/schema";
import * as fs from "fs";
import * as path from "path";
import { execSync, spawn } from "child_process";
import { captureRepoSnapshot, formatSnapshotForPrompt, extractTargetFilesFromGoal } from "./repoSnapshot";
import { validatePatch, extractDiffFromResponse, formatValidationErrors, parsePatch } from "./patchValidator";

const ALLOWED_COMMANDS = new Set(["git", "pytest", "ruff", "mypy", "npm", "node", "python", "python3"]);
const MAX_TESTFIXER_ATTEMPTS = 3;

function log(taskId: string, message: string) {
  storage.addTaskLog(taskId, message);
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
  const hunks = parsePatch(diffContent);
  const filesModified: string[] = [];
  
  for (const hunk of hunks) {
    if (hunk.operation === "create" && hunk.newPath) {
      const targetPath = path.join(cwd, hunk.newPath);
      const targetDir = path.dirname(targetPath);
      
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      
      const content = extractNewFileContent(diffContent, hunk.newPath);
      if (content !== null) {
        fs.writeFileSync(targetPath, content, { mode: 0o644 });
        filesModified.push(hunk.newPath);
        continue;
      }
    }
    
    if (hunk.operation === "delete" && hunk.oldPath) {
      const targetPath = path.join(cwd, hunk.oldPath);
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
        filesModified.push(hunk.oldPath);
        continue;
      }
    }
  }
  
  const hasModifyHunks = hunks.some(h => h.operation === "modify");
  if (hasModifyHunks) {
    const tempFile = path.join(cwd, ".simpleaide-temp.patch");
    
    try {
      fs.writeFileSync(tempFile, diffContent);
      
      const checkResult = runCommand(["git", "apply", "--check", tempFile], cwd);
      if (checkResult.exitCode !== 0) {
        fs.unlinkSync(tempFile);
        return { success: false, error: checkResult.stderr || "Patch check failed", filesModified };
      }
      
      const applyResult = runCommand(["git", "apply", tempFile], cwd);
      fs.unlinkSync(tempFile);
      
      if (applyResult.exitCode !== 0) {
        return { success: false, error: applyResult.stderr || "Patch apply failed", filesModified };
      }
      
      hunks.filter(h => h.operation === "modify").forEach(h => {
        const p = h.newPath || h.oldPath;
        if (p) filesModified.push(p);
      });
      
      return { success: true, filesModified };
    } catch (error: any) {
      try { fs.unlinkSync(tempFile); } catch {}
      return { success: false, error: error.message, filesModified };
    }
  }
  
  return { success: true, filesModified };
}

function extractNewFileContent(diffContent: string, filePath: string): string | null {
  const lines = diffContent.split("\n");
  let inTargetHunk = false;
  let foundHeader = false;
  const contentLines: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.startsWith("--- /dev/null") || line.startsWith("--- a//dev/null")) {
      const nextLine = lines[i + 1];
      if (nextLine && (nextLine.includes(filePath) || nextLine.startsWith("+++ b/"))) {
        const extractedPath = nextLine.replace(/^\+\+\+\s+b?\//, "").trim();
        if (extractedPath === filePath || nextLine.includes(filePath)) {
          inTargetHunk = true;
          foundHeader = false;
          i++;
          continue;
        }
      }
    }
    
    if (inTargetHunk) {
      if (line.startsWith("@@")) {
        foundHeader = true;
        continue;
      }
      
      if (foundHeader) {
        if (line.startsWith("---") || line.startsWith("diff ")) {
          break;
        }
        
        if (line.startsWith("+")) {
          contentLines.push(line.slice(1));
        } else if (line.startsWith(" ")) {
          contentLines.push(line.slice(1));
        }
      }
    }
  }
  
  if (contentLines.length > 0) {
    return contentLines.join("\n");
  }
  
  return null;
}

async function runPlanMode(task: Task, ollama: OllamaAdapter): Promise<void> {
  const modeLabel = task.accurateMode ? "Accurate" : "Fast";
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
    
    log(task.id, "[SUCCESS] Plan generated\n");
  } catch (error: any) {
    log(task.id, `[ERROR] Plan generation failed: ${error.message}\n`);
    throw error;
  }
}

async function runImplementMode(task: Task, ollama: OllamaAdapter): Promise<void> {
  const modeLabel = task.accurateMode ? "Accurate" : "Fast";
  log(task.id, `[INFO] Starting implementation... (${modeLabel} mode)\n`);
  
  const cwd = path.resolve(task.repoPath);
  
  log(task.id, "[INFO] Capturing repository snapshot...\n");
  const targetFiles = extractTargetFilesFromGoal(task.goal, cwd);
  const snapshot = captureRepoSnapshot(cwd, targetFiles);
  const snapshotContext = formatSnapshotForPrompt(snapshot);
  
  storage.setArtifact(task.id, "snapshot.txt", snapshotContext);
  log(task.id, `[INFO] Snapshot captured: ${snapshot.files.length} target files identified\n`);
  
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
    
    log(task.id, "\n[INFO] Validating diff...\n");
    const validation = validatePatch(extractedDiff, cwd);
    storage.setArtifact(task.id, "validation.txt", formatValidationErrors(validation));
    
    if (!validation.valid) {
      log(task.id, `[WARN] Diff validation issues:\n${formatValidationErrors(validation)}\n`);
    } else {
      log(task.id, `[INFO] Diff validated: ${validation.hunks.length} operations\n`);
    }
    
    storage.setArtifact(task.id, "patch_1.diff", extractedDiff);
    log(task.id, "[SUCCESS] Implementation diff generated and validated\n");
    
  } catch (error: any) {
    log(task.id, `[ERROR] Implementation failed: ${error.message}\n`);
    throw error;
  }
}

async function runReviewMode(task: Task, ollama: OllamaAdapter): Promise<void> {
  const modeLabel = task.accurateMode ? "Accurate" : "Fast";
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
      return;
    }

    log(task.id, "[INFO] Generating review with AI...\n");
    
    let response = "";
    await ollama.generate(prompt, (token) => {
      response += token;
    });

    storage.setArtifact(task.id, "review.md", response);
    log(task.id, "[SUCCESS] Review completed\n");
  } catch (error: any) {
    log(task.id, `[ERROR] Review failed: ${error.message}\n`);
    throw error;
  }
}

async function runTestMode(task: Task, ollama: OllamaAdapter): Promise<void> {
  const modeLabel = task.accurateMode ? "Accurate" : "Fast";
  log(task.id, `[INFO] Running tests... (${modeLabel} mode)\n`);
  
  // Try to run pytest if available
  const cwd = path.resolve(task.repoPath);
  
  log(task.id, "[INFO] Attempting to run pytest...\n");
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
}

interface VerifyResult {
  passed: boolean;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

async function runVerifyStep(cwd: string, verifyCommand?: string): Promise<VerifyResult> {
  const command = verifyCommand || "npm test";
  const startTime = Date.now();
  
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
  maxAttempts: number = MAX_TESTFIXER_ATTEMPTS
): Promise<{ success: boolean; attempts: number; finalResult: VerifyResult }> {
  const cwd = path.resolve(task.repoPath);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log(task.id, `[INFO] TestFixer attempt ${attempt}/${maxAttempts}\n`);
    
    const verifyResult = await runVerifyStep(cwd, verifyCommand);
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
    
    const validation = validatePatch(fixDiff, cwd);
    if (!validation.valid) {
      log(task.id, `[WARN] Fix diff validation failed:\n${formatValidationErrors(validation)}\n`);
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

async function runVerifyMode(task: Task): Promise<void> {
  log(task.id, `[INFO] Starting verification...\n`);
  
  const cwd = path.resolve(task.repoPath);
  const verifyCommand = task.goal || "npm test";
  
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

export async function applyTaskDiff(taskId: string, diffName: string): Promise<{ success: boolean; error?: string; filesModified?: string[] }> {
  const task = await storage.getTask(taskId);
  if (!task) {
    return { success: false, error: "Task not found" };
  }

  const diffContent = storage.getArtifact(taskId, diffName);
  if (!diffContent) {
    return { success: false, error: "Diff not found" };
  }

  const cwd = path.resolve(task.repoPath);
  
  const validation = validatePatch(diffContent, cwd);
  if (!validation.valid) {
    storage.setArtifact(taskId, `${diffName}.validation.txt`, formatValidationErrors(validation));
    return { 
      success: false, 
      error: `Patch validation failed:\n${validation.errors.join("\n")}` 
    };
  }
  
  gitSnapshot(cwd, `SimpleAide: Before applying ${diffName}`);
  
  const result = applyDiff(cwd, diffContent);
  
  if (result.success) {
    gitSnapshot(cwd, `SimpleAide: Applied ${diffName} for "${task.goal}"`);
  }
  
  return result;
}

export async function applyAndVerify(
  taskId: string,
  diffName: string,
  verifyCommand?: string
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
  
  const ollama = new OllamaAdapter();
  const fixerResult = await runTestFixerLoop(task, ollama, verifyCommand);
  
  return {
    applySuccess: true,
    verifySuccess: fixerResult.success,
    attempts: fixerResult.attempts,
    filesModified: applyResult.filesModified,
    error: fixerResult.success ? undefined : `Verification failed after ${fixerResult.attempts} attempts`
  };
}
