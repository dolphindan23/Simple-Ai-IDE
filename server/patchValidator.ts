import * as fs from "fs";
import * as path from "path";

export interface PatchValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  hunks: PatchHunk[];
}

export interface PatchHunk {
  operation: "create" | "modify" | "delete";
  oldPath: string | null;
  newPath: string | null;
  isNewFile: boolean;
  isDeleteFile: boolean;
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
        
        hunks.push({
          operation: isNewFile ? "create" : isDeleteFile ? "delete" : "modify",
          oldPath: isNewFile ? null : oldPath,
          newPath: isDeleteFile ? null : newPath,
          isNewFile,
          isDeleteFile,
        });
      }
    }
    i++;
  }
  
  return hunks;
}

export function validatePatch(diffContent: string, repoRoot: string): PatchValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  if (!diffContent || diffContent.trim().length === 0) {
    return { valid: false, errors: ["Empty diff content"], warnings: [], hunks: [] };
  }
  
  const trimmed = diffContent.trim();
  if (!trimmed.includes("---") || !trimmed.includes("+++")) {
    errors.push("Missing unified diff headers (--- and +++)");
    return { valid: false, errors, warnings, hunks: [] };
  }
  
  const hunks = parsePatch(diffContent);
  
  if (hunks.length === 0) {
    errors.push("No valid diff hunks found");
    return { valid: false, errors, warnings, hunks: [] };
  }
  
  for (const hunk of hunks) {
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
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    hunks,
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
