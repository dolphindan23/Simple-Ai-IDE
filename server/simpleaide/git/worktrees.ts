import * as fs from "fs";
import * as path from "path";
import { execSync, spawnSync } from "child_process";

const PROJECTS_DIR = path.resolve(process.cwd(), "projects");

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
}

export interface WorktreeResult {
  success: boolean;
  worktreePath?: string;
  error?: string;
}

function getProjectRepoPath(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId);
}

function getWorktreesDir(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, ".worktrees");
}

export function isGitRepo(repoPath: string): boolean {
  const gitDir = path.join(repoPath, ".git");
  return fs.existsSync(gitDir);
}

export function ensureGitRepo(repoPath: string): boolean {
  if (isGitRepo(repoPath)) return true;
  
  try {
    execSync("git init --initial-branch=main", { cwd: repoPath, stdio: "pipe" });
    
    const gitignorePath = path.join(repoPath, ".gitignore");
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, "node_modules/\n.env\n.worktrees/\n");
    }
    
    execSync('git add -A && git commit -m "Initial commit" --allow-empty', { 
      cwd: repoPath, 
      stdio: "pipe",
      env: { ...process.env, GIT_AUTHOR_NAME: "SimpleAide", GIT_AUTHOR_EMAIL: "agent@simpleaide.local", GIT_COMMITTER_NAME: "SimpleAide", GIT_COMMITTER_EMAIL: "agent@simpleaide.local" }
    });
    
    return true;
  } catch (e) {
    console.error(`[worktrees] Failed to init git repo at ${repoPath}:`, e);
    return false;
  }
}

export function getDefaultBranch(repoPath: string): string {
  if (!isGitRepo(repoPath)) return "main";
  
  try {
    const result = spawnSync("git", ["symbolic-ref", "--short", "HEAD"], {
      cwd: repoPath,
      encoding: "utf-8",
    });
    
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
    
    const branchResult = spawnSync("git", ["branch", "--show-current"], {
      cwd: repoPath,
      encoding: "utf-8",
    });
    
    if (branchResult.status === 0 && branchResult.stdout.trim()) {
      return branchResult.stdout.trim();
    }
    
    return "main";
  } catch (e) {
    return "main";
  }
}

export function listGitWorktrees(projectId: string): WorktreeInfo[] {
  const repoPath = getProjectRepoPath(projectId);
  
  if (!isGitRepo(repoPath)) return [];
  
  try {
    const result = spawnSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repoPath,
      encoding: "utf-8",
    });
    
    if (result.status !== 0) {
      console.error(`[worktrees] git worktree list failed:`, result.stderr);
      return [];
    }
    
    const worktrees: WorktreeInfo[] = [];
    const entries = result.stdout.split("\n\n").filter(Boolean);
    
    for (const entry of entries) {
      const lines = entry.split("\n");
      const worktree: Partial<WorktreeInfo> = {};
      
      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          worktree.path = line.substring(9);
        } else if (line.startsWith("HEAD ")) {
          worktree.head = line.substring(5);
        } else if (line.startsWith("branch ")) {
          worktree.branch = line.substring(7).replace("refs/heads/", "");
        } else if (line === "bare") {
          worktree.isMain = true;
        }
      }
      
      if (worktree.path) {
        worktrees.push({
          path: worktree.path,
          branch: worktree.branch || "(detached)",
          head: worktree.head || "",
          isMain: worktree.path === repoPath,
        });
      }
    }
    
    return worktrees;
  } catch (e) {
    console.error(`[worktrees] Error listing worktrees:`, e);
    return [];
  }
}

