import { storage } from "./storage";
import { OllamaAdapter } from "./ollama";
import type { Task, TaskMode } from "@shared/schema";
import * as fs from "fs";
import * as path from "path";
import { execSync, spawn } from "child_process";

const ALLOWED_COMMANDS = new Set(["git", "pytest", "ruff", "mypy", "npm", "node", "python", "python3"]);

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

function applyDiff(cwd: string, diffContent: string): { success: boolean; error?: string } {
  const tempFile = path.join(cwd, ".simpleaide-temp.patch");
  
  try {
    fs.writeFileSync(tempFile, diffContent);
    
    // Check if patch applies cleanly
    const checkResult = runCommand(["git", "apply", "--check", tempFile], cwd);
    if (checkResult.exitCode !== 0) {
      fs.unlinkSync(tempFile);
      return { success: false, error: checkResult.stderr || "Patch check failed" };
    }
    
    // Apply the patch
    const applyResult = runCommand(["git", "apply", tempFile], cwd);
    fs.unlinkSync(tempFile);
    
    if (applyResult.exitCode !== 0) {
      return { success: false, error: applyResult.stderr || "Patch apply failed" };
    }
    
    return { success: true };
  } catch (error: any) {
    try { fs.unlinkSync(tempFile); } catch {}
    return { success: false, error: error.message };
  }
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
  
  const prompt = `You are an expert programmer. Implement the following:

Goal: ${task.goal}

Generate a unified diff that can be applied with 'git apply'.
The diff should be complete and ready to apply.

Output ONLY the unified diff, starting with --- and +++ lines.
Example format:
--- a/file.py
+++ b/file.py
@@ -1,3 +1,5 @@
 existing line
+new line
 another existing line`;

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

    // Extract diff from response
    const diffMatch = response.match(/---[\s\S]*?\+\+\+[\s\S]*/);
    if (diffMatch) {
      storage.setArtifact(task.id, "patch_1.diff", diffMatch[0]);
      log(task.id, "\n[SUCCESS] Implementation diff generated\n");
    } else {
      // Save raw response as a diff-like format
      const rawDiff = `--- a/generated.txt
+++ b/generated.txt
@@ -0,0 +1,${response.split('\n').length} @@
${response.split('\n').map(line => '+' + line).join('\n')}
`;
      storage.setArtifact(task.id, "patch_1.diff", rawDiff);
      log(task.id, "\n[SUCCESS] Implementation saved (raw format)\n");
    }
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

export async function applyTaskDiff(taskId: string, diffName: string): Promise<{ success: boolean; error?: string }> {
  const task = await storage.getTask(taskId);
  if (!task) {
    return { success: false, error: "Task not found" };
  }

  const diffContent = storage.getArtifact(taskId, diffName);
  if (!diffContent) {
    return { success: false, error: "Diff not found" };
  }

  const cwd = path.resolve(task.repoPath);
  
  // Create git snapshot before applying
  gitSnapshot(cwd, `SimpleAide: Before applying ${diffName}`);
  
  // Apply the diff
  const result = applyDiff(cwd, diffContent);
  
  if (result.success) {
    gitSnapshot(cwd, `SimpleAide: Applied ${diffName} for "${task.goal}"`);
  }
  
  return result;
}
