import { execSync, exec } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { randomBytes } from "crypto";

const approvalTokens = new Map<string, { token: string; projectPath: string; createdAt: number }>();
const TOKEN_EXPIRY_MS = 5 * 60 * 1000;

export async function createStashCheckpoint(projectPath: string, message: string): Promise<string | null> {
  try {
    const resolved = path.resolve(projectPath);
    
    const gitDir = path.join(resolved, ".git");
    if (!fs.existsSync(gitDir)) {
      return null;
    }

    try {
      execSync("git stash push -u -m \"" + message + "\"", {
        cwd: resolved,
        stdio: "pipe",
        encoding: "utf-8"
      });
    } catch (e) {
      return null;
    }

    const stashList = execSync("git stash list --oneline", {
      cwd: resolved,
      stdio: "pipe",
      encoding: "utf-8"
    });

    const lines = stashList.trim().split("\n");
    for (const line of lines) {
      if (line.includes(message)) {
        const match = line.match(/^(stash@\{(\d+)\})/);
        if (match) {
          return match[1];
        }
      }
    }

    return null;
  } catch (error) {
    console.error("Failed to create stash checkpoint:", error);
    return null;
  }
}

export async function rollbackToCheckpoint(
  projectPath: string, 
  checkpointRef: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const resolved = path.resolve(projectPath);

    execSync(`git stash apply ${checkpointRef}`, {
      cwd: resolved,
      stdio: "pipe",
      encoding: "utf-8"
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function applyPatchFile(
  projectPath: string, 
  patchPath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const resolved = path.resolve(projectPath);
    const patchResolved = path.resolve(patchPath);

    execSync(`git apply --check "${patchResolved}"`, {
      cwd: resolved,
      stdio: "pipe",
      encoding: "utf-8"
    });

    execSync(`git apply --whitespace=nowarn "${patchResolved}"`, {
      cwd: resolved,
      stdio: "pipe",
      encoding: "utf-8"
    });

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export function createApprovalToken(runId: string, projectPath: string): string {
  const token = randomBytes(32).toString("hex");
  
  approvalTokens.set(runId, {
    token,
    projectPath,
    createdAt: Date.now()
  });

  setTimeout(() => {
    approvalTokens.delete(runId);
  }, TOKEN_EXPIRY_MS);

  return token;
}

export function validateApprovalToken(runId: string, token: string): boolean {
  const stored = approvalTokens.get(runId);
  
  if (!stored) {
    return false;
  }

  if (Date.now() - stored.createdAt > TOKEN_EXPIRY_MS) {
    approvalTokens.delete(runId);
    return false;
  }

  return stored.token === token;
}

export function clearApprovalToken(runId: string): void {
  approvalTokens.delete(runId);
}
