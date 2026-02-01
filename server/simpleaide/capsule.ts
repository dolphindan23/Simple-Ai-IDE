import * as fs from "fs";
import * as path from "path";
import { isPathImmutable } from "./config";
import { scanForSecrets, SecretFinding } from "./secrets";

export interface CapsuleWriteResult {
  success: boolean;
  requiresConfirmation?: boolean;
  confirmKey?: string;
  reason?: string;
  secretsFound?: SecretFinding[];
}

export class OverlayFsCapsule {
  private runId: string;
  private repoPath: string;
  private workspacePath: string;
  private immutablePaths: string[];
  private deletedFiles: Set<string> = new Set();
  private modifiedFiles: Map<string, string> = new Map();
  private pendingWrites: Map<string, { filePath: string; content: string; reason: string }> = new Map();

  constructor(runId: string, repoPath: string, immutablePaths: string[]) {
    this.runId = runId;
    this.repoPath = repoPath;
    this.workspacePath = path.join(repoPath, ".simpleaide", "workspaces", runId);
    this.immutablePaths = immutablePaths;

    if (!fs.existsSync(this.workspacePath)) {
      fs.mkdirSync(this.workspacePath, { recursive: true });
    }
  }

  read(filePath: string): string | null {
    const normalizedPath = this.normalizePath(filePath);
    
    if (this.deletedFiles.has(normalizedPath)) {
      return null;
    }

    if (this.modifiedFiles.has(normalizedPath)) {
      return this.modifiedFiles.get(normalizedPath)!;
    }

    const workspaceFull = path.join(this.workspacePath, normalizedPath);
    if (fs.existsSync(workspaceFull)) {
      return fs.readFileSync(workspaceFull, "utf-8");
    }

    const repoFull = path.join(this.repoPath, normalizedPath);
    if (fs.existsSync(repoFull)) {
      return fs.readFileSync(repoFull, "utf-8");
    }

    return null;
  }