export function createWorktree(
  projectId: string,
  workspaceId: string,
  branchName: string,
  baseBranch: string = "main"
): WorktreeResult {
  const repoPath = getProjectRepoPath(projectId);
  const worktreesDir = getWorktreesDir(projectId);
  const worktreePath = path.join(worktreesDir, workspaceId);
  
  if (!isGitRepo(repoPath)) {
    if (!ensureGitRepo(repoPath)) {
      return { success: false, error: "Failed to initialize git repository" };
    }
  }
  
  const actualBaseBranch = baseBranch === "main" ? getDefaultBranch(repoPath) : baseBranch;
  
  if (!fs.existsSync(worktreesDir)) {
    fs.mkdirSync(worktreesDir, { recursive: true });
  }
  
  if (fs.existsSync(worktreePath)) {
    return { success: false, error: `Worktree already exists at ${worktreePath}` };
  }
  
  try {
    const branchCheck = spawnSync("git", ["rev-parse", "--verify", branchName], {
      cwd: repoPath,
      encoding: "utf-8",
    });
    
    const branchExists = branchCheck.status === 0;
    
    let args: string[];
    if (branchExists) {
      args = ["worktree", "add", worktreePath, branchName];
    } else {
      args = ["worktree", "add", "-b", branchName, worktreePath, actualBaseBranch];
    }
    
    const result = spawnSync("git", args, {
      cwd: repoPath,
      encoding: "utf-8",
    });
    
    if (result.status !== 0) {
      return { success: false, error: result.stderr || "Failed to create worktree" };
    }
    
    return { success: true, worktreePath };
  } catch (e: any) {
    return { success: false, error: e.message || "Unknown error creating worktree" };
  }
}

export function removeWorktree(projectId: string, workspaceId: string, force: boolean = false): WorktreeResult {
  const repoPath = getProjectRepoPath(projectId);
  const worktreePath = path.join(getWorktreesDir(projectId), workspaceId);
  
  if (!fs.existsSync(worktreePath)) {
    // Directory doesn't exist, clean up any stale worktree references
    pruneWorktrees(projectId);
    return { success: true };
  }
  
  try {
    const args = force 
      ? ["worktree", "remove", "--force", worktreePath]
      : ["worktree", "remove", worktreePath];
    
    const result = spawnSync("git", args, {
      cwd: repoPath,
      encoding: "utf-8",
    });
    
    if (result.status !== 0) {
      const errorMsg = result.stderr || "";
      
      // If git says it's not a working tree but directory exists, 
      // fall back to manual removal (directory was created but not as proper worktree)
      if (errorMsg.includes("is not a working tree") || errorMsg.includes("is not a valid worktree")) {
        console.log(`[worktrees] Directory exists but not a git worktree, removing manually: ${worktreePath}`);
        try {
          fs.rmSync(worktreePath, { recursive: true, force: true });
          // Clean up any stale worktree references
          pruneWorktrees(projectId);
          return { success: true };
        } catch (rmError: any) {
          return { success: false, error: `Failed to manually remove directory: ${rmError.message}` };
        }
      }
      
      return { success: false, error: errorMsg || "Failed to remove worktree" };
    }
    
    // Clean up any stale worktree references after successful removal
    pruneWorktrees(projectId);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || "Unknown error removing worktree" };
  }
}

export function pruneWorktrees(projectId: string): void {
  const repoPath = getProjectRepoPath(projectId);
  
  if (!isGitRepo(repoPath)) return;
  
  try {
    spawnSync("git", ["worktree", "prune"], {
      cwd: repoPath,
      encoding: "utf-8",
    });
  } catch (e) {
    console.error(`[worktrees] Error pruning worktrees:`, e);
  }
}

export function getWorktreeStatus(projectId: string, workspaceId: string): { hasChanges: boolean; ahead: number; behind: number } | null {
  const worktreePath = path.join(getWorktreesDir(projectId), workspaceId);
  
  if (!fs.existsSync(worktreePath)) return null;
  
  try {
    const statusResult = spawnSync("git", ["status", "--porcelain"], {
      cwd: worktreePath,
      encoding: "utf-8",
    });
    
    const hasChanges = statusResult.stdout.trim().length > 0;
    
    const aheadBehindResult = spawnSync("git", ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], {
      cwd: worktreePath,
      encoding: "utf-8",
    });
    
    let ahead = 0;
    let behind = 0;
    
    if (aheadBehindResult.status === 0) {
      const [aheadStr, behindStr] = aheadBehindResult.stdout.trim().split(/\s+/);
      ahead = parseInt(aheadStr, 10) || 0;
      behind = parseInt(behindStr, 10) || 0;
    }
    
    return { hasChanges, ahead, behind };
  } catch (e) {
    return null;
  }
}
