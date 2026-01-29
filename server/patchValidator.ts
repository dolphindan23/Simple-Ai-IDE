import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import type { DangerItem, TrustSettings } from "@shared/schema";

export interface PatchValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  hunks: PatchHunk[];
  fileCount: number;
  lineCount: number;
  requiresConfirmation: boolean;
  confirmationToken?: string;
  dangerSummary: DangerItem[];
}

export interface PatchHunk {
  operation: "create" | "modify" | "delete";
  oldPath: string | null;
  newPath: string | null;
  isNewFile: boolean;
  isDeleteFile: boolean;
  lineCount: number;
}

export interface TrustLimits {
  maxFilesPerPatch: number;
  maxLinesPerPatch: number;
  sensitivePaths: string[];
}

const DEFAULT_LIMITS: TrustLimits = {
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
};

const TOKEN_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const TOKEN_EXPIRY_MS = 10 * 60 * 1000;
const usedTokens = new Set<string>();

setInterval(() => {
  usedTokens.clear();
}, TOKEN_EXPIRY_MS);

export function generateConfirmationToken(taskId: string, diffName: string): string {
  const expiresAt = Date.now() + TOKEN_EXPIRY_MS;
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = `${taskId}:${diffName}:${expiresAt}:${nonce}`;
  const signature = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}:${signature}`).toString("base64");
}

export function validateConfirmationToken(token: string, taskId: string, diffName: string): boolean {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const parts = decoded.split(":");
    if (parts.length !== 5) return false;
    
    const [tokenTaskId, tokenDiffName, expiresAtStr, nonce, signature] = parts;
    const expiresAt = parseInt(expiresAtStr, 10);
    
    if (tokenTaskId !== taskId || tokenDiffName !== diffName) return false;
    if (Date.now() > expiresAt) return false;
    
    const payload = `${tokenTaskId}:${tokenDiffName}:${expiresAtStr}:${nonce}`;
    const expectedSignature = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex");
    
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return false;
    
    const tokenId = `${nonce}:${signature.slice(0, 16)}`;
    if (usedTokens.has(tokenId)) return false;
    usedTokens.add(tokenId);
    
    return true;
  } catch {
    return false;
  }
}

export function isConfirmationTokenExpired(token: string): boolean {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const parts = decoded.split(":");
    if (parts.length !== 5) return true;
    const expiresAt = parseInt(parts[2], 10);
    return Date.now() > expiresAt;
  } catch {
    return true;
  }
}

const UNIFIED_DIFF_HEADER = /^---\s+(.+)$/;
const UNIFIED_DIFF_NEW = /^\+\+\+\s+(.+)$/;
const HUNK_HEADER = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

function normalizePath(filePath: string): string {
  let normalized = filePath.trim();
  
  if (normalized.startsWith("a/") || normalized.startsWith("b/")) {
    normalized = normalized.slice(2);
  }
  
  normalized = normalized.replace(/\\/g, "/");
  
  return normalized;
}

function isPathTraversal(filePath: string): boolean {
  if (path.isAbsolute(filePath)) return true;
  
  const normalized = path.normalize(filePath);
  if (normalized.startsWith("..")) return true;
  
  const parts = filePath.split(/[/\\]/);
  if (parts.includes("..")) return true;
  
  return false;
}

function matchesGlobPattern(filePath: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "<<<DOUBLESTAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<<DOUBLESTAR>>>/g, ".*")
    .replace(/\?/g, ".");
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}

export function isSensitivePath(filePath: string, sensitivePaths: string[]): string | null {
  for (const pattern of sensitivePaths) {
    if (matchesGlobPattern(filePath, pattern)) {
      return pattern;
    }
  }
  return null;
}

export function parsePatch(diffContent: string): PatchHunk[] {
  const hunks: PatchHunk[] = [];
  const lines = diffContent.split("\n");
  
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    
    const oldMatch = UNIFIED_DIFF_HEADER.exec(line);
    if (oldMatch) {
      const oldPath = normalizePath(oldMatch[1]);
      
      i++;
      if (i >= lines.length) break;
      
      const newMatch = UNIFIED_DIFF_NEW.exec(lines[i]);
      if (newMatch) {
        const newPath = normalizePath(newMatch[1]);
        
        const isNewFile = oldPath === "/dev/null";
        const isDeleteFile = newPath === "/dev/null";
        
        let lineCount = 0;
        let j = i + 1;
        while (j < lines.length) {
          const hunkLine = lines[j];
          if (hunkLine.startsWith("---") || hunkLine.startsWith("diff ")) break;
          if (hunkLine.startsWith("+") && !hunkLine.startsWith("+++")) lineCount++;
          if (hunkLine.startsWith("-") && !hunkLine.startsWith("---")) lineCount++;
          j++;
        }
        
        hunks.push({
          operation: isNewFile ? "create" : isDeleteFile ? "delete" : "modify",
          oldPath: isNewFile ? null : oldPath,
          newPath: isDeleteFile ? null : newPath,
          isNewFile,
          isDeleteFile,
          lineCount,
        });
      }
    }
    i++;
  }
  
  return hunks;
}

export function validatePatch(
  diffContent: string, 
  repoRoot: string, 
  limits: TrustLimits = DEFAULT_LIMITS,
  taskId?: string,
  diffName?: string
): PatchValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dangerSummary: DangerItem[] = [];
  
  const emptyResult: PatchValidationResult = {
    valid: false, errors: [], warnings: [], hunks: [],
    fileCount: 0, lineCount: 0, requiresConfirmation: false, dangerSummary: []
  };
  
  if (!diffContent || diffContent.trim().length === 0) {
    return { ...emptyResult, errors: ["Empty diff content"] };
  }
  
  const trimmed = diffContent.trim();
  if (!trimmed.includes("---") || !trimmed.includes("+++")) {
    errors.push("Missing unified diff headers (--- and +++)");
    return { ...emptyResult, errors };
  }
  
  const hunks = parsePatch(diffContent);
  
  if (hunks.length === 0) {
    errors.push("No valid diff hunks found");
    return { ...emptyResult, errors };
  }
  
  const fileCount = hunks.length;
  const lineCount = hunks.reduce((sum, h) => sum + h.lineCount, 0);
  
  if (fileCount > limits.maxFilesPerPatch) {
    errors.push(`Patch modifies too many files: found ${fileCount}, limit ${limits.maxFilesPerPatch}`);
  }
  
  if (lineCount > limits.maxLinesPerPatch) {
    errors.push(`Patch has too many line changes: found ${lineCount}, limit ${limits.maxLinesPerPatch}`);
  }
  
  for (const hunk of hunks) {
    const filePath = hunk.newPath || hunk.oldPath;
    
    if (hunk.operation === "delete" && hunk.oldPath) {
      dangerSummary.push({ file: hunk.oldPath, reason: "delete" });
    }
    
    if (filePath) {
      const sensitiveMatch = isSensitivePath(filePath, limits.sensitivePaths);
      if (sensitiveMatch) {
        dangerSummary.push({ file: filePath, reason: "sensitive_path", pattern: sensitiveMatch });
      }
    }
    
    if (hunk.operation === "create") {
      if (!hunk.newPath) {
        errors.push("New file hunk missing target path");
        continue;
      }
      
      if (isPathTraversal(hunk.newPath)) {
        errors.push(`Path traversal detected in new file: ${hunk.newPath}`);
        continue;
      }
      
      const targetPath = path.join(repoRoot, hunk.newPath);
      if (fs.existsSync(targetPath)) {
        warnings.push(`New file will overwrite existing: ${hunk.newPath}`);
      }
    }
    
    else if (hunk.operation === "delete") {
      if (!hunk.oldPath) {
        errors.push("Delete hunk missing source path");
        continue;
      }
      
      if (isPathTraversal(hunk.oldPath)) {
        errors.push(`Path traversal detected in delete: ${hunk.oldPath}`);
        continue;
      }
      
      const targetPath = path.join(repoRoot, hunk.oldPath);
      if (!fs.existsSync(targetPath)) {
        errors.push(`Cannot delete non-existent file: ${hunk.oldPath}`);
      }
    }
    
    else if (hunk.operation === "modify") {
      const targetPath = hunk.oldPath || hunk.newPath;
      if (!targetPath) {
        errors.push("Modify hunk missing file path");
        continue;
      }
      
      if (isPathTraversal(targetPath)) {
        errors.push(`Path traversal detected: ${targetPath}`);
        continue;
      }
      
      const absolutePath = path.join(repoRoot, targetPath);
      if (!fs.existsSync(absolutePath)) {
        errors.push(`Cannot modify non-existent file: ${targetPath}. Use --- /dev/null for new files.`);
      }
    }
  }
  
  const requiresConfirmation = dangerSummary.length > 0;
  let confirmationToken: string | undefined;
  
  if (requiresConfirmation && taskId && diffName) {
    confirmationToken = generateConfirmationToken(taskId, diffName);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    hunks,
    fileCount,
    lineCount,
    requiresConfirmation,
    confirmationToken,
    dangerSummary,
  };
}

export function extractDiffFromResponse(response: string): string | null {
  const diffBlockPattern = /```(?:diff)?\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = diffBlockPattern.exec(response)) !== null) {
    const content = match[1].trim();
    if (content.includes("---") && content.includes("+++")) {
      return content;
    }
  }
  
  const lines = response.split("\n");
  let inDiff = false;
  const diffLines: string[] = [];
  
  for (const line of lines) {
    if (line.startsWith("---")) {
      inDiff = true;
      diffLines.push(line);
    } else if (inDiff) {
      diffLines.push(line);
      
      if (line.trim() === "" && diffLines.length > 5 && !lines[lines.indexOf(line) + 1]?.startsWith("+") &&
          !lines[lines.indexOf(line) + 1]?.startsWith("-") && !lines[lines.indexOf(line) + 1]?.startsWith(" ") &&
          !lines[lines.indexOf(line) + 1]?.startsWith("@@") && !lines[lines.indexOf(line) + 1]?.startsWith("---")) {
      }
    }
  }
  
  if (diffLines.length > 0) {
    const extracted = diffLines.join("\n").trim();
    if (extracted.includes("---") && extracted.includes("+++")) {
      return extracted;
    }
  }
  
  return null;
}

export function formatValidationErrors(result: PatchValidationResult): string {
  const parts: string[] = [];
  
  if (result.errors.length > 0) {
    parts.push("ERRORS:");
    result.errors.forEach((e, i) => parts.push(`  ${i + 1}. ${e}`));
  }
  
  if (result.warnings.length > 0) {
    parts.push("WARNINGS:");
    result.warnings.forEach((w, i) => parts.push(`  ${i + 1}. ${w}`));
  }
  
  if (result.hunks.length > 0) {
    parts.push("OPERATIONS:");
    result.hunks.forEach(h => {
      const path = h.newPath || h.oldPath || "unknown";
      parts.push(`  - ${h.operation.toUpperCase()}: ${path}`);
    });
  }
  
  return parts.join("\n");
}