  write(filePath: string, content: string): CapsuleWriteResult {
    const normalizedPath = this.normalizePath(filePath);

    if (isPathImmutable(normalizedPath, this.immutablePaths)) {
      const confirmKey = `${this.runId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.pendingWrites.set(confirmKey, {
        filePath: normalizedPath,
        content,
        reason: `Path "${normalizedPath}" is marked as immutable`
      });
      
      return {
        success: false,
        requiresConfirmation: true,
        confirmKey,
        reason: `Path "${normalizedPath}" is marked as immutable and requires confirmation`
      };
    }

    const secretsFound = scanForSecrets(content);
    if (secretsFound.length > 0) {
      const confirmKey = `${this.runId}-secret-${Date.now()}`;
      this.pendingWrites.set(confirmKey, {
        filePath: normalizedPath,
        content,
        reason: `Potential secrets detected: ${secretsFound.map(s => s.type).join(", ")}`
      });
      
      return {
        success: false,
        requiresConfirmation: true,
        confirmKey,
        reason: "Potential secrets detected in content",
        secretsFound
      };
    }

    return this.performWrite(normalizedPath, content);
  }

  forceWrite(filePath: string, content: string): CapsuleWriteResult {
    const normalizedPath = this.normalizePath(filePath);
    return this.performWrite(normalizedPath, content);
  }

  private performWrite(normalizedPath: string, content: string): CapsuleWriteResult {
    this.modifiedFiles.set(normalizedPath, content);
    this.deletedFiles.delete(normalizedPath);

    const fullPath = path.join(this.workspacePath, normalizedPath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, "utf-8");

    return { success: true };
  }

  delete(filePath: string): CapsuleWriteResult {
    const normalizedPath = this.normalizePath(filePath);

    if (isPathImmutable(normalizedPath, this.immutablePaths)) {
      return {
        success: false,
        reason: `Cannot delete immutable path: ${normalizedPath}`
      };
    }

    this.deletedFiles.add(normalizedPath);
    this.modifiedFiles.delete(normalizedPath);

    const markerPath = path.join(this.workspacePath, normalizedPath + ".DELETED");
    const dir = path.dirname(markerPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(markerPath, "", "utf-8");

    return { success: true };
  }

  listModified(): string[] {
    return Array.from(this.modifiedFiles.keys());
  }

  listDeleted(): string[] {
    return Array.from(this.deletedFiles);
  }

  getPendingWrites(): { key: string; filePath: string; content: string; reason: string }[] {
    const result: { key: string; filePath: string; content: string; reason: string }[] = [];
    this.pendingWrites.forEach((value, key) => {
      result.push({ key, ...value });
    });
    return result;
  }

  addImmutablePattern(pattern: string): void {
    if (!this.immutablePaths.includes(pattern)) {
      this.immutablePaths.push(pattern);
    }
  }

  writeFile(filePath: string, content: string, options?: { approvalToken?: string }): CapsuleWriteResult {
    const normalizedPath = this.normalizePath(filePath);

    if (isPathImmutable(normalizedPath, this.immutablePaths)) {
      if (options?.approvalToken) {
        return this.performWrite(normalizedPath, content);
      }
      
      const confirmKey = `${this.runId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.pendingWrites.set(confirmKey, {
        filePath: normalizedPath,
        content,
        reason: `Path "${normalizedPath}" is marked as immutable`
      });
      
      throw new Error(`Path "${normalizedPath}" requires approval (immutable path)`);
    }

    const secretsFound = scanForSecrets(content);
    if (secretsFound.length > 0) {
      if (options?.approvalToken) {
        return this.performWrite(normalizedPath, content);
      }

      const confirmKey = `${this.runId}-secret-${Date.now()}`;
      this.pendingWrites.set(confirmKey, {
        filePath: normalizedPath,
        content,
        reason: `Secret detected in content`
      });
      
      throw new Error(`Path "${normalizedPath}" contains potential secrets requiring approval`);
    }

    return this.performWrite(normalizedPath, content);
  }

  resolvePending(confirmKey: string, approved: boolean): boolean {
    const pending = this.pendingWrites.get(confirmKey);
    if (!pending) return false;

    if (approved) {
      this.performWrite(pending.filePath, pending.content);
    }

    this.pendingWrites.delete(confirmKey);
    return true;
  }

  exportPatch(): string {
    const patches: string[] = [];

    this.modifiedFiles.forEach((content, filePath) => {
      const originalContent = this.getOriginalContent(filePath);
      const patch = this.createUnifiedDiff(filePath, originalContent, content);
      if (patch) {
        patches.push(patch);
      }
    });

    this.deletedFiles.forEach((filePath) => {
      const originalContent = this.getOriginalContent(filePath);
      if (originalContent) {
        const patch = this.createUnifiedDiff(filePath, originalContent, "");
        if (patch) {
          patches.push(patch);
        }
      }
    });

    return patches.join("\n");
  }

  private getOriginalContent(filePath: string): string {
    const repoFull = path.join(this.repoPath, filePath);
    if (fs.existsSync(repoFull)) {
      return fs.readFileSync(repoFull, "utf-8");
    }
    return "";
  }

  private createUnifiedDiff(filePath: string, oldContent: string, newContent: string): string | null {
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");

    if (oldContent === newContent) return null;

    const isNew = oldContent === "";
    const isDeleted = newContent === "";

    let diff = `--- a/${filePath}\n+++ b/${filePath}\n`;

    if (isNew) {
      diff += `@@ -0,0 +1,${newLines.length} @@\n`;
      for (const line of newLines) {
        diff += `+${line}\n`;
      }
    } else if (isDeleted) {
      diff += `@@ -1,${oldLines.length} +0,0 @@\n`;
      for (const line of oldLines) {
        diff += `-${line}\n`;
      }
    } else {
      diff += `@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;
      for (const line of oldLines) {
        diff += `-${line}\n`;
      }
      for (const line of newLines) {
        diff += `+${line}\n`;
      }
    }

    return diff;
  }

  private normalizePath(filePath: string): string {
    let normalized = path.normalize(filePath);
    if (normalized.startsWith("/")) {
      normalized = normalized.slice(1);
    }
    if (normalized.startsWith("./")) {
      normalized = normalized.slice(2);
    }
    
    const resolved = path.resolve(this.repoPath, normalized);
    if (!resolved.startsWith(path.resolve(this.repoPath))) {
      throw new Error("Path traversal detected");
    }
    
    return normalized;
  }

  cleanup(): void {
    if (fs.existsSync(this.workspacePath)) {
      fs.rmSync(this.workspacePath, { recursive: true, force: true });
    }
  }
}

class CapsuleProvider {
  private capsules: Map<string, OverlayFsCapsule> = new Map();

  createCapsule(runId: string, repoPath: string, immutablePaths: string[] = []): OverlayFsCapsule {
    const capsule = new OverlayFsCapsule(runId, repoPath, immutablePaths);
    this.capsules.set(runId, capsule);
    return capsule;
  }

  getOrCreateCapsule(runId: string, repoPath: string, immutablePaths: string[] = []): OverlayFsCapsule {
    const existing = this.capsules.get(runId);
    if (existing) {
      return existing;
    }
    return this.createCapsule(runId, repoPath, immutablePaths);
  }

  getCapsule(runId: string): OverlayFsCapsule | undefined {
    return this.capsules.get(runId);
  }

  destroyCapsule(runId: string): void {
    const capsule = this.capsules.get(runId);
    if (capsule) {
      capsule.cleanup();
      this.capsules.delete(runId);
    }
  }
}

export const capsuleProvider = new CapsuleProvider();
